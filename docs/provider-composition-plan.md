# Provider composition implementation plan

The goal is to run the same agent definitions with independently selected orchestration, execution,
project management, and account identities. A platform may supply several roles, but selecting one role
must not select its other roles implicitly. D56 records this decision.

## Implementation sequence

1. Define service contracts and a host-scoped registry. Keep runtime protocols and sync adapters as
   separate extension contracts. Reject duplicate registrations and unsupported plugin API versions.
2. Add optional service bindings to the IR, normalizer, specification, schema, and browser validator.
   Preserve minimal harness defaults and editor round-trip behavior.
3. Resolve the orchestration engine and execution provider in the host. Route agent and squad tasks
   through execution, retain parent/delegator metadata, and connect optional task tracking.
4. Provide GitHub and GitLab task adapters plus GitHub App and GitLab service-account identities.
   Authenticate optional incoming webhooks and suppress events created by the task adapter itself.
5. Run the existing coding-agent drivers in a remote worker. Add Modal, Daytona, and E2B adapters with
   explicit sandbox cleanup, cancellation, secret mapping, and committed repository checkout.
6. Validate each contract with tests, run the CLI suite and UI build, check examples, review the diff,
   and open a pull request. Live cloud verification requires operator credentials and prepared images.

This document describes the intended implementation and configuration. The pull request's validation
report records which checks actually ran. A successful mocked adapter test is not a live deployment.

## Validation recorded during implementation

- The complete CLI suite passes: 426 tests across 19 files. Coverage includes schema/CLI/browser parity,
  plugin composition, task attribution, authenticated webhook ingress, SDK adapters, worker artifacts,
  and shutdown races. External APIs are mocked; the worker test uses a real temporary Git repository.
- The CLI TypeScript build passes. Adapter calls were also checked against the published declarations
  for Modal 0.10.1, Daytona 0.218.0, and E2B 2.51.0.
- CLI validation passes for `examples/minimal`, `examples/altavox`, and `examples/provider-composition`.
- The UI production build passes. Vite reports the existing advisory about chunks larger than 500 kB.
- Independent code review approved the implementation after lifecycle and routing regressions were fixed.
  No live cloud deployment or worker image build was performed.

## Boundaries

| Contract | Inputs | Owns |
|---|---|---|
| Orchestration | Harness IR, execution context | Graph compilation, run and gate lifecycle |
| Execution | Agent task, runtime profile, workspace context | Placement, event stream, result, cancellation |
| Runtime driver | Resolved runtime instance, coding-agent task | Protocol messages, native session and tools |
| Project management | Task identity, parent/delegator, status and output | Board-specific task representation |
| Identity | Agent and integration | Account principal and resolved credentials |
| Sync | Harness definition and target ownership | Export or reconciliation of definition files |

The core retains delegation metadata even when a board has no equivalent hierarchy. GitHub and GitLab
adapters represent tasks as issues and report status through comments and open/closed state. Creating
a code branch or pull request remains an agent action through its configured tools and credentials.

## Local composition

The runnable example in `examples/provider-composition/` uses LangGraph, local execution, an in-memory
task board, and local identities. It needs Claude Code installed and authenticated, as the minimal
example does. Remove `project-management` to disable board tracking. Omitted orchestration, execution,
and identity bindings normalize to `langgraph/v1`, `local/v1`, and `local/v1` respectively.

```sh
harnessfile validate examples/provider-composition
harnessfile up examples/provider-composition
```

The in-memory board and default graph checkpoints are lost when the host exits. A provider that offers
durable orchestration must implement persistence and recovery itself. Unsupported memory backends fail
rather than claiming persistence through an in-memory fallback.

Without triggers or an ingress subscription, `up` performs one run and closes execution, orchestration,
task, and identity services. Task creation and status updates are part of dispatch: a failed board write
fails the run instead of silently reporting a completed task. Shutdown waits for pending task creation
and cancellation before closing the integrations those operations use.

## GitHub tasks and bot identity

```yaml
project-management:
  provider:
    type: github/v1
    repository: example/project
    webhook:
      secret: GITHUB_WEBHOOK_SECRET
      taskLabel: harnessfile
      agent: engineer
identity:
  provider:
    type: github-app/v1
    default:
      appId: 123456
      installationId: 987654
      privateKeySecret: GITHUB_APP_PRIVATE_KEY
      subject: harnessfile-bot[bot]
```

Install the GitHub App on the repository with permission to read and write issues. Set the private key
and webhook secret in the host environment under those names. The identity provider signs an app JWT
and exchanges it for an installation token. `agents` may override the default mapping by agent slug.
Each visible GitHub bot author corresponds to a real app identity. Changing `subject` only changes the
attribution metadata; it does not impersonate a different account.

The optional host endpoint is `POST /providers/project-management/webhook`. The adapter accepts
signed GitHub issue-opened, labeled, and reopened events for the configured label. The configured
`agent` supplies attribution metadata; the harness graph selects the actual execution agent. Configure
GitHub's webhook URL to reach that endpoint through your authenticated deployment. Adapter-created
issues and configured bot subjects are ignored to avoid recursively creating work.

If the graph declares any triggers, ingress requires exactly one unscheduled trigger whose provider
matches the selected project-management provider. Invalid or ambiguous routes fail at startup. A graph
without triggers can receive project events directly. Managed triggers accept ingress through the
authenticated provider endpoint; their generic `/trigger/<name>` endpoint is disabled.

## GitLab tasks and service accounts

```yaml
project-management:
  provider:
    type: gitlab/v1
    project: example/project
    apiUrl: https://gitlab.com/api/v4
    webhook:
      secret: GITLAB_WEBHOOK_SECRET
      taskLabel: harnessfile
      agent: engineer
identity:
  provider:
    type: gitlab-service-account/v1
    default:
      tokenSecret: GITLAB_BOT_TOKEN
      subject: harnessfile-service-account
```

Use a token belonging to the intended account with permission to read and write project issues.
Per-agent mappings under `agents` select separate accounts where needed. GitLab Issue Hook events
are accepted for issue creation and reopening, with the configured label. The adapter checks the
webhook token before emitting work.

For GitHub Enterprise or self-hosted GitLab, set the same `apiUrl` on project management and identity.
The board passes its API base URL as the credential audience; mismatched identity endpoints fail before
credentials reach the board API.

Both board adapters reconcile deterministic task markers against existing issues and serialize
same-task creation in one host. They do not provide atomic creation across independent hosts.
Webhook delivery deduplication in the host is in memory. Restart recovery and exactly-once ingress
require a durable coordinator; they are not supplied by selecting a remote sandbox.

## Remote execution

Only the execution binding changes when moving coding-agent tasks to a sandbox:

```yaml
execution:
  provider:
    type: daytona/v1
    repository: https://github.com/example/project.git
    ref: main
    snapshot: harnessfile-worker
    envSecrets:
      ANTHROPIC_API_KEY: WORKER_ANTHROPIC_API_KEY
```

The repository is an HTTPS URL and must be accessible from the worker. Commit the `.agents/` directory
before running. The worker receives task data and checks out the selected revision; it does not copy
uncommitted files, the host's CLI configuration, or its authentication directory. `envSecrets` maps
worker environment names to secret names on the host. Pass only credentials the task needs.

Provider IDs and optional host SDK packages are:

| Execution provider | SDK installed on host | Required prepared environment | Default host credential variables |
|---|---|---|---|
| `modal/v1` | `modal` | `image`, a container registry image | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` |
| `daytona/v1` | `@daytona/sdk` | `snapshot`, a prepared snapshot | `DAYTONA_API_KEY` |
| `e2b/v1` | `e2b` | `template`, a prepared template | `E2B_API_KEY` |

Each prepared environment must include Node.js, Git, the built Harnessfile worker, the selected
coding-agent executable, and required project tools. The default worker command is
`node /opt/harnessfile/dist/src/services/execution/worker.js`. `workerCommand` supplies a replacement
argv array. `workerPlugins` explicitly selects installed worker-side runtime plugins, independently
of plugins loaded into the host. Cloud SDK credentials belong in the host environment.
`timeoutMs` defaults to 900000 and accepts positive integer values up to 86400000. Modal accepts an
optional `app` name, defaulting to `harnessfile`. Daytona accepts optional `apiUrl` and `target`
settings. `apiKeySecret` overrides the credential variable name for Daytona and E2B; Modal uses
`tokenIdSecret` and `tokenSecretSecret` for its two credential variable names.

Connected remote execution creates a fresh sandbox per task and cleans it up after completion or
cancellation. Detached Modal execution continues after the coordinator exits and publishes its result
to durable task memory; see the [stateless guide](./stateless-orchestration-plan.md). Result metadata
can carry patch artifacts, but the host does not automatically apply
those patches to another task's checkout. Tasks that depend on code written by an earlier agent need
an explicit commit/branch handoff or an execution plugin that retains a shared workspace.
Native session resumption is unsupported for these ephemeral workers. Use an execution
plugin that retains compatible instance and workspace identity when session continuity is required.

## Extending the host

Load trusted code explicitly with repeatable CLI options:

```sh
harnessfile up --plugin ./team-providers.mjs --plugin @example/harnessfile-providers
```

A plugin's default export is `{ apiVersion: 1, register(registry) { ... } }`. Register a service using
`registry.register(kind, id, factory)`, a coding-agent protocol using `registry.registerRuntime(driver)`,
or a sync target using `registry.registerSync(adapter)`. Factories receive the resolved configuration
and host context. The public contracts are exported from `harnessfile/providers` and defined in
`packages/cli/src/services/contracts.ts`.

A plugin may register the same ID in multiple service roles. Duplicate IDs within a role fail, and
registrations do not leak between hosts. YAML never imports executable plugin code. An operator must
install, trust, and explicitly load a module. The existing Multica sync adapter remains available;
additional Multica service roles require adapters implementing the same independent contracts.
