# Harnessfile v0.1 Spec — Completeness Review

**Date**: 2026-04-09
**Scope**: Assessment of whether the v0.1 draft spec is complete enough for its stated purpose — defining the operational scaffolding around AI agents.
**Method**: Cross-referenced against 10 research areas: Oracle Agent Spec, Google A2A, Anthropic MCP, LangGraph, CrewAI, AutoGen, Terraform/Docker Compose patterns, agent security literature, error handling patterns, data flow patterns, and the existing standards landscape.

---

## Executive Summary

**The positioning is sound and the space is genuinely open.** No competing open, vendor-neutral, declarative specification exists for the full agent harness layer. The complementarity claims with MCP (tool protocol), A2A (agent communication), and Oracle Agent Spec (agent definition) are validated — there is zero scope overlap.

However, **the spec has significant completeness gaps** in areas that every comparable orchestration system considers essential. The coordination patterns are a strong foundation, but the spec is underspecified in six critical areas: data flow, error handling, security/guardrails, variables/templating, state management, and dynamic execution. These are not "nice-to-haves" — they are table-stakes for any harness that will be used in production.

**Overall verdict**: Good skeleton, incomplete muscle. The spec defines *what runs* but not *how data moves*, *what happens when things fail*, *how to keep things safe*, or *how to parameterize for different environments*.

---

## What the Spec Gets Right

### 1. Coordination Patterns (Strong)

The five patterns — router, pipeline, parallel, orchestrator, eval-loop — cover the most common multi-agent topologies. This is richer than most frameworks:

- **Router** maps to LangGraph's conditional edges and CrewAI's hierarchical process
- **Pipeline** maps to sequential execution in every framework
- **Parallel** maps to LangGraph's fan-out/fan-in and CrewAI's parallel tasks
- **Orchestrator** maps to LangGraph's supervisor pattern and AutoGen's dynamic group chat
- **Eval-loop** maps to LangGraph's cycles and AutoGen's iterative refinement

The orchestrator pattern — where the graph is not fully known at parse time — is a particularly good design decision. Most declarative specs avoid this; Harnessfile embraces it with constraints (`pool`, `max-agents`, `timeout`).

### 2. Provider Model (Strong)

The provider abstraction is well-designed and mirrors Terraform's proven approach. Every component being a provider (including agents) is the right call. The `x-` prefix convention for provider-specific fields is pragmatic.

### 3. Skills as Reusable Bundles (Good Foundation)

Skills (instructions + tools + evals) are a valuable abstraction that no other spec offers at this level. They sit at the right layer — above individual agents, below full harness definitions.

### 4. Cross-Cutting Concerns Model (Good)

Global + per-step override with additive merge is the right default. This matches how observability and hooks work in practice.

### 5. Design Principles (Strong)

"Flat over nested", "defaults over config", "interfaces over implementations" — these are the right principles for a spec competing with code-first frameworks. The Terraform/Docker Compose inspiration is evident and well-applied.

---

## Critical Gaps

### Gap 1: Data Flow Between Steps (Severity: Critical)

**The spec has no model for how data moves between steps.**

Currently, `next: step-name` connects steps but says nothing about:
- What output format the current step produces
- What input the next step expects
- How parallel branches merge their outputs
- Whether full context, summarized context, or filtered fields are passed
- Schema validation at handoff points

Every major framework addresses this:
- **LangGraph**: Typed `State` object with reducer functions for merge semantics
- **CrewAI**: Task `expected_output` declarations, context forwarding
- **AutoGen**: Message-based context with structured handoff

**What's needed**: An `output` schema declaration per step, a `context` strategy (full/summary/fields), and merge semantics for parallel fan-in.

```yaml
# Suggested addition
steps:
  research:
    agent: researcher
    output:
      schema: { type: object, properties: { findings: array, summary: string } }
    next: spec

  implement:
    type: parallel
    merge: synthesize  # or: append, vote, last-wins
    branches: ...
```

### Gap 2: Error Handling and Resilience (Severity: Critical)

**The spec has no error model whatsoever.**

Production agent systems require:
- **Retry policies**: per-step retry count, backoff strategy, retryable error classes
- **Timeouts**: per-step (partially present in orchestrator), per-pipeline, cascading
- **Fallback**: what happens when a step fails after retries (skip, substitute agent, abort pipeline)
- **Circuit breakers**: halt execution when failure rate exceeds threshold
- **Checkpointing**: resume from last successful step after failure (LangGraph's defining feature)
- **Compensation**: undo partial work when a downstream step fails (Saga pattern)

The `timeout` field exists on the orchestrator pattern but nowhere else. The `fallback` field exists on gates but not on agent steps.

```yaml
# Suggested addition — per-step resilience
steps:
  research:
    agent: researcher
    retry: { max: 3, backoff: exponential }
    timeout: 5m
    on-error: skip  # or: fallback-agent, abort, compensate
    next: spec

# Suggested addition — harness-level
resilience:
  checkpoint: true
  max-pipeline-timeout: 1h
```

### Gap 3: Security, Guardrails, and Permissions (Severity: Critical)

**The spec defines no security model for agents.**

Agents are black boxes that execute arbitrary actions. The harness is the enforcement layer. The spec should define:

- **Permissions**: What can each agent access? File system scope, network egress, tool restrictions.
- **Guardrails**: Input validation (prompt injection defense), output filtering (PII, toxicity), content policies.
- **Budget controls**: Token limits, API call rate limits, cost ceilings per step and per pipeline.
- **Secrets**: Reference-only (never inline values), with provider backend declaration.
- **Audit**: What gets logged, where, and at what verbosity.

The OWASP Agentic AI risks (2025) and Microsoft's Agent Governance Toolkit (2026) have established these as non-negotiable for production systems. The EU AI Act requires audit trails for autonomous AI systems.

```yaml
# Suggested addition
security:
  guardrails:
    input: [injection-detect, pii-redact]
    output: [pii-scrub, toxicity-filter]
  budget:
    max-tokens: 100000
    max-cost: $5.00
  audit:
    destination: stdout  # or provider
    verbosity: actions    # actions | reasoning | full

agents:
  researcher:
    permissions:
      tools: [web-search]  # explicit allowlist
      network: [*.example.com]
```

### Gap 4: Variables, Templating, and Environment Overrides (Severity: High)

**The spec has no variable system.**

Every real-world harness needs `${DATABASE_URL}` or environment-specific configuration. Without this, harnesses cannot be:
- Environment-agnostic (dev vs staging vs prod)
- Parameterized (same harness, different inputs)
- Reusable across teams

Terraform solved this with `variable` blocks, defaults, types, and validation. Docker Compose solved it with `${VAR:-default}` interpolation and `.env` files.

```yaml
# Suggested addition
variables:
  environment:
    type: string
    default: development
  model:
    type: string
    default: anthropic/claude-sonnet-4-6

agents:
  researcher:
    model: ${var.model}
```

### Gap 5: Step Dependencies and Fan-In (Severity: High)

**`next:` is a linear chain. It cannot express fan-in or conditional flow.**

Current limitations:
- No way to say "step X depends on steps A, B, and C all completing"
- No conditional edges (`if: condition` to branch without a router agent)
- No `depends_on` for implicit ordering without data flow
- Parallel branches converge via implicit fan-in to the `next:` step, but the merge behavior is undefined

LangGraph, Terraform, and Docker Compose all have explicit dependency declarations. The parallel pattern's `next:` implies fan-in but doesn't define what the downstream step receives.

```yaml
# Suggested addition — explicit fan-in
steps:
  merge:
    agent: merger
    depends_on: [frontend, backend, tests]  # waits for all
    next: review

  # Conditional edge without a router agent
  deploy:
    agent: deployer
    when: ${var.environment} == "production"
```

### Gap 6: Parameterized Skills / Modules (Severity: Medium)

**Skills are reusable but not configurable.**

You cannot write one `code-review` skill that takes a `strictness: high|low` parameter. This limits reuse — every variation requires a new skill definition. Terraform modules solved this with `variable` blocks inside modules.

```yaml
# Suggested addition
skills:
  code-review:
    params:
      strictness: { type: string, default: medium }
    instructions: |
      Review code with ${params.strictness} strictness.
    tools:
      - mcp: ./tools/github.json

agents:
  senior-dev:
    skills:
      - code-review: { strictness: high }
  junior-dev:
    skills:
      - code-review: { strictness: low }
```

---

## Secondary Gaps

### Gap 7: Dynamic Fan-Out (Severity: Medium)

The parallel pattern assumes a fixed number of branches known at design time. LangGraph's Send API / map-reduce allows the number of parallel branches to be determined at runtime from state (e.g., "run one agent per file in this list"). The orchestrator pattern partially covers this but is semantically different (one agent spawning sub-agents vs. the harness spawning N instances of the same step).

### Gap 8: State and Context Management (Severity: Medium)

The `memory` interface (`backend` + `ttl`) is too thin. It doesn't distinguish between:
- **Conversation state** — within a single pipeline run
- **Session state** — across multiple runs for the same user/thread
- **Shared state** — between agents in the same step (parallel branches)
- **Long-term memory** — persisted knowledge across unrelated runs

LangGraph's thread-scoped state isolation and CrewAI's four memory types (short-term, long-term, entity, contextual) show that "backend + ttl" is insufficient.

### Gap 9: Provider Version Pinning (Severity: Medium)

Providers are declared (`gate: slack/v1`) but there is no lockfile mechanism, no version constraint syntax (e.g., `>=1.0 <2.0`), and no way to ensure reproducible harness execution across environments. Terraform solved this with `.terraform.lock.hcl`.

### Gap 10: Human-in-the-Loop Richness (Severity: Low-Medium)

The gate pattern supports `approve: human` with channel, timeout, and fallback — but:
- No state inspection/edit by the human (LangGraph's `interrupt()` exposes full state)
- No confidence-based escalation (auto-escalate when agent confidence < threshold)
- No partial approval (approve with modifications)
- No SLA on review time beyond the timeout

### Gap 11: Hooks Specification (Severity: Low-Medium)

Hooks are mentioned (`on-error`, `after-step`) but never formally specified. What hook events exist? What data do they receive? What can they return (abort, modify, continue)? The hooks interface needs a standard contract like the other components.

### Gap 12: Composability / Imports (Severity: Low)

No mechanism to compose multiple harness files, import shared definitions, or reference external skill/agent libraries. Terraform has modules; Docker Compose has `extends` and multiple compose files. For v0.1 this may be acceptable, but the design should not preclude it.

---

## Competitive Landscape Context

| Spec/Framework | Scope | Relationship to Harnessfile |
|---|---|---|
| MCP (Anthropic/AAIF) | Tool connection protocol | Complementary — no overlap |
| A2A (Google/AAIF) | Agent communication protocol | Complementary — no overlap |
| Oracle Agent Spec | Agent definition (identity, tools, flows) | Complementary — Harnessfile wraps around it |
| Microsoft Agent Framework | Code-first SDK (not a spec) | Different approach — not competing |
| OpenAI Assistants API | Managed runtime (being deprecated) | Different layer — not competing |
| OAGS (Sekuire) | Agent governance/audit spec | Partial overlap on security/guardrails |

**The space is genuinely unoccupied.** No open, declarative spec exists for the full harness layer. This is both an opportunity and a responsibility — the spec needs to be complete enough that early adopters don't need to invent their own extensions for basic production concerns.

---

## Recommendations by Priority

### Must-Have for v0.1 (spec is incomplete without these)

1. **Data flow model** — output schemas, context passing strategy, parallel merge semantics
2. **Error handling** — retry, timeout (per-step), on-error fallback, checkpoint declaration
3. **Security primitives** — permissions, guardrails (input/output), budget controls, audit declaration
4. **Variables and environment overrides** — interpolation syntax, typed variables with defaults

### Should-Have for v0.1 (significantly weaker without these)

5. **Fan-in / conditional edges** — `depends_on`, `when` conditions
6. **Parameterized skills** — skills accept parameters for reuse
7. **Hooks formal spec** — enumerated events, contract, return behavior
8. **Richer memory model** — distinguish conversation/session/shared/long-term state scopes

### Can Defer to v0.2+ (acknowledged, not blocking)

9. Dynamic fan-out (map-reduce pattern)
10. Provider version pinning / lockfile
11. Composability / imports / multi-file harnesses
12. Human-in-the-loop state inspection/edit
13. Confidence-based auto-escalation

---

## Appendix: Sources

This review was informed by research across the following areas:

- **Protocol specs**: MCP (modelcontextprotocol.io), A2A (a2a-protocol.org), Oracle Agent Spec (github.com/oracle/agent-spec)
- **Frameworks**: LangGraph (langchain docs), CrewAI (crewai.com), AutoGen/Microsoft Agent Framework (microsoft.github.io/autogen)
- **Declarative spec patterns**: Terraform (hashicorp.com), Docker Compose (docs.docker.com)
- **Security**: OWASP Agentic AI Cheat Sheet, Microsoft Agent Governance Toolkit, OAGS (sekuire.ai)
- **Academic**: "A Survey of Agent Interoperability Protocols" (arxiv 2505.02279), "Open Agent Spec Technical Report" (arxiv 2510.04173)
- **Industry**: Linux Foundation Agentic AI Foundation (AAIF), IEEE AIS standards
