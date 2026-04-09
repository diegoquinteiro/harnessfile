# OpenHarness

An open standard for defining AI agent harnesses using YAML or JSON.

## What is an Agent Harness?

An agent harness is the scaffolding that surrounds an LLM agent — the configuration that defines its tools, memory, routing logic, guardrails, and orchestration. Today, every framework (LangGraph, CrewAI, AutoGen, etc.) uses its own proprietary format, making agent definitions non-portable.

**OpenHarness** provides a vendor-neutral schema so you can define your agent harness once and deploy it anywhere.

## Goals

- **Tool-agnostic**: Define agent harnesses independently of any specific framework or runtime
- **Portable**: Deploy the same harness definition to LangGraph, LangFuse, CrewAI, or your own runtime
- **Composable**: Build complex multi-agent systems from simple, reusable harness definitions
- **Versionable**: Harness definitions are plain text files that live in your repo alongside your code

## Schema

The schema is defined in [`schema/`](./schema/) and supports both YAML and JSON.

See [`examples/`](./examples/) for sample harness definitions.

## Status

This project is in early development. The schema is not yet stable.

## License

Apache 2.0
