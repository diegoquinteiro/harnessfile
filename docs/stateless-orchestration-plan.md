# Stateless orchestration and task memory

D57 separates task memory from the lifetime of the coordinating process. The existing `langgraph/v1`
engine remains available. `langgraph-stateless/v1` advances a task during an invocation, persists its
state, submits detached work, and exits. A later event or explicit reconciliation advances it again.

The CLI runs one event at a time. The optional [Modal host](../examples/remote-worker/STATELESS.md)
deploys an authenticated webhook receiver, queued coordinator jobs, and a minute reconciliation
schedule. Each coordinator invocation exits after advancing the task; a worker can finish while no
coordinator process is running. Other hosts can invoke the same CLI behind their own receiver.

## Implementation plan

1. Add `task-memory` to the specification, schema, IR, CLI, and editor while retaining existing defaults.
2. Define revision-checked checkpoints, immutable handoffs, canonical task keys, contextual tools, and
   detached submission contracts independently of project management.
3. Implement filesystem, GitHub, and GitLab task memory, with repository files as the durable authority.
4. Implement stateless graph invocation and recovery, using durable dispatch intents and handoffs.
5. Add detached Modal execution and contextual worker tooling without changing portable agent cards.
6. Add provider and account configuration to the editor, including opaque settings for future providers.
7. Verify restart, concurrent-event, failure, serialization, and account boundaries; run builds and an
   independent review before updating the pull request.

Implementation files and tests accompany this plan. The final pull-request validation report records
which checks ran. Mocked cloud SDK tests are not evidence of a live hosted deployment.

## Choose a lifecycle

| Composition | Process lifetime | Coordination state | Agent execution |
|---|---|---|---|
| `langgraph/v1` | Continuous `up` host, or one-shot graph | In-memory reference checkpoints | Local or connected remote sessions |
| `langgraph-stateless/v1` | One `event` invocation at a time | Selected durable task-memory provider | Detached execution; Modal is the reference cloud adapter |
| Custom provider | Defined by its implementation | Defined by its implementation | Declared execution capabilities |

Selecting external task memory does not change the legacy `memory` block. The stateless engine requires
`task-memory`, durable compare-and-swap support, and detached submission. A syntactically valid provider
ID is insufficient; the composition must satisfy those contracts before dispatch.

The reference stateless engine supports sequential graph progression and resumes native graph
checkpoints from task memory. Parallel fan-out is rejected. See the engine's validation errors for
unsupported graph shapes. Each canonical task key owns one persisted workflow. A completed task returns
its prior result, including when its issue is reopened; reopening does not start a new workflow. Existing
agent runtime protocols and sync targets retain their contracts.

## Complete configurations

Use [the GitHub example](../examples/stateless-github/) or
[the GitLab example](../examples/stateless-gitlab/). Both include:

- A Modal worker image and committed repository ref.
- An issue provider with authenticated webhook settings and an explicit handoff-author mapping.
- Task memory on a separately configured state branch.
- A coordinator account and per-agent bot or service-account mappings.
- Portable engineer and reviewer cards, runtime profiles, and a sequential graph.

Create the state branch before running. Each account that writes checkpoints or handoffs needs write
access to the state directory. GitHub Apps need Contents read/write and Issues read/write permissions
on the installation. GitLab service-account tokens need the corresponding repository and issue API
permissions. The examples contain environment variable names, never credentials.

A shared default account produces one visible author. Distinct GitHub bot authors require distinct
Apps, and distinct GitLab authors require tokens for those accounts. A `subject` label does not change
the authenticated account.

## Task memory configuration

GitHub and GitLab use the same storage contract and differ in repository addressing:

```yaml
task-memory:
  provider:
    type: github/v1
    repository: example/agent-project
    stateBranch: harness-state
    statePath: .harnessfile/tasks
    identityAgent: orchestrator
    publishNotes: true
```

For GitLab, use `type: gitlab/v1` and `project: example/agent-project`. `apiUrl` selects a self-hosted
API. `stateBranch` must explicitly name an existing writable branch; `HEAD` is rejected. `statePath`
defaults to `.harnessfile/tasks`. `identityAgent` defaults to `orchestrator` for coordinator writes.
Handoff projections use the handoff agent's identity.

An optional `tokenSecret` names an environment variable and overrides identity resolution. A shared
explicit token also determines the visible comment author, so prefer per-agent identity mappings when
separate bot authors are required. `publishNotes` defaults to true. Set it to false if the memory
repository differs from the task board; in that case, provide another wakeup or reconciliation path.

For local tests and deployments with a genuinely shared filesystem:

```yaml
task-memory:
  provider:
    type: filesystem/v1
    path: /var/lib/harnessfile/tasks
    lockTimeoutMs: 5000
```

A path on the coordinator's local machine is inaccessible to a Modal sandbox. The detached Modal
adapter rejects `filesystem/v1`; use repository-backed task memory for that composition.

GitHub files use blob SHA checks, GitLab files use `last_commit_id`, and filesystem storage uses an
exclusive directory lock followed by an atomic replacement. Stale checkpoint revisions fail. A
filesystem lock left by a crashed process is not automatically stolen; inspect and recover that lock
before resuming. Each stored task record, including checkpoints and immutable handoffs, is limited
to 16 MiB. Oversized writes fail before replacing the existing record. These operations protect
coordination records, not arbitrary external actions.

## Canonical task identity

A task's durable key includes its provider, normalized API origin and base path, configured repository
or project, and external issue ID. For example:

```text
task:["github/v1","https://api.github.com","example/agent-project","42"]
```

The issue number alone is insufficient. GitHub repository names normalize to lowercase. GitLab numeric
project IDs and project paths are distinct key namespaces, so keep that representation stable across
invocations. Adapters emit canonical keys; trusted manual event input must provide a matching `task.id`
and `task.key`. A changed repository, API endpoint, or project representation selects different state.

## Deliver and reconcile events

```sh
harnessfile event examples/stateless-github --input examples/stateless-github/event.json
harnessfile event examples/stateless-github --input /path/to/webhook-envelope.json --webhook
```

Trusted direct input contains the task identity and initial prompt. A webhook envelope contains a
`body` string with the exact raw payload and a `headers` object. The provider verifies the signature or
webhook token before delivering work. If the graph has triggers, exactly one non-scheduled trigger must
match the selected project-management provider.

To reconcile pending work, supply `--resume` with its canonical task key and an input JSON object. This
is also how a scheduler detects a deadline when a worker fails to publish a completion. The optional
Modal deployment provides that schedule and stores unfinished task keys in a Modal Dict. The CLI alone
does not install infrastructure. Store the key returned by the initial invocation instead of
reconstructing it from an issue number. Scheduled reconciliation uses an empty input object, without
reusing an external delivery event ID.

Webhook adapters attach a stable `eventId` to each delivery. The engine stores receipt metadata under
that ID so redelivery does not consume another graph transition. A pending submission is still
reconciled, preserving recovery if the process exited after saving an intent but before sending it.
Trusted callers should use stable event IDs for retried external events. The receipt limit is 10000 per
task; reaching it requires a new task rather than silently dropping replay protection.

Human gates return a `resumeToken` identifying the current interruption. An explicit approval includes
that token under `approval.resumeToken`; a stale approval cannot resume a later gate. Webhook handoff
events do not implicitly approve human gates. Human gates leave the Modal reconciliation index until
an explicit approval resumes them; completed and failed tasks leave it as well.

Agent-authored handoff comments can wake the coordinator when `webhook.handoffAgents` maps the agent
to the actual author username. A valid signature and an allowed author only admit the event. The engine
still checks its durable pending dispatch and stored handoff before advancing. Comments are retryable
notifications; they are not the authoritative checkpoint and do not provide exactly-once publication.

The graph definition is bound to its persisted task state. If a definition changes while work is
pending, reconcile or migrate that task deliberately instead of assuming the new graph can consume old
state. Concurrent advances use revision checks and leases. An uncertain external submission may require
later reconciliation; durable records do not imply exactly-once effects outside Harnessfile.

## Agent capabilities for the current task

The selected providers declare tool descriptors and input schemas. Continuous execution can expose
board reading and comments without durable task memory; detached execution also exposes the selected
task-memory tools. The runtime binds the task, dispatch, run, step, and agent for one execution. It adds contextual instructions to that execution and exposes:

```sh
harnessfile-task tools
printf '{}' | harnessfile-task task_read
printf '{"body":"The implementation branch is ready for review."}' | harnessfile-task task_comment
```

The reference task-memory provider declares `task_memory_read` and `task_memory_publish_handoff`.
Agents discover their schemas through `harnessfile-task tools`; providers may expose additional tools.
The helper binds calls to the injected task and dispatch scope. Secret values arrive through worker
environment variables and are not embedded in prompts, agent cards, or checkpoint configuration.

A handoff is immutable by dispatch ID and includes the run, step, agent, terminal status, summary, and
creation time. It may include artifact URLs, a proposed next step, and runtime results. Repeating the
same handoff is idempotent; publishing different content under the same ID fails. A comment or proposed
next step cannot silently replace the harness graph's routing rules.

## Detached execution and code handoff

The coordinator persists a dispatch intent before submission; the Modal adapter reconciles a named sandbox. Workers
claim the dispatch through task memory and publish their result there. An accepted detached worker
continues after the submitting coordinator closes its SDK client. The execution deadline bounds its
lifetime; a later event or reconciliation handles a missing completion.

The worker image needs Node.js, Git, the built Harnessfile worker and task helper, selected coding-agent
CLIs, and their tools. Both the coordinator and workers need access to task memory. Install custom
worker providers explicitly through `workerPlugins`; host plugins do not travel automatically.

Each sandbox checks out the configured committed ref. Filesystem changes are not shared between tasks.
The engineer must push a named branch and publish its URL; the reviewer must fetch that branch from the
handoff. Patch artifacts are evidence and are not automatically applied by the coordinator.

## Configure in the editor

Open **Services** in the library. Choose orchestration, execution, project management, identity, task
memory, or runtime profiles. Built-in providers expose ordinary fields; **All provider settings** accepts
opaque configuration for extensions. Identity configuration has a default account and per-agent
overrides. Secret fields contain environment variable names.

Edits change `harness.yaml` only. Other files remain byte-identical unless separately edited. Incomplete
YAML stays in a draft until applied, and malformed runtime-profile drafts are rejected. The editor does
not load executable provider modules; the host still requires explicit `--plugin` options.
