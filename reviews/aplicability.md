# OpenHarness v0.1 Draft — Applicability Review

**Date:** 2026-04-09
**Scope:** Full review of spec/v0.1-draft.md against the current AI agent ecosystem, assessing whether the spec is applicable enough for its stated purpose.
**Method:** 10 parallel research agents investigated: Oracle Agent Spec, Google A2A, LangGraph, CrewAI, AutoGen/Microsoft Agent Framework, Anthropic MCP, Terraform/Docker Compose design patterns, competing agent specs, eval frameworks, and agent observability tools.

---

## Executive Summary

**The spec fills a genuine gap.** No existing open standard covers the full harness layer — declarative triggers, human gates, eval-loops, multi-pattern coordination, hooks, and memory — in a vendor-neutral, provider-pluggable format. The positioning as complementary to agent definition specs (Oracle Agent Spec, Microsoft AgentSchema) and communication protocols (A2A, MCP) is accurate and well-founded.

However, the spec has **five concrete applicability issues** that would limit real-world adoption. Three are structural design problems, two are interface gaps. All are fixable within the v0.1 timeframe.

**Verdict: Strong concept, valid positioning, needs targeted fixes before it can credibly claim to be applicable to real-world agent orchestration.**

---

## 1. Positioning Validation

### 1.1 Complementarity Claims — All Verified

| Claim in spec | Status | Evidence |
|---|---|---|
| Complementary to Oracle Agent Spec | **Confirmed** | Oracle Agent Spec defines agent identity, LLM config, tool definitions, and flow composition. It explicitly delegates runtime execution to adapters and defines nothing about triggers, guardrails, hooks, memory, evals, or observability. The boundary is clean. |
| Complementary to Microsoft AgentSchema | **Confirmed** | `github.com/microsoft/AgentSchema` is a real, active repo — a vendor-neutral declarative schema for agent identity, instructions, tools, and connections. It does not cover operational scaffolding. |
| Complementary to Google A2A | **Confirmed** | A2A is strictly a wire-level communication protocol (JSON-RPC 2.0 over HTTP/SSE). It defines task handoff contracts between agents, not workflow topology, routing logic, or harness concerns. |
| Complementary to Anthropic MCP | **Confirmed** | MCP defines tool/resource/prompt access. Its Nov 2025 expansion (sampling, elicitation) edges into server-level orchestration but does not cover triggers, guardrails, hooks, memory, or deployment topology. The `mcp: ./tools/file.json` syntax in OpenHarness maps directly to the widely adopted `mcpServers` JSON config format. |

### 1.2 Competitive Landscape — Genuine Gap Exists

| Spec/Platform | What it covers | What it misses (that OpenHarness covers) |
|---|---|---|
| Oracle Agent Spec | Agent definition, flow composition, tracing hooks | Triggers, human gates with fallbacks, eval-loops, memory backends, hook lifecycle |
| Agent Formation Spec (AFS) | Agent and tool declaration, MCP/A2A references | Orchestration patterns, triggers, gates, evals, hooks |
| Microsoft Foundry Workflows | Sequential, group-chat, human-in-the-loop (YAML) | Vendor-locked to Azure — not portable |
| Anthropic Agent Skills (SKILL.md) | Reusable skill packaging | No workflow orchestration, triggers, gates, or evals |
| AWS Bedrock AgentCore | Runtime platform | Not a portable spec |

**No existing open spec covers the full harness layer that OpenHarness targets.** The gap is real.

---

## 2. Framework Mapping Assessment

### 2.1 Can the spec actually deploy to target runtimes?

| OpenHarness Pattern | LangGraph | CrewAI | AutoGen/MAF |
|---|---|---|---|
| `pipeline` | Clean 1:1 (sequential edges) | Clean 1:1 (sequential process / Flow `@listen`) | Clean 1:1 (sequential workflow) |
| `router` | Clean 1:1 (`add_conditional_edges`) | Maps to Flow `@router` decorator | Maps to Handoff pattern |
| `parallel` | Clean 1:1 (fan-out superstep) | Partial — requires Flow `@listen(AND(...))`, Python-only | Clean 1:1 (concurrent workflow) |
| `orchestrator` | Good (nested subgraphs / supervisor) | Maps to `hierarchical` crew with manager | Good (Magentic One pattern) |
| `eval-loop` | **No native primitive** — must be a conditional back-edge | **No native primitive** — must be hand-built in Flow | **No native primitive** — custom loop |
| Human gates | Good (breakpoints + checkpointer) | Partial (human input tool, not a gate concept) | Good (pending approval events) |
| Memory | Good (pluggable checkpointer) | Partial (`memory=True`, coarse-grained) | Good (pluggable state) |

### 2.2 Key Finding: eval-loop Is the Differentiator — and the Risk

The `eval-loop` pattern has no native equivalent in any major framework. This is simultaneously OpenHarness's strongest differentiator and its biggest mapping challenge. Every runtime adapter must synthesize an eval-loop from lower-level primitives (conditional edges, retry logic, scorer functions). The spec should acknowledge this explicitly and provide guidance for adapter implementors.

### 2.3 Key Finding: No Framework Has a Declarative YAML Layer

Neither LangGraph, CrewAI (for orchestration), nor AutoGen/MAF define workflows in YAML. LangGraph is pure Python/TypeScript graph construction. CrewAI uses YAML for agent/task definitions but requires Python for routing, parallel execution, and loops. MAF has a new "declarative workflows" feature but it's early.

**This means OpenHarness becomes the YAML abstraction that runtime adapters must compile into framework-specific code.** This is the intended role, but the spec should be explicit about the compilation/interpretation boundary.

---

## 3. Structural Design Issues

### 3.1 CRITICAL: The Spec Violates Its Own Nesting Principle

**Design principle #1 states: "Flat over nested — max 3 levels of indentation."**

The full example's `implement` step violates this:

```yaml
steps:                          # level 1
  implement:                    # level 2
    branches:                   # level 3
      frontend:                 # level 4
        eval:                   # level 5
          - metric: tests-pass  # level 6
```

This is 6 levels deep. The spec's flagship example breaks its own first principle.

**Recommendation:** Flatten nested coordination patterns into named top-level steps with `next:` references:

```yaml
steps:
  implement:
    type: parallel
    branches:
      frontend: frontend-impl
      backend: backend-impl
      tests: tests-impl
    next: code-review

  frontend-impl:
    type: eval-loop
    agent: frontend-dev
    eval:
      - metric: tests-pass
      - metric: lint-pass
    max-iterations: 3

  backend-impl:
    type: eval-loop
    agent: backend-dev
    eval:
      - metric: tests-pass
      - metric: coverage
        pass: 80%
    max-iterations: 3
```

This keeps the graph readable, respects the 3-level limit, and follows the same pattern Docker Compose and Terraform used to stay flat.

### 3.2 IMPORTANT: No State Schema Concept

LangGraph's entire execution model revolves around a typed state object (`TypedDict`/`Zod`) that flows through all nodes. CrewAI uses task `context` references. AutoGen/MAF uses shared state.

**The spec has no concept of what data flows between steps.** How does the `research` step's output reach the `spec` step? How does `shared-context: true` work in practice? What schema does the parallel merge produce?

Without this, runtime adapters must guess or impose their own conventions, breaking portability.

**Recommendation:** Add an optional `state` or `context` section that declares the shape of data flowing through the graph:

```yaml
state:
  ticket: string          # from trigger
  research: text          # produced by research step
  spec: text              # produced by spec step
  plan: text              # produced by plan step
```

This can remain optional (convention: steps pass their full output to `next`), but the escape hatch must exist for non-trivial workflows.

### 3.3 IMPORTANT: Implicit Provider Resolution Is Fragile

The spec states: `channel: "#approvals"` implies Slack. This is the kind of "magic" that Docker Compose carefully avoided. It creates hidden coupling between field values and provider resolution, which will break in environments where `#channel` syntax is used by other systems (Microsoft Teams channels also use `#` prefixes).

**Recommendation:** Either require explicit provider declarations for all components, or document the resolution rules as a formal algorithm (not just examples). The Terraform model is instructive: providers are always explicit in real-world usage, even though `terraform init` can auto-detect some.

---

## 4. Interface Gaps

### 4.1 Eval Interface Is Too Simplistic

The current eval interface:

```yaml
metric: string
pass: number | string
prompt: string
dataset: string
```

**What's missing for real-world applicability:**

| Gap | Why it matters | Prevalence in real tools |
|---|---|---|
| No scorer type (`llm`, `code`, `human`) | Code-based scorers are 100x cheaper and deterministic. Forcing everything into LLM-as-judge is wasteful. | Every major platform distinguishes these (Braintrust, DeepEval, LangSmith) |
| Single metric per eval block | Real evals run multiple scorers simultaneously on each test case | Universal — all platforms support multi-metric evals |
| No `expected` field for ground truth | Correctness evals need expected output; property evals don't | Standard in Braintrust, DeepEval, LangSmith datasets |
| No online vs. offline designation | Production sampling vs. CI regression testing have different requirements | Emerging as a standard distinction |
| Ambiguous `pass` semantics | `pass: 0.8` — is that a minimum score? An average? Per-item or aggregate? | All platforms are explicit about aggregation |

**Recommendation:** Expand the eval interface minimally:

```yaml
eval:
  - metric: tests-pass
    type: code                    # code | llm | human
    pass: true                    # threshold

  - metric: quality
    type: llm
    prompt: "Rate the quality of this spec on a 0-1 scale."
    pass: 0.8                     # minimum score
    aggregate: mean               # mean | min | all

  - metric: correctness
    type: code
    dataset: ./evals/spec-cases.jsonl
    expected: output              # field name in dataset
    pass: 0.9
```

This remains flat and readable but can express real-world eval patterns.

### 4.2 Observability Interface Is Too Minimal

The current interface:

```yaml
tracing: string    # provider name
metrics: string    # provider name
```

**What's missing:**

| Gap | Why it matters |
|---|---|
| No sampling rate | Tracing everything in production is cost-prohibitive for high-volume agents |
| No level/granularity control | Users need to control whether to trace every LLM call, every step, or just the harness run |
| No per-step scoping | The spec supports per-step hooks/evals but observability cannot be scoped per-step |

OpenTelemetry GenAI semantic conventions are emerging (experimental as of 2026) as the standard for AI agent tracing, with first-class support in Datadog, Langfuse, and Arize. The spec should align with this direction.

**Recommendation:** Minimal extension:

```yaml
observability:
  tracing: langfuse
  metrics: datadog
  sampling: 0.1         # 0.0-1.0, default 1.0
  level: steps           # calls | steps | full
```

This keeps the "defaults over config" principle (everything optional except provider name) while addressing the most common real-world gap.

---

## 5. Design Principles Assessment

| Principle | Assessment |
|---|---|
| **Flat over nested** | **Violated** in the full example. Fixable by flattening parallel+eval-loop nesting into named steps. |
| **Defaults over config** | **Well applied.** The spec works with minimal config and overrides are optional. |
| **Implicit > conventional > explicit** | **Mostly good**, but implicit provider resolution (e.g., `#channel` = Slack) is fragile. Needs explicit resolution rules. |
| **Interfaces over implementations** | **Well applied.** Provider model is clean and mirrors Terraform's success pattern. |
| **Spec is the graph, providers are the nodes** | **Well applied.** The clear separation is the spec's strongest architectural decision. |

---

## 6. Terraform/Docker Compose Alignment

The spec explicitly draws inspiration from Terraform (provider model) and Docker Compose (simple YAML). Assessment:

### What it got right (from Terraform):
- **Provider model as an open ecosystem** — `gate: slack/v1`, `trigger: jira/v1` mirrors Terraform's provider plugin system
- **Extension fields** — `x-` prefix for provider-specific fields mirrors Terraform's `lifecycle` blocks
- **Skills as modules** — reusable bundles mirror Terraform modules

### What it got right (from Docker Compose):
- **One-file definition** — `harness.yaml` as the single entry point
- **Top-level keys** — `agents`, `steps`, `providers`, `skills` are clean top-level sections
- **No templating language** — no Jinja, no Go templates, no logic in YAML

### What it's missing:
- **No state/plan equivalent** — Terraform's killer feature was `terraform plan` (dry-run diff). The spec has no concept of state, making plan/diff impossible. This limits debuggability and confidence.
- **No import/include mechanism** — Docker Compose has `extends` and multi-file merging. For large harnesses, a single file will become unwieldy. Consider an `include` mechanism for v0.2.
- **Nesting violation** — Docker Compose never exceeded 3 levels in practice. The full example hits 6. This is the #1 thing to fix.

---

## 7. Summary of Recommendations

### Must Fix (blocks credible applicability claim):

1. **Flatten the full example** — nested parallel+eval-loop must become named top-level steps with references. The spec cannot violate its own first principle.
2. **Expand the eval interface** — add `type` (code/llm/human), support multiple metrics per eval, add `expected` for ground truth evals. The current interface can only express LLM-as-judge, which is one pattern among several.

### Should Fix (limits real-world adoption):

3. **Add a state/context concept** — even optional, the spec needs a way to declare what data flows between steps. Without it, runtime adapters cannot implement `shared-context` or step-to-step data passing portably.
4. **Make provider resolution explicit** — remove implicit resolution (e.g., `#channel` = Slack). Require explicit provider declarations or document formal resolution rules.
5. **Extend observability minimally** — add `sampling` and `level` fields. Provider name alone is insufficient for production deployments.

### Consider for v0.2:

6. **Add an include/import mechanism** for multi-file harnesses.
7. **Define the compilation boundary** — the spec is a declarative YAML that runtime adapters compile into framework-specific code. Make this explicit and provide adapter implementation guidance.
8. **Align observability with OTel GenAI semantic conventions** — they're experimental now but clearly becoming the standard.

---

## Sources

### Oracle Agent Spec
- [GitHub - oracle/agent-spec](https://github.com/oracle/agent-spec)
- [Introducing the Open Agent Specification — Oracle Blog](https://blogs.oracle.com/ai-and-datascience/introducing-open-agent-specification)
- [Open Agent Specification Technical Report (arXiv)](https://arxiv.org/html/2510.04173v2)

### Google A2A
- [Agent2Agent (A2A) Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [Announcing A2A — Google Developers Blog](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- [What Is A2A? — IBM](https://www.ibm.com/think/topics/agent2agent-protocol)

### LangGraph
- [LangGraph Overview — LangChain Docs](https://docs.langchain.com/oss/python/langgraph/overview)
- [Human-in-the-Loop AI Agents in LangGraph — GrowwStacks](https://growwstacks.com/blog/human-in-the-loop-ai-agents-langgraph)
- [Building Parallel Workflows with LangGraph — GoPenAI](https://blog.gopenai.com/building-parallel-workflows-with-langgraph-a-practical-guide-3fe38add9c60)

### CrewAI
- [Flows — CrewAI Docs](https://docs.crewai.com/en/concepts/flows)
- [YAML Configuration — DeepWiki](https://deepwiki.com/crewAIInc/crewAI/8.2-yaml-configuration)
- [Memory — CrewAI Docs](https://docs.crewai.com/en/concepts/memory)

### Microsoft AutoGen / Agent Framework
- [GitHub - microsoft/AgentSchema](https://github.com/microsoft/AgentSchema)
- [Microsoft Agent Framework v1.0 Release](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/)
- [Microsoft Agent Framework Overview — Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/overview/)

### Anthropic MCP
- [MCP Specification (Nov 2025)](https://modelcontextprotocol.io/specification/2025-11-25)
- [Donating MCP to the Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)
- [Why the Model Context Protocol Won — The New Stack](https://thenewstack.io/why-the-model-context-protocol-won/)

### Declarative Spec Design
- [Docker Compose Specification](https://www.compose-spec.io/)
- [The YAML Abyss: Configuration as Code Failure — AllClearStack](https://allclearstack.com/blog/the-yaml-abyss-configuration-as-code-failure)

### Eval Frameworks
- [Top 5 Platforms for Agent Evals in 2025 — Braintrust](https://www.braintrust.dev/articles/top-5-platforms-agent-evals-2025)
- [Agent Evaluation — Braintrust](https://www.braintrust.dev/articles/agent-evaluation)
- [AI Agent Evaluation Metrics — DeepEval](https://deepeval.com/guides/guides-ai-agent-evaluation-metrics)
- [Getting Started with Cortex Agent Evaluations — Snowflake](https://www.snowflake.com/en/developers/guides/getting-started-with-cortex-agent-evaluations/)

### Observability
- [AI Agent Observability — OpenTelemetry Blog](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [OTel Semantic Conventions for GenAI Agent Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [Datadog LLM Observability + OTel GenAI Semantic Conventions](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [Observability for CrewAI with Langfuse](https://langfuse.com/docs/integrations/crewai)

### Competing Specs
- [Agent Formation Specification — GitHub](https://github.com/agent-formation)
- [Microsoft Foundry Multi-Agent Workflows](https://devblogs.microsoft.com/foundry/introducing-multi-agent-workflows-in-foundry-agent-service/)
