# Harnessfile v0.1 — Industry Compatibility Review

**Date:** 2026-04-09
**Scope:** Assessment of Harnessfile spec v0.1 draft against major industry agent frameworks, cloud providers, protocols, and declarative infrastructure patterns.

**Methodology:** 10 parallel research agents covering LangGraph, CrewAI, AutoGen/AG2, Oracle Agent Spec, A2A/MCP protocols, OpenAI, Anthropic, eval frameworks, AWS/Google Cloud, and declarative infrastructure patterns (Terraform, Docker Compose, GitHub Actions).

---

## Executive Summary

The Harnessfile spec is **well-positioned** in the ecosystem. Its core abstraction — `model + instructions + tools` for agents, with declarative coordination patterns — aligns with every major framework and cloud provider. No existing standard occupies the same niche: a vendor-neutral, declarative harness format for agent orchestration.

However, the review identified **critical gaps** in memory, eval, parameterization, and the provider model that would limit real-world adoption. The spec also needs to clarify its relationship with Oracle Agent Spec, which overlaps on orchestration.

**Overall compatibility score: 7/10** — strong foundations, but several interfaces are too thin for production use.

---

## 1. Provider-by-Provider Compatibility

### 1.1 LangGraph

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Router/Pipeline/Parallel | Good | Direct StateGraph mapping via conditional edges, linear edges, fan-out/fan-in |
| Orchestrator (dynamic) | Partial | LangGraph graphs compile at build time; dynamic spawning requires `Command` API workaround |
| Eval-loop | Good | Graph cycle with conditional edge |
| Agent definition | Excellent | Direct `create_react_agent(model, tools, prompt)` mapping |
| Memory | Weak | Spec's `backend + ttl` misses scope (thread vs cross-thread), type (checkpoint vs semantic), and granularity |
| Tools (MCP) | Excellent | Official `langchain-mcp-adapters` bridge maintained by LangChain |
| Observability | Good | OTel bridge to LangSmith works; spec lacks metadata/tags |
| Human-in-the-loop | Good | Gate maps to `interrupt()`; channel/fallback need custom provider code |

**Verdict:** A LangGraph provider is highly viable. Memory is the main gap.

### 1.2 CrewAI

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Agent definition | Good | `role/goal/backstory` flattens into `instructions`; reverse mapping possible via templating |
| Pipeline | Good | Maps to sequential process |
| Orchestrator | Partial | Maps to hierarchical process (manager + workers) |
| Router | None | No native routing based on classifier output |
| Parallel | None | No concurrent branch execution |
| Eval-loop | None | No loop-against-criteria pattern |
| Tools (MCP) | Excellent | CrewAI has native MCP support (stdio, HTTP, SSE) |
| Memory | Weak | CrewAI's memory (short-term, long-term, entity) is far richer than spec's `backend + ttl` |
| Skills | None | No equivalent; decompose into agent config at compile time |

**Verdict:** Tools bridge cleanly, but 3 of 5 coordination patterns have no CrewAI equivalent. A CrewAI provider would need to implement router, parallel, and eval-loop as custom orchestration outside CrewAI's process model.

### 1.3 AutoGen / Microsoft Agent Framework (MAF)

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Agent definition | Moderate | `AssistantAgent(name, model_client, system_message, tools)` maps well; `UserProxyAgent` has no spec counterpart |
| Pipeline | Good | Sequential chats / MAF workflow graphs |
| Router | Moderate | GroupChat speaker-selection or MAF conditional edges |
| Parallel | Moderate | MAF fan-out; AutoGen has no native parallel |
| Orchestrator (dynamic) | None | Both frameworks assume topology is known at build time |
| Eval-loop | Moderate | Nested chats with termination conditions |
| Tools (MCP) | Good | AutoGen 0.4+ has `McpWorkbench` |
| Memory | Weak | Teachability is limited; MAF has checkpointing only |

**Critical note:** AutoGen is in **maintenance mode** as of early 2026. Microsoft has moved to MAF. Any provider effort should target MAF.

### 1.4 OpenAI (Assistants API + Agents SDK)

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Agent definition | Excellent | `model + instructions + tools` maps directly to Assistants API and Agents SDK |
| Coordination | Weak | Agents SDK supports handoffs (routing) only; no pipeline, parallel, orchestrator, eval-loop |
| Tools (MCP) | Excellent | Agents SDK has **native MCP support** |
| Guardrails | Good | Agents SDK has input/output guardrails; maps to gates |
| Observability | Good | Built-in tracing dashboard |

**Key insight:** OpenAI has **no declarative agent config format**. All agent definition is API/Python. Harnessfile fills this gap directly.

### 1.5 Anthropic (Claude API + Claude Code)

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Agent definition | Good | Claude API: `model + system prompt + tools`; Claude Code: `CLAUDE.md` |
| Tools (MCP) | Excellent | MCP is Anthropic's protocol — direct alignment |
| Hooks | Excellent | Claude Code hooks (`pre-tool-use`, `post-tool-use`) are nearly 1:1 with spec hooks |
| Multi-agent | Additive | Anthropic published patterns (orchestrator-worker, routing) but ships no orchestration framework |
| Memory | N/A | No standardized memory interface from Anthropic |

**Key insight:** Anthropic's ecosystem is the most compatible. Harnessfile fills exactly the gap Anthropic doesn't cover — declarative harness configuration. The hooks model is nearly identical.

### 1.6 AWS Bedrock + Step Functions

| Concept | Compatibility | Notes |
|---------|:---:|-------|
| Agent definition | Good | `model + instructions + action groups` maps cleanly |
| Router | Good | Step Functions `Choice` state |
| Pipeline | Good | Sequential `Task` states |
| Parallel | Good | `Parallel` state |
| Orchestrator | Good | Bedrock multi-agent supervisor/worker delegation |
| Eval-loop | Good | `Choice` + loop pattern |
| Guardrails | Good | Bedrock Guardrails (content filters, PII, denied topics) map to gates |
| Declarative target | Good | CloudFormation `AWS::Bedrock::Agent` resources exist as compilation target |

**Verdict:** AWS has the richest mapping. Step Functions + Bedrock could serve as a strong runtime backend. Harnessfile YAML could compile to CloudFormation templates.

### 1.7 Google Vertex AI Agent Builder

Agent Builder uses `model + instructions + tools + data stores`, confirming the spec's core abstraction is industry-aligned. Agent-to-agent delegation is supported. Data Stores map to memory/knowledge bases.

---

## 2. Protocol Compatibility

### 2.1 MCP (Model Context Protocol)

**Status:** De facto standard for tool integration. The spec's `mcp: ./tools/github.json` pattern is reasonable — consistent with how Claude Desktop and VS Code reference MCP configs.

**Findings:**
- Streamable HTTP transport replaced SSE in the 2025 revision
- OAuth 2.1 added for authentication
- Remote MCP servers are now well-supported
- OpenAI Agents SDK has native MCP support, validating the spec's MCP-centric tool model

**Recommendation:** The spec's MCP reference model is sound. Consider supporting both local file references (`mcp: ./tools/github.json`) and remote URLs (`mcp: https://mcp.example.com/github`) explicitly.

### 2.2 A2A (Agent-to-Agent Protocol)

**Status:** Launched by Google with ~50 partners. Defines agent communication (Agent Cards, Task lifecycle, streaming), NOT orchestration.

**Key finding:** A2A is **complementary, not competing**. A2A = wire protocol (how agents talk), Harnessfile = topology (how agents are wired together). No overlap on orchestration patterns.

**Risk:** A2A may eventually add orchestration primitives. The spec should monitor A2A evolution.

### 2.3 Other Protocols

- **AGENTS.md** (OpenAI, now under Linux Foundation's Agentic AI Foundation): Convention for project-level agent guidance, not a structured schema. Non-competing.
- **Linux Foundation AAIF** (founded Dec 2025 by Anthropic/OpenAI/Block): Umbrella for MCP, Goose, AGENTS.md. No competing harness spec.
- No competing standard from AWS, Microsoft, or standards bodies (OASIS, IEEE).

---

## 3. Oracle Agent Spec — The Key Relationship to Clarify

Oracle Agent Spec (released Oct 2025) is the **only structured agent-definition spec** in this space. It defines:
- Agent (name, system_prompt, llm_config, inputs, outputs)
- LLM (provider-agnostic model config)
- Tool (ServerTools, ClientTools, RemoteTools)
- **Flow** (directed workflow graphs with ControlFlowEdge and DataFlowEdge)
- Node types (LLMNode, APINode, AgentNode, FlowNode, MapNode, BranchingNode, ToolNode)

### Overlap Concern

Oracle Agent Spec **does define orchestration** via Flows and node types. This overlaps with Harnessfile's coordination patterns (router, pipeline, parallel, orchestrator, eval-loop). The spec's `CLAUDE.md` claims complementarity ("agent definition" vs "harness"), but the boundary is blurrier than assumed.

### What Oracle Agent Spec Does NOT Define (Yet)

- Memory
- Guardrails / gates
- Triggers
- Hooks
- Observability
- Evals

These are listed as upcoming, which could further increase overlap.

### Recommendation

The spec should explicitly define the boundary: **Harnessfile owns the operational layer** (triggers, gates, evals, hooks, observability, memory) while supporting any orchestration format — including Oracle Agent Spec Flows — as a provider. The coordination patterns in Harnessfile are a convenience layer; for complex orchestration, users could delegate to an Agent Spec Flow provider.

---

## 4. Critical Design Gaps

### 4.1 Memory Interface Is Too Thin (Severity: HIGH)

**Current:** `backend: string, ttl: duration`

**Industry reality:**
- LangGraph distinguishes thread-scoped checkpointers vs cross-thread `Store` for shared memory
- CrewAI has short-term (ChromaDB/RAG), long-term (SQLite), and entity memory
- Bedrock has Knowledge Bases (retrieval) vs session attributes (state)

**What's missing:**
- `scope`: per-thread vs cross-thread vs global
- `type`: checkpoint (state persistence) vs conversation (chat history) vs semantic (RAG/vector) vs entity
- Embedder/chunking config for semantic memory
- Read-only vs read-write distinction

**Recommendation:** Expand to at minimum:
```yaml
memory:
  backend: postgres
  scope: thread | shared | global
  type: checkpoint | conversation | semantic
  ttl: 24h
```

### 4.2 Eval Model Is Too Minimal (Severity: HIGH)

**Current:** `metric + pass + prompt + dataset`

**Industry reality:**
- LangSmith returns multi-dimensional scores (correctness, helpfulness, harmlessness)
- DeepEval has 14+ built-in metrics with composite dependencies
- Inspect AI evaluates agent trajectories (action sequences), not just outputs
- Braintrust supports experiment tracking and baseline comparison

**What's missing:**
- Multi-metric evaluation in a single eval block
- Trajectory/step-level eval (critical for agents vs simple model eval)
- Named/preset metrics (`builtin/hallucination`, `builtin/toxicity`)
- Eval context schema (what data the evaluator needs: retrieval docs, tool calls, intermediate steps)
- Scorer composition and weighting

**Recommendation:** At minimum:
```yaml
eval:
  - metric: tests-pass
    pass: true
  - metric: builtin/hallucination
    pass: 0.9
    context: [retrieval_docs, tool_calls]
  - metric: llm-judge
    prompt: "Is this spec complete?"
    pass: 0.8
    scope: output | trajectory
```

### 4.3 No Variable/Input Handling (Severity: HIGH)

**Current:** Zero parameterization. Every harness is hardcoded.

**Industry reality:**
- Docker Compose: `${VAR:-default}`
- GitHub Actions: `${{ inputs.x }}`
- Terraform: full `variable` blocks with types, defaults, validation

**Impact:** Cannot reuse the same harness across environments (staging vs production channels, different models, different thresholds).

**Recommendation:** Adopt Docker Compose's minimal approach for v0.1:
```yaml
agents:
  classifier:
    model: ${CLASSIFIER_MODEL:-anthropic/claude-haiku-4-5}

steps:
  plan-review:
    channel: ${APPROVAL_CHANNEL:-#approvals}
    timeout: ${GATE_TIMEOUT:-1h}
```

### 4.4 Provider Namespace and Versioning (Severity: MEDIUM)

**Current:** `gate: slack/v1` — name and version conflated, no namespace for disambiguation.

**Problem:** Two competing Slack providers would collide. No registry or resolution mechanism.

**Recommendation:** Adopt `namespace/name@version`:
```yaml
providers:
  gate: openharness/slack@v1
  eval: community/deepeval@v2
```

This follows GitHub Actions' convention (`owner/repo@version`) and works without central infrastructure.

### 4.5 No Secret References (Severity: MEDIUM)

**Current:** Secrets explicitly out of scope. No way to reference them.

**Problem:** Providers need credentials (Slack tokens, Jira API keys). Without a standard reference mechanism, every provider invents its own.

**Recommendation:** Define a reference interface without managing storage:
```yaml
providers:
  gate:
    type: openharness/slack@v1
    credentials:
      token:
        from: env:SLACK_TOKEN    # or vault:secret/slack, or file:/run/secrets/slack
```

### 4.6 No Step-Level Error Handling (Severity: MEDIUM)

**Current:** Hooks provide notification (`on-error: slack:#alerts`) but no control flow on failure.

**Problem:** What happens when a provider crashes? When a gate timeout's fallback also fails? The spec has no `on-error` control flow.

**Recommendation:**
```yaml
steps:
  research:
    agent: researcher
    on-error: fail | continue | retry(3)
    next: spec
```

### 4.7 Orchestrator Pattern — Universal Gap (Severity: LOW)

The dynamic orchestrator pattern (agent spawns sub-agents from a pool at runtime) has **no direct equivalent in any framework**. LangGraph, CrewAI, AutoGen, and MAF all assume topology is known at build time.

This is not necessarily a problem — it means the spec is pushing the industry forward. But it means every provider must implement custom runtime logic for this pattern. Consider documenting the expected runtime semantics more precisely.

---

## 5. What the Spec Gets Right

### 5.1 Core Agent Abstraction
`model + instructions + tools` is the universal common denominator. Every framework (LangGraph, CrewAI, AutoGen, OpenAI, Anthropic, Bedrock, Vertex AI) uses this pattern. The spec nailed this.

### 5.2 MCP as the Tool Protocol
MCP has become the de facto standard. OpenAI, LangChain, CrewAI, and Anthropic all support it natively. Choosing MCP as the tool integration layer was the right call.

### 5.3 Coordination Patterns
The five patterns (router, pipeline, parallel, orchestrator, eval-loop) cover the known multi-agent topologies. AWS Step Functions, LangGraph, and Anthropic's published patterns all validate these categories.

### 5.4 Separation of Spec and Runtime
The "spec is the graph, providers are the nodes" principle is architecturally sound. It mirrors Terraform's separation of configuration from execution and avoids the trap of becoming a framework.

### 5.5 Skills as Reusable Bundles
No other framework has this concept at the spec level. It's a genuinely useful abstraction — define a capability once, attach to multiple agents. Consider adding `inputs` for parameterization and remote references for ecosystem growth.

### 5.6 Declarative Gates
The gate model (`approve + channel + timeout + fallback`) is more expressive than any framework's native HITL support. LangGraph's `interrupt()`, AutoGen's `human_input_mode`, and Bedrock's checkpoints are all coarser.

### 5.7 Hooks Model
Nearly identical to Claude Code's hook system and conceptually aligned with GitHub Actions' lifecycle events. Well-designed.

---

## 6. Competitive Positioning

| Standard/Framework | What it defines | Relationship to Harnessfile |
|---|---|---|
| Oracle Agent Spec | Agent definition + orchestration flows | **Partially overlapping** — needs boundary clarification |
| Google A2A | Agent communication protocol | **Complementary** — wire protocol vs topology |
| Anthropic MCP | Tool/context protocol | **Complementary** — tool layer |
| AGENTS.md / AAIF | Project-level agent conventions | **Non-competing** — different layer |
| LangGraph | Agent framework (Python) | **Target runtime** — provider |
| CrewAI | Agent framework (Python) | **Target runtime** — provider |
| OpenAI Agents SDK | Agent framework (Python) | **Target runtime** — provider |
| AWS Bedrock | Cloud agent service | **Target runtime** — provider |
| Google Vertex AI | Cloud agent service | **Target runtime** — provider |

**The spec occupies a unique niche.** No existing standard provides a vendor-neutral, declarative harness format. The closest competitor is Oracle Agent Spec, which overlaps on orchestration but lacks the operational layer (gates, evals, hooks, triggers, observability).

---

## 7. Prioritized Recommendations

| # | Recommendation | Severity | Effort |
|---|---|---|---|
| 1 | Expand memory interface (scope, type) | High | Medium |
| 2 | Expand eval model (multi-metric, trajectory, presets) | High | Medium |
| 3 | Add variable substitution (`${VAR:-default}`) | High | Low |
| 4 | Adopt namespaced provider model (`namespace/name@version`) | Medium | Low |
| 5 | Add secret reference interface | Medium | Low |
| 6 | Add step-level error handling (`on-error`) | Medium | Low |
| 7 | Add skill parameterization (`inputs` with defaults) | Medium | Low |
| 8 | Clarify Oracle Agent Spec boundary (orchestration overlap) | Medium | Low |
| 9 | Document orchestrator pattern runtime semantics | Low | Low |

---

## 8. Conclusion

Harnessfile v0.1 has a **strong conceptual foundation** and occupies a genuinely unique position in the ecosystem. The core abstractions (agent definition, coordination patterns, MCP tools, gates, hooks) are well-aligned with industry patterns.

The main risks are:
1. **Memory and eval interfaces are too thin** for real-world use — every major framework has richer models
2. **No parameterization** makes the spec impractical for multi-environment deployment
3. **Oracle Agent Spec overlap** on orchestration needs explicit boundary definition

Addressing the top 3 recommendations (memory, eval, variables) before publishing v0.1 would significantly improve adoption viability. The remaining gaps can be addressed incrementally through the provider extension model (`x-` fields) and future spec versions.
