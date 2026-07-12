# Harnessfile

## Language

All project documents, code comments, commit messages, issues, and PRs must be written in English. No exceptions.

## Project context

This project defines an open, vendor-neutral specification for AI agent harnesses — the operational scaffolding around agents (triggers, guardrails, hooks, memory, evals, observability), NOT the agent definition itself.

Agents can be defined inline for convenience or referenced from external specs via providers. The harness owns the graph and the rules — not the agent internals.

## Positioning

- Complementary to Oracle Agent Spec (agent definition) and Google A2A / Anthropic MCP (communication protocols)
- Inspired by Terraform (declarative, provider-agnostic) and Docker Compose (simple YAML, progressive complexity)
- The spec must be framework-agnostic: deployable to LangGraph, CrewAI, or any custom runtime

## Decision record

All design decisions are tracked in `decisions.md`. When the user makes a new decision:

1. Add it to `decisions.md` with the next D-number
2. If it supersedes a previous decision, redact the old one with `[redacted by Dxx]`
3. Check for contradictions with existing decisions and ask the user to resolve them
4. Update `spec/v0.1-draft.md` to reflect the decision
