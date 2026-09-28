# Detached Modal execution and on-demand webhooks

Select `langgraph-stateless/v1` orchestration, `modal/v1` execution, GitHub or GitLab task management, and repository-backed task memory. Use the same canonical task key, state branch, and provider configuration on the host and worker. Configure the orchestration identity and each worker agent through `github-app/v1` or `gitlab-service-account/v1`; each operation uses the configured account. The worker receives only its own identity mapping and referenced secrets. Git clone/push access remains a separate credential.

The event CLI persists a dispatch intent containing a deterministic ID and absolute deadline before calling execution `submit()`. Modal creates a named sandbox with its worker bootstrap as the sandbox's entry command, so acceptance has no separate launch step that can be lost when the host exits. A lost create response is reconciled by looking up the deterministic name. The worker independently claims its dispatch in task memory using compare-and-swap before running the coding agent. Replayed or competing workers cannot execute the same claim twice. A claimed worker that is preempted requires deadline reconciliation and an explicit new dispatch ID for retry; it is not silently rerun.

`submit()` returns an acceptance receipt. Closing the originating host releases SDK connections without terminating the detached worker. The worker exits immediately after publishing and verifying its terminal handoff; its sandbox has a bounded lifetime as a fallback. The deployment includes a scheduled reconciliation invocation once per minute, using a Modal Dict that stores only unfinished task keys. It repairs missed handoff wakeups and reconciles dispatches whose deadline expired before publication. Human approval gates and terminal runs leave that index. Trusted manual reconciliation also works through `harnessfile event /path/to/repo --resume TASK_KEY --input reconcile.json` with `{}` in the input file.

The worker injects `harnessfile-task` into the runtime's PATH. `harnessfile-task tools` returns the task-memory provider's declared tools and JSON schemas, plus `task_read`/`task_comment` when a task board and identity are configured. Call a declared tool with a JSON object on stdin, for example:

```sh
harnessfile-task task_read <<<'{}'
harnessfile-task task_comment <<<'{"body":"The implementation is ready for review."}'
harnessfile-task task_memory_publish_handoff <<<'{"status":"completed","summary":"Implemented and tested the change.","artifacts":[{"url":"https://github.com/ORG/REPO/pull/123","label":"Pull request"}]}'
```

Tool names come from the selected provider's declarations; the examples above are the built-in repository task-memory names. Task key, dispatch, run, step, and agent are fixed by the injected capability scope. The worker checks for an agent-authored handoff after the runtime ends, retries its issue-note projection, and otherwise publishes the normalized runtime result. Credentials remain in the environment. Publication is verified by re-reading the authoritative memory record. GitHub installation tokens are minted/refreshed through the configured per-agent App identity; GitLab uses the agent's configured service-account token. Returned issue comments use those real accounts, not a display-name override.

## Modal webhook deployment

Build and publish the [worker image](README.md) for `linux/amd64` with the same Harnessfile revision as the host. The deployment script derives a host image from it, installs the Modal JS SDK and FastAPI, and embeds only the `.agents/` directory. A deployed host therefore uses the harness configuration captured at deployment; redeploy after configuration changes.

Install the verified `modal==1.5.5` Python SDK and FastAPI in your deployment environment, authenticate Modal, and provision a Modal Secret named `harnessfile-orchestrator` through your usual secret-management workflow. That Secret needs `HARNESSFILE_WEBHOOK_SECRET`, Modal API credentials, coding-agent credentials referenced by execution `envSecrets`, and the configured orchestration/agent identity secret references. Configure the harness PM webhook's `secret` reference to `HARNESSFILE_WEBHOOK_SECRET` so both authentication layers agree. Configure task-memory writes to a pre-created state branch with the permissions required by the chosen identities.

From the repository root:

```sh
export HARNESSFILE_WORKER_IMAGE=ghcr.io/YOUR_ORG/harnessfile-worker:provider-v1
export HARNESSFILE_WEBHOOK_PROVIDER=gitlab  # or github
export HARNESSFILE_MODAL_APP=my-repository-orchestrator
modal deploy examples/remote-worker/modal_webhook.py
```

Use a distinct `HARNESSFILE_MODAL_APP` for each deployed harness. Its reconciliation Dict defaults to `<app-name>-reconciliation`; `HARNESSFILE_RECONCILIATION_INDEX` can override that name explicitly. Do not share an index across different repositories or task-memory namespaces. `HARNESSFILE_MODAL_SECRET` chooses the Secret name and `HARNESSFILE_HARNESS_DIRECTORY` chooses the local `.agents/` directory to embed.

The returned endpoint accepts native GitLab webhook tokens or GitHub HMAC signatures. Register it for the issue and issue-note/comment event types used by the configured task provider. It checks authentication against the exact raw request body before starting Node, and the CLI checks the provider signature again. Invalid credentials do not reach the orchestration engine. The handler limits request size and does not echo tokens, request content, or subprocess output into logs/responses.

The endpoint returns HTTP 202 only after `Function.spawn` accepts a durable coordinator job, so it does not wait for sandbox provisioning or exceed the Git host's short webhook timeout. That job runs one `harnessfile event /workspace --input ... --webhook` process and exits after dispatch/checkpoint processing. Coordinator jobs use one input per container and at most one container; single-use containers release compute after each event. Retry delays span more than two minutes to recover an abandoned host lease. Repository CAS, immutable handoffs, persisted dispatch intent, and worker claims provide durable coordination across container termination, delivery retries, and redeployments. The small reconciliation index is written from CLI receipts; replaying a delivery after a coordinator crash repairs a missed index write. There is no continuously running coordinator awaiting agent completion. The webhook's completion note wakes a new invocation, with the minute scheduler as fallback.

No deployment or credentialed cloud smoke test was performed while developing this example. Offline tests cover host signature checks and acceptance, SDK submission shape and ambiguous-response recovery, detached host closure, worker claims, fallback publication, provider tool dispatch, and identity scoping. Modal API calls were checked against the published `modal@0.10.1` declarations, including named sandbox lookup, entry command, bounded lifetime, and handle detachment. Python deployment parameters were checked against the published `modal==1.5.5` wheel source, including image options, single-use containers, async function spawn, Dict operations, and retries, following the official [App](https://modal.com/docs/sdk/py/latest/App), [Image](https://modal.com/docs/sdk/py/latest/Image), and [web endpoint](https://modal.com/docs/sdk/py/latest/fastapi_endpoint) APIs.
