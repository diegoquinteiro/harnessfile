# Harnessfile

An open, vendor-neutral specification for AI agent **harnesses** — the operational scaffolding around agents (triggers, gates, evals, hooks, memory, observability, security), not the agent definition itself.

> **Status:** v0.1 draft. The spec is stabilizing but not yet frozen.

## Why a harness spec?

Today every framework (LangGraph, CrewAI, AutoGen, Microsoft Agent Framework, …) defines its own format for *how* agents are orchestrated, gated, evaluated, and observed. Agent definitions move between frameworks via specs like Oracle Agent Spec; tool calls move via MCP; agent-to-agent calls move via A2A. **The harness layer has no standard.**

Harnessfile fills that gap. Define your harness once in YAML and deploy it on top of any runtime — through providers, the same way Terraform decouples infrastructure-as-code from cloud APIs.

- **Complementary** to Oracle Agent Spec (agent definition), Anthropic MCP (tools), and Google A2A (agent communication)
- **Inspired by** Terraform (declarative, provider-pluggable) and Docker Compose (simple YAML, progressive complexity)
- **Framework-agnostic**: deployable to LangGraph, CrewAI, or any custom runtime via harness providers

## Minimal example

A valid harness can be as small as this:

```yaml
harnessfile: "0.1"
agents:
  my-agent:
    model: anthropic/claude-sonnet-4-6
    instructions: Do something useful.
```

Three concepts: version, an agents map, and one agent. Everything else is optional.

## Growing the harness

Add a webhook trigger and a two-step pipeline with a human gate and an eval loop:

```yaml
harnessfile: "0.1"

agents:
  researcher:
    model: anthropic/claude-sonnet-4-6
    instructions: Research the problem space thoroughly.
    tools:
      - mcp: ./tools/web-search.json

  writer:
    model: anthropic/claude-sonnet-4-6
    instructions: Write a detailed report from the research.

steps:
  start:
    type: trigger
    event: webhook
    next: research

  research:
    agent: researcher
    next: review

  review:
    type: gate
    approve: human
    provider: slack/v1
    channel: "#approvals"
    timeout: 1h
    fallback: reject
    next: write

  write:
    agent: writer
    eval:
      - metric: llm-judge
        prompt: "Is this report complete and well-structured?"
        pass: 0.8
    max-iterations: 3
```

See [`examples/`](./examples/) for more, and [`spec/v0.1-draft.md`](./spec/v0.1-draft.md) for the full specification.

## Core ideas

- **Everything is a node in a graph.** Triggers, agents, gates, and outputs are all nodes. `next` defines the edges.
- **Polymorphic `next`.** A single edge for sequential, a list for parallel fan-out. Fan-in is implicit when multiple nodes converge on the same target.
- **Coordination patterns are first-class.** Built-in step types: `router`, `orchestrator`, `gate`, `trigger`, `output`. Pipelines and parallel execution emerge from the graph itself.
- **Providers everywhere.** Every component (gate, eval, trigger, observability, memory, security) is provider-backed. Standard interfaces; vendor extensions via `x-` fields.
- **Defaults over config.** Every field has a sensible default. Progressive disclosure — encounter complexity only when you need it.
- **Variables.** Docker Compose-style `${VAR:-default}` substitution from the environment.

## Repository layout

| Path | Contents |
|---|---|
| [`spec/v0.1-draft.md`](./spec/v0.1-draft.md) | The current draft specification |
| [`decisions.md`](./decisions.md) | Chronological design decision record |
| [`reviews/`](./reviews/) | Independent reviews of the v0.1 draft (applicability, compatibility, completeness, simplicity) |
| [`examples/`](./examples/) | Example Harnessfile YAMLs, from minimal to full pipeline |
| [`packages/cli`](./packages/cli) | CLI runtime with a LangGraph harness provider |
| [`ui`](./ui) | Visual editor (React) for Harnessfile |

## Status

v0.1 is a **draft**. It is intended to be production-usable — teams should be able to deploy against it — but breaking changes may still happen before it is frozen.

Feedback, issues, and PRs are welcome.

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
