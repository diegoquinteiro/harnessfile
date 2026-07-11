# Harnessfile

An open, vendor-neutral specification for AI agent **harnesses** — the operational scaffolding around agents (triggers, gates, squads, routing, evals, hooks, memory, observability, security), not the agent definition itself.

> **Status:** v0.2 draft — a pivot from a single YAML file to the `.agents/` directory. See [`spec/v0.2-draft.md`](./spec/v0.2-draft.md) and decisions D39–D49 in [`decisions.md`](./decisions.md).

## Why a harness spec?

The industry standardized the layers around the harness: **AGENTS.md** won project guidance, **Agent Skills (SKILL.md)** won skills, **MCP** connects agents to tools, **A2A** connects agents to agents. But the harness itself — the graph of agents and squads, the triggers, the human gates, the routing, the ownership boundary between what is versioned and what the platform runs — remains proprietary in every tool and platform.

Harnessfile fills that gap. Define your harness once, as files in your repo, and:

- **`harnessfile sync`** — compile/push the definition to the environments you use: Multica, Claude Code, Cursor, Codex, Gemini CLI, GitHub Agent HQ — honoring each target's ownership of operational config (model, runtime, secrets).
- **`harnessfile up`** — run the harness headless, bound to the systems your team already has in production (Jira, Linear, GitHub, Slack) — no new UI to adopt.

Design lineage: Terraform (declarative, provider-pluggable), Docker Compose (simple, progressive complexity).

- **Complementary** to AGENTS.md (guidance), Agent Skills (skills), Oracle Agent Spec (agent definition), MCP (tools), A2A (agent communication)
- **Adopts what won**: SKILL.md and AGENTS.md are used unchanged; agent role cards follow the Markdown+frontmatter convention Claude Code, Cursor, and Gemini CLI already read
- **Specifies what didn't exist**: `harness.yaml`, squads, scheduled triggers, target ownership

## Minimal example

A harness is the `.agents/` directory. The smallest useful one is two files:

```yaml
# .agents/harness.yaml
harnessfile: "0.2"
name: sentry-triage

triggers:
  hourly-sweep:
    schedule: "0 * * * *"
    prompt: Run a Sentry triage sweep. File genuine bugs only.
    next: triage
steps:
  triage:
    agent: triager
```

```markdown
<!-- .agents/agents/triager.md -->
---
name: triager
description: Triages Sentry issues into actionable bug reports.
model: anthropic/claude-sonnet-4-6
---
You triage Sentry issues. Deduplicate by issue id, ignore noise, file genuine bugs to the backlog.
```

## Core ideas

- **The spec is a directory.** `harness.yaml` + `agents/*.md` + `skills/*/SKILL.md` + `squads/*.md`, versioned and reviewed like code.
- **Everything is a node in a graph.** Triggers, agents, squads, gates, and outputs are nodes; polymorphic `next` defines edges; fan-in is implicit.
- **Squads are agent-compatible.** A squad (leader + members + orchestration instructions) can be used anywhere an agent can. Explicit graphs and leader-orchestration coexist.
- **Definition is portable; operations belong to the environment.** Targets declare which fields they `own`; sync seeds them at bootstrap and never overwrites them. Secrets are never in the repo.
- **Providers everywhere.** Every component — trigger, gate, eval, memory, observability, target — is provider-backed with standard interfaces.
- **Defaults over config, progressive disclosure.**

## Repository layout

| Path | Contents |
|---|---|
| [`spec/v0.2-draft.md`](./spec/v0.2-draft.md) | The current draft specification |
| [`spec/v0.1-draft.md`](./spec/v0.1-draft.md) | Superseded; extended reference for the graph model and interfaces |
| [`decisions.md`](./decisions.md) | Chronological design decision record |
| [`reviews/`](./reviews/) | Reviews of the v0.1 draft + 2026-07 industry research |
| [`examples/`](./examples/) | Examples (v0.1 format; v0.2 examples in progress) |
| [`packages/cli`](./packages/cli) | CLI runtime with a LangGraph harness provider (being adapted to v0.2) |
| [`ui`](./ui) | Visual editor (React) — frozen until the v0.2 spec stabilizes |

## Status

v0.2 is a **draft**. The first implementation milestone is expressing a real production harness (a 9-agent development squad with risk×ambiguity routing) and syncing it to Multica, Claude Code, Cursor, and Codex.

Feedback, issues, and PRs are welcome.

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
