# Stateless GitLab example

This example composes `langgraph-stateless/v1`, detached Modal workers, GitLab issues and task
memory, and separate agent account mappings. All repository URLs, account IDs, and worker images are
placeholders. It does not provision accounts or deploy infrastructure.

Follow [the stateless provider guide](../../docs/stateless-orchestration-plan.md) to prepare the worker,
create the `harness-state` branch, set environment secret references, and connect authenticated events.
The engineer pushes a branch; the reviewer explicitly fetches that branch from the handoff. Sandboxes
do not share uncommitted files.

```sh
harnessfile validate examples/stateless-gitlab
harnessfile event examples/stateless-gitlab --input examples/stateless-gitlab/event.json
```

Replace the illustrative issue identity in `event.json` with a real task. For production webhook input,
pass an envelope containing exact raw `body` and request `headers`, with `--webhook`. Handoff comments
wake the coordinator only when the author matches the configured `handoffAgents` mapping. The durable
record remains the authority for whether a dispatch has completed.

For the hosted webhook receiver and automatic minute reconciliation, follow the
[Modal deployment guide](../remote-worker/STATELESS.md). Match its webhook-secret environment variable
to the `webhook.secret` reference in this example. One canonical issue key owns one workflow; reopening
a completed issue returns the prior result.
