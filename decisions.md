# Harnessfile — Decision Record

Chronological record of all design decisions made across sessions and worktrees.

---

## Session 1 — Project Inception (2026-04-09, morning)

Source: Main conversation (`1c136cab`)

### D1: Project purpose
**Decision:** Create an open, vendor-neutral, declarative YAML/JSON spec for AI agent harnesses — the operational scaffolding around agents (triggers, guardrails, hooks, memory, evals, observability), not the agent definition itself.

### D2: Name — "OpenHarness" flagged as taken
**Discussion:** User noted "openharness is already an existing project (which is an actual harness implementation)." Explored alternatives:
- `harnessspec` — rejected (triple S is bad)
- `harness-manifest` — liked by user ("combines the best of both"), but later found to conflict with npm package `@madebywild/agent-harness-manifest`
- 10 parallel research agents ran a thorough name search

**Names discarded:** `agentspec` (Oracle conflict), `agentschema` (Microsoft conflict), `harnessml` (taken), `agentkit` (taken), `agentcraft` (taken), `agent-blueprint` (taken), `agent-manifest` (taken), `agent-compose` (Docker conflict), `agentmesh` (taken)

**Recommended:** `Agentfile` (top pick — follows Dockerfile/Makefile convention) and `agentdl` (runner-up)

**Status: RESOLVED in D24.** User moved on to spec design without explicitly picking a name. Resolved later in Session 3.

### D3: Scope — harness only, not agent definition
**Decision:** "We definitely want Option B — we don't want to compete in the agent definition space. We want to define the harness."
**Context:** After analyzing Oracle Agent Spec and Microsoft AgentSchema, user chose to focus exclusively on the operational layer.

### D4: Terraform as design inspiration
**Decision:** Provider model inspired by Terraform (provider-agnostic, declarative), file format inspired by Docker Compose (simple YAML, progressive complexity).
**User quote:** "I think a lot about the Terraform format, but I'm not sure if exactly that."

### D5: Balance expressiveness with simplicity
**Decision:** "I want to reach a good balance between being expressive and extensible, and being simple to read and maintain by humans and AIs. I want to start with the minimum, but out of the box we could support everything that Oracle Agent Spec defines, but in a vendor-neutral and less bureaucratic way."

### D6: Include inline agent definition
**Decision:** After initially wanting agents as pure external references ("everything that is not the agent definition"), user realized this creates a chicken-and-egg problem — "it seems insufficient actually, because how will this agent.yaml work?" Decided to include a minimal inline agent format (model + instructions + tools) while supporting external formats via providers.
**User quote:** "I think we can create our own simple agent spec for our case, but our harness spec needs to be compatible with any format through providers just like Terraform already works."

### D7: Agent definition as a default provider
**Decision:** "I think we have to define our agent as a provider too, external to the spec, but we leave it loaded by default to simplify the file if they want to use it."
**Implication:** The built-in agent format has no special status — it's just a provider that happens to be loaded by default.

### D8: Everything is a provider
**Decision:** "I think all components/nodes need to have a provider, right? Evals, gates, etc."
**Implication:** Triggers, gates, evals, observability, memory — all are provider-backed.

### D9: Standardized interfaces to avoid Terraform complexity
**Decision:** To prevent the complexity problem where every Terraform provider defines things differently, the spec defines standard interfaces (gate, eval, trigger, etc.) that all providers must implement. Provider-specific extensions use `x-` prefix.

### D10: V0.1 MVP scope [redacted by D15]
~~**Decision:** V0.1 must express: multiple agents, gates and human/automated reviews, coordination patterns: router, pipeline, parallel, orchestrator, eval-loop, pluggable evals and observability.~~
**Superseded:** Eval-loop collapsed into step property (D15). Coordination patterns reduced to 4: router, pipeline, parallel, orchestrator. Gates are human-only; automated checks use eval.

### D11: All documents in English
**Decision:** "All documents we write will be in English only, we can put this in the AGENTS.md/CLAUDE.md of the project."

### D12: Skills as reusable bundles [redacted by D14]
~~**Decision:** Skills as inline instructions + tools + evals bundles shared across agents.~~
**Superseded:** Skills pivoted to external SKILL.md file references (D14).

---

## Session 2 — Four parallel review worktrees (2026-04-09)

Source: Four worktree branches merged to main

No user decisions — these were automated review runs producing the four review documents (applicability, compatibility, completeness, simplicity).

---

## Session 3 — Meta-review and tradeoff decisions (2026-04-09, this session)

Source: Meta-review worktree conversation (`fc173c45`)

### D13: V0.1 is production-ready
**Decision:** "Production-ready" — teams should actually deploy against it. Not a proof of concept.

### D14: Skills follow SKILL.md convention
**Decision:** Instead of inventing a new bundling format, adopt the existing SKILL.md convention used by Claude Code, Cursor, etc. Skills are external files referenced by path (`./skills/code-review.md`).
**User quote:** "SKILLs are already a concept in Claude, Cursor etc, let's just use their standard."
**Impact:** Replaces D12's inline skill bundles. Resolves the black-box contradiction flagged by the simplicity review.

### D15: Collapse eval-loop into step property
**Decision:** Eval-loop is not a coordination pattern — it's `eval:` + `max-iterations:` on any step. Reduces coordination patterns from 5 to 4.
**Impact:** Fixes the 6-level nesting violation. Reduces concept count.

### D16: Add variables with ${VAR:-default}
**Decision:** Add Docker Compose-style variable substitution. Chosen as the single most critical addition.

### D17: Add data flow AND error handling, remove nothing [redacted by D31, D32, D33]
~~**Decision:** Add data flow (output schema, context selection, parallel merge) and error handling (retry, timeout, on-error) to the spec. Do not cut any existing concepts to compensate.~~
**Superseded:** Data flow and error handling remain, but parallel merge was removed (D33) and the parallel pattern was replaced by polymorphic `next` (D31). Triggers and outputs became graph nodes (D32).

### D18: Drop top-level providers block, use inline references
**Decision:** Follow GitHub Actions model — declare provider at point of use (`provider: slack/v1` on the step), not in a top-level registry.

### D19: Add minimal security section
**Decision:** Add guardrails (input/output filters), budget (max-tokens/cost), and audit (destination/level). ~3 new fields. Enough to claim safety without a full security model.

### D20: Orchestration is core, not convenience
**Decision:** Harnessfile owns coordination patterns as a first-class concern. Oracle Agent Spec Flows are an alternative via provider, but built-in patterns are the default.

### D21: Manage complexity through progressive examples
**Decision:** Lead with 4-line minimal example, then 15-line, then 30-line with gate+eval, then full example last. No formal spec tiers — just example progression.
**User quote:** "Minimal examples first."

### D22: Skill references are file paths
**Decision:** `skills: [./skills/code-review.md]` — point to local SKILL.md files. Simple, matches how MCP tools are referenced.

### D23: Explicit provider resolution with shorthand
**Decision:** No magic inference (`#channel` = Slack is gone). All providers are explicit. Shorthand (`slack/v1`) when only provider matters, full object form when fields needed.

### D24: Project name and package — Harnessfile
**Decision:** Rename the project from "OpenHarness" to **Harnessfile**. Follows the `Dockerfile`/`Makefile`/`Procfile`/`Vagrantfile` convention. The config file becomes `Harnessfile` (or `harnessfile.yaml`). Version key in the file is `harnessfile: "0.1"`. CLI tool and package name: `harnessfile` (available on both npm and PyPI).
**Rationale:** "I don't want to call it agentfile, we're defining the harness not the agent." `harness` was taken on both npm and PyPI. `harness-cli` on npm is taken by an AI agent orchestration project.
**Resolves:** D2 (name was unresolved since Session 1).

### D25: Reword principle #3 to "Progressive disclosure"
**Decision:** Replace design principle #3 "Implicit -> conventional -> explicit" with "Progressive disclosure — start with the minimum. Add fields, providers, and overrides only as complexity demands."
**Rationale:** The old principle suggested magic inference (e.g., #channel = Slack), which conflicts with D23 (explicit providers). "Progressive disclosure" captures the actual design: encounter complexity only when you need it. Distinct from principle #2 ("defaults over config") which is about field defaults.

### D26: Hooks — full control, 7 lifecycle events
**Decision:** Hooks can observe, abort, AND modify execution. 7 events: `on-start`, `before-step`, `after-step`, `on-error`, `on-gate-pending`, `on-gate-resolved`, `on-complete`. Shorthand (fire-and-forget) and full form (with `can: [abort, modify]`). Hooks receive JSON on stdin, return JSON on stdout.
**Rationale:** Gates are long-running — hooks help track them. Full control matches Claude Code's hook model and enables pre-step context injection and post-step output transformation.

### D27: Secrets — env vars only
**Decision:** No separate secrets interface. Credentials are just environment variables referenced via the existing `${VAR}` syntax. Providers document which env vars they expect (e.g., `SLACK_TOKEN`).
**Rationale:** The variable system already handles this. Adding a separate secrets concept would mean two ways to reference external values. Keep it simple.

### D28: JSON Schema ships with v0.1
**Decision:** Write and ship a JSON Schema that validates Harnessfile YAML. Enables editor autocomplete, CI validation, and tooling from day one.

### D29: Rename GitHub repo to harnessfile now
**Decision:** Rename the repo immediately to match the project name. GitHub handles redirects from the old URL.

### D30: Redact superseded decisions
**Decision:** Superseded decisions get `[redacted by Dxx]` in the title, strikethrough on original text, and a superseded note pointing to the new decision. Preserves history while making the current state clear.

### D31: Unified graph — triggers and outputs are nodes, polymorphic `next`
**Decision:** Everything is a node in the graph. Triggers are entry nodes (`type: trigger`), outputs are exit nodes (`type: output`). Multiple triggers and outputs are supported. `next` is polymorphic: `next: step` (sequential), `next: [a, b, c]` (parallel fan-out), or omitted (end of path). Fan-in is implicit — a step waits for all incoming edges.
**Impact:** Removes `type: parallel` as a step type. Removes the top-level `trigger:` block. Pipeline and parallel are no longer named coordination patterns — they emerge from the graph. Coordination patterns reduced to: router, orchestrator, gate, trigger, output.

### D32: Input/output schemas on trigger/output nodes
**Decision:** Each trigger declares its `output` schema (what data it produces). Each output declares its `input` schema (what data it expects). No top-level input/output — schemas live on the graph nodes. Multiple triggers can produce different shapes.
**Rationale:** A harness may have multiple entry points (Jira trigger + webhook trigger) with different data shapes. Putting schemas on the nodes keeps them self-describing.

### D33: Fan-in always appends, no merge field
**Decision:** When multiple steps converge on the same target, outputs are always appended. No `merge` field. If custom merge logic is needed, use an agent step.
**Rationale:** Fewer concepts. The agent is already capable of merging — no need for the spec to define merge strategies.

---

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | **Import/compose mechanism** — multi-file harnesses. All reviews suggest deferring to v0.2. | DEFERRED to v0.2 |
| 2 | **Dynamic fan-out** — map-reduce pattern (N instances from runtime state). | DEFERRED to v0.2 |
| 3 | **Provider version pinning / lockfile** — reproducible harness execution. | DEFERRED to v0.2 |
| 4 | **JSON Schema** — needs to be written (D28). | TODO |
| 5 | **GitHub repo rename** — rename openharness to harnessfile (D29). | TODO |
