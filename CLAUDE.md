# OpenHarness

## Language

All project documents, code comments, commit messages, issues, and PRs must be written in English. No exceptions.

## Project context

This project defines an open, vendor-neutral specification for AI agent harnesses — the operational scaffolding around agents (triggers, guardrails, hooks, memory, evals, observability), NOT the agent definition itself.

Agents are treated as black boxes — defined elsewhere (Oracle Agent Spec, Microsoft AgentSchema, custom, or inline minimal definition). This spec defines everything around the agent.

## Positioning

- Complementary to Oracle Agent Spec (agent definition) and Google A2A / Anthropic MCP (communication protocols)
- Inspired by Terraform (declarative, provider-agnostic) and Docker Compose (simple YAML, progressive complexity)
- The spec must be framework-agnostic: deployable to LangGraph, CrewAI, or any custom runtime
