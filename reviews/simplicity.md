# OpenHarness v0.1 — Simplicity Review

**Date:** 2026-04-09
**Scope:** Assessment of whether the v0.1 draft spec is simple enough for its purpose, with design critiques focused on concept count, progressive disclosure, and adoption readiness.

---

## Executive Summary

The spec occupies a genuinely unclaimed position: a declarative, file-first format for the operational scaffolding around AI agents. No existing spec (Oracle Agent Spec, CrewAI, LangGraph, A2A, Microsoft Agent Framework) does this. The positioning is strong and the design principles are sound.

**However, the v0.1 draft carries ~17 named concepts — roughly 3-4x what successful specs ship at launch.** Docker Compose v1 had 4 concepts. GitHub Actions launched with 4. CloudEvents launched with 4 required attributes. OpenAPI/Swagger 1.x had 5 core objects. The research is consistent: specs that win adoption launch with 4-6 core concepts and expand from there.

The spec's own design principles ("defaults over config", "implicit -> conventional -> explicit", "flat over nested") are excellent — but the current draft violates all three. The principles describe a spec that doesn't exist yet; the draft describes a spec that's 2-3 versions ahead of where it should be.

**Verdict: The architecture is right. The scope is wrong for v0.1.**

---

## Issue #1: The Spec Never Shows Its Simplest Form

**Severity: Critical**

The only example in the spec is a 130-line Jira feature pipeline with 10 agents, 8 steps, 5 coordination patterns, skills, providers, gates, and evals. There is no minimal example anywhere.

By the spec's own rules, this should be a valid harness:

```yaml
harness: "0.1"
agents:
  my-agent:
    model: anthropic/claude-sonnet-4-6
    instructions: Do something useful.
```

Three concepts: version, agents map, one agent definition. That matches Docker Compose and Terraform at their simplest. But this minimal path is invisible — it's never shown, never validated, never discussed.

**Comparison of "hello world" concept counts:**

| Spec | Concepts needed | Minimal file |
|---|---|---|
| Docker Compose | 2 (`services`, one service) | 3 lines |
| GitHub Actions | 3 (`on`, `jobs`, one step) | 6 lines |
| Terraform | 2 (`resource` + type) | 3 lines |
| OpenHarness (implied) | 3 (`harness`, `agents`, one agent) | 4 lines |
| OpenHarness (as shown) | 9+ top-level keys, 5 patterns | 130 lines |

**Recommendation:** Add a "Minimal example" section immediately after "Design principles", showing the 4-line harness above. Then show 2-3 progressively larger examples before the full one. The minimal case must be the first thing a reader sees.

---

## Issue #2: Too Many Coordination Patterns for v0.1

**Severity: High**

The spec defines 5 named coordination patterns: router, pipeline, parallel, orchestrator, and eval-loop. Research into workflow systems (BPMN, Temporal, Step Functions, Argo) shows they all converge on 2-3 irreducible primitives: sequential transition, fork/join, and conditional branch.

- **Router** = conditional branch. Keep.
- **Pipeline** (`next:`) = sequential transition. Keep.
- **Parallel** = fork/join. Keep.
- **Orchestrator** = dynamic graph at runtime. The spec itself notes this is "the only pattern where the graph is not fully known at parse time." That exception warrants its own version.
- **Eval-loop** = retry with eval. This is not a coordination pattern — it's a step modifier. A step with `eval:` + `max-iterations: 3` expresses the same thing without a new `type`.

The full example already nests `eval-loop` inside `parallel` branches, proving it behaves as a step property, not a peer-level pattern.

**Recommendation:** Ship 3 patterns in v0.1 (router, pipeline, parallel). Collapse eval-loop into `eval` + `max-iterations` on any step. Mark orchestrator as reserved/experimental or defer to v0.2.

---

## Issue #3: Skills Are Premature Abstraction

**Severity: High**

Skills bundle instructions + tools + evals into a reusable unit. This concept has three problems:

1. **No demonstrated need.** The spec has no example requiring the same skill across 3+ agents. Docker Compose had no reuse primitive at v1 — it added extension fields only after real-world duplication patterns emerged.

2. **Coupling risk.** Bundling three orthogonal concerns (instructions, tools, evals) into one unit prevents mix-and-match. An agent may want the tools from `code-review` but a different eval metric. The bundle forces forking to customize.

3. **Contradicts the black-box claim.** The spec's core thesis is "agents are black boxes — the harness is everything around them." But skills inject `instructions` directly into agent definitions, which is reaching inside the box. This isn't a minor tension — it undermines the architectural premise.

Simpler alternatives exist: YAML anchors (`&code-review` / `*code-review`), file imports (`$ref: ./skills/code-review.yaml`), or just inline duplication of the few fields involved. All work with zero new spec concepts.

**Recommendation:** Drop `skills` from v0.1. Revisit in v0.2 once real harness files reveal which fields actually get duplicated and in what combinations.

---

## Issue #4: The Provider Model Is Premature

**Severity: High**

The spec declares providers at the top level:

```yaml
providers:
  gate: slack/v1
  eval: pytest/v1
  trigger: jira/v1
  observe: langfuse/v1
```

This violates the spec's own "implicit -> conventional -> explicit" principle. The principle promises zero config for simple cases, but the full example immediately shows four provider declarations. A new user must understand the provider registry before running their first harness.

Worse, the abstraction leaks immediately: Jira-specific filter syntax (`project = ENG AND type = Story`) appears in trigger definitions. Slack-specific channel notation (`#approvals`) appears in gates. A "vendor-neutral swap" is not actually transparent.

**How comparable specs handled this:**

- **Docker Compose:** Never had a provider model. Hardcoded Docker. Added `x-` extensions later.
- **GitHub Actions:** `uses: owner/repo@version` inline at point of use, not in a top-level registry.
- **Terraform:** Providers from day one, but justified because you genuinely cannot infer AWS from field values alone.

**Recommendation:** Drop the top-level `providers:` block from v0.1. Let runtimes infer providers from field values (the "conventional" layer the spec already describes). If explicit provider declarations are needed, use inline `via:` at the point of use. Add the full provider registry in v0.2 when real ambiguity cases emerge.

---

## Issue #5: Gate/Eval Asymmetry

**Severity: Medium**

Gates and evals have inconsistent representation:
- Gates are first-class step types (`type: gate`)
- Evals are properties on steps (`eval:`)
- Eval-loop is a coordination pattern (`type: eval-loop`)

This asymmetry implies semantic differences that are never explained. A reader will ask: "Why can't I write `type: eval`?" The answer (an eval alone doesn't produce output — it only validates) is valid but invisible from the syntax.

Additionally, `approve: auto` gates are structurally identical to evals. Removing auto-gates and letting `type: gate` mean "human approval only" would sharpen the boundary.

**Recommendation:**
- Gate = human approval only. Remove `approve: auto`.
- Eval-loop collapses into `eval` + `max-iterations` on any step (see Issue #2).
- Either elevate eval to a step type or explicitly document why it's a property, not a type.

---

## Issue #6: The "Black Box" Framing Is Half-True

**Severity: Medium**

The spec claims "agents are black boxes" but then defines agent internals:

```yaml
agents:
  classifier:
    model: anthropic/claude-haiku-4-5
    instructions: Classify the Jira ticket.
    tools:
      - mcp: ./tools/github.json
    skills: [code-review]
```

This is not a black box. This is agent definition. The spec says the built-in agent format "has no special status" — but it occupies its own named interface section, appears in every example, and is the default when no provider is declared. It has de-facto first-class status.

**The two clean paths:**

- **Option A (commit to black boxes):** Agents are only references (`agent: oracle://classifier`). The harness owns the graph, gates, evals, triggers. This matches Kubernetes (references images, doesn't define what's inside).
- **Option B (own the agent definition):** Drop the "black box" claim. This is a complete agent + harness format. Skills and inline instructions make sense here.

The current spec tries to be both, which makes neither claim accurate.

**Recommendation:** For v0.1, keep the inline agent convenience format but reframe the language. Replace "agents are black boxes" with something like "agents can be defined inline or referenced from external specs." Move the built-in agent format to a clearly-marked convenience section, not the architectural framing. Reserve the term "black box" for externally-referenced agents only.

---

## Issue #7: Observability and Memory as Top-Level Blocks

**Severity: Low**

Both `observability:` and `memory:` are top-level blocks with 2 fields each:

```yaml
observability:
  tracing: langfuse
  metrics: datadog

memory:
  backend: postgres
  ttl: 24h
```

Docker Compose kept cross-cutting concerns implicit (one default network, no built-in logging key at the top level). Making these explicit at the top level adds cognitive overhead before the user has shipped anything.

**Recommendation:** These are fine as optional blocks, but they should not appear in any introductory example and should be documented as advanced configuration. The defaults (tracing: off, no persistent memory) should be explicit in the spec text.

---

## Competitive Landscape Context

| Spec | Layer | Concepts | Declarative? |
|---|---|---|---|
| Oracle Agent Spec | Agent internals | 8-12 | Yes (YAML/JSON) |
| Microsoft Agent Framework | Agent + orchestration | 10-15 | Partial (YAML + code) |
| CrewAI | Multi-agent roles | 6-8 | Partial (YAML + Python) |
| LangGraph | Graph execution | 8-12 | No (Python only) |
| Google A2A | Communication protocol | 4-6 | N/A (protocol) |
| **OpenHarness (current)** | **Harness scaffolding** | **~17** | **Yes** |
| **OpenHarness (proposed)** | **Harness scaffolding** | **~7-8** | **Yes** |

OpenHarness is the only declarative, file-first spec for the harness layer. That's a real gap worth filling. But at 17 concepts it risks becoming the SOAP of agent orchestration — powerful but unapproachable. At 7-8 concepts it could be the REST.

---

## Proposed v0.1 Concept Budget

**Keep (core, ~7 concepts):**

| Concept | Rationale |
|---|---|
| `harness` (version) | Parser needs this — unavoidable |
| `agents` | The things being orchestrated — unavoidable |
| `steps` | Execution flow — the verb of the spec |
| `trigger` | Entry point — without this, nothing starts |
| `hooks` | Extensibility escape hatch |
| `gate` (human approval) | Human-in-the-loop is a core differentiator |
| `eval` (as step property) | Quality checks are central to agent orchestration |

**Keep but simplify:**
- 3 coordination modes on steps: `router`, pipeline (`next:`), `parallel`
- Eval as step property with optional `max-iterations` (replaces eval-loop)

**Defer to v0.2:**

| Concept | Reason to defer |
|---|---|
| `skills` | Premature abstraction, contradicts black-box framing |
| `providers` (top-level block) | Premature extensibility, use conventions for now |
| `orchestrator` pattern | Dynamic graphs need runtime semantics not yet designed |
| `memory` (top-level block) | Only 2 fields, can be a provider concern |
| `observability` (top-level block) | Only 2 fields, can be a provider concern |
| `approve: auto` gates | Redundant with evals |

---

## Lessons from Successful Specs

1. **Docker Compose:** Minimal case was 3 lines on day one. Advanced features were additive. Top-level key count stayed disciplined for a decade.

2. **Terraform:** Provider model worked because the contract surface was minimal and stable. Escape hatches (`depends_on`, `dynamic` blocks) signaled core model gaps. "Zero-config defaults" was enforced — every optional field had a sensible default.

3. **CloudEvents:** Launched with 4 required attributes. Deliberately spec-minimal. Extensions came later.

4. **OpenAPI/Swagger:** Won because it described something developers already had (REST APIs). Core objects stayed at ~5 for the first version.

5. **What killed SOAP:** Not lack of features but mandatory complexity. Every interaction required contracts, envelopes, namespaces, and tooling before anything could work.

**The pattern is unanimous:** Launch with the minimum that makes the core value proposition demonstrable. Extensions, advanced patterns, and power-user features come in v0.2+.

---

## The One-Sentence Test

> Can a developer write a working harness config after reading a single README section?

If the answer requires understanding eval-loops, orchestrator patterns, skills, and the provider registry — the v0.1 has already failed the adoption test. The proposed simplification passes this test. The current draft does not.
