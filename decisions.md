# Harnessfile — Decision Record

Chronological record of all design decisions made across sessions and worktrees.

---

## Session 1 — Project Inception (2026-04-09, morning)

Source: Main conversation

### D1: Project purpose
**Decision:** Create an open, vendor-neutral, declarative YAML/JSON spec for AI agent harnesses — the operational scaffolding around agents (triggers, guardrails, hooks, memory, evals, observability), not the agent definition itself.

### D2: Name — "OpenHarness" flagged as taken
**Discussion:** The original "OpenHarness" name conflicted with an existing harness implementation project on GitHub. Explored alternatives:
- `harnessspec` — rejected (triple S is bad)
- `harness-manifest` — liked by user ("combines the best of both"), but later found to conflict with npm package `@madebywild/agent-harness-manifest`
- 10 parallel research agents ran a thorough name search

**Names discarded:** `agentspec` (Oracle conflict), `agentschema` (Microsoft conflict), `harnessml` (taken), `agentkit` (taken), `agentcraft` (taken), `agent-blueprint` (taken), `agent-manifest` (taken), `agent-compose` (Docker conflict), `agentmesh` (taken)

**Recommended:** `Agentfile` (top pick — follows Dockerfile/Makefile convention) and `agentdl` (runner-up)

**Status: RESOLVED in D24.** User moved on to spec design without explicitly picking a name. Resolved later in Session 3.

### D3: Scope — harness only, not agent definition
**Decision:** "We definitely want Option B — we don't want to compete in the agent definition space. We want to define the harness."
**Context:** After analyzing Oracle Agent Spec, user chose to focus exclusively on the operational layer.

### D4: Terraform as design inspiration
**Decision:** Provider model inspired by Terraform (provider-agnostic, declarative), file format inspired by Docker Compose (simple YAML, progressive complexity).
**User quote:** "I think a lot about the Terraform format, but I'm not sure if exactly that."

### D5: Balance expressiveness with simplicity
**Decision:** "I want to reach a good balance between being expressive and extensible, and being simple to read and maintain by humans and AIs. I want to start with the minimum, but out of the box we could support everything that Oracle Agent Spec defines, but in a vendor-neutral and less bureaucratic way."

### D6: Include inline agent definition [amended by D39]
**Decision:** After initially wanting agents as pure external references ("everything that is not the agent definition"), user realized this creates a chicken-and-egg problem — "it seems insufficient actually, because how will this agent.yaml work?" Decided to include a minimal inline agent format (model + instructions + tools) while supporting external formats via providers.
**Amended:** The self-contained-in-repo motivation stands, but the built-in format changed from inline YAML to Markdown + frontmatter role-card files in `agents/` (D39).
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

Source: Meta-review worktree conversation

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

### D24: Project name and package — Harnessfile [amended by D43]
**Decision:** Rename the project from "OpenHarness" to **Harnessfile**. Follows the `Dockerfile`/`Makefile`/`Procfile`/`Vagrantfile` convention. The config file becomes `Harnessfile` (or `harnessfile.yaml`). Version key in the file is `harnessfile: "0.1"`. CLI tool and package name: `harnessfile` (available on both npm and PyPI).
**Amended:** Project/CLI/package name stands. The config file location/name is superseded — the canonical file is `.agents/harness.yaml` (D39, D43).
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

## Session 4 — CLI Implementation (2026-04-09)

Source: Implementation worktree

### D34: Harness provider concept
**Decision:** A "harness provider" is a runtime execution engine that takes the parsed harnessfile IR and runs it. This is distinct from the spec's runtime providers (slack/v1, jira/v1, etc.) which describe integrations at execution time. First harness provider: LangGraph.
**Rationale:** Decouples the spec (what the harness is) from the runtime (how it executes). Different teams can use different providers for the same harnessfile.

### D35: CLI follows Docker Compose model
**Decision:** The CLI uses `up/down/logs/status` commands, not plan/apply. YAML is interpreted at runtime, not compiled to static code. `harnessfile up` starts a persistent server.
**Rationale:** Docker Compose is the closest UX to what we want — simple, immediate, local-first. Terraform's plan/apply model is better for IaC but too heavy for v0.1.

### D36: v0.1 is local-only
**Decision:** Single process execution. The provider interface is designed for future distribution (remote workers, task queues) but that layer is not built yet.
**Rationale:** Ship fast, iterate. The interfaces are clean enough to add distribution in v0.2 without rewriting.

### D37: LangGraph as runtime engine
**Decision:** The LangGraph provider wraps LangGraph's StateGraph as the execution engine, leveraging its checkpointing, streaming, and Pregel engine.
**Rationale:** LangGraph provides state management, checkpointing, and human-in-the-loop (interrupt/resume) out of the box. Building our own engine would duplicate this work.

### D38: Persistent server with concurrent runs
**Decision:** `harnessfile up` starts a long-running server. Triggers listen for events and spawn runs. Multiple runs flow concurrently through the same compiled graph, isolated by thread ID. Gates suspend individual runs via LangGraph's checkpointing, not the whole process.
**Rationale:** A harness serving production traffic must handle concurrent requests. Each trigger event (webhook POST, cron tick) creates an independent execution with its own state. Gate pauses must not block other runs.

---

## Session 5 — Industry research and the v0.2 pivot (2026-07-11)

Source: Main conversation. Context: the project was stale since 2026-04-11. Deep web research
(see `reviews/2026-07-industry-research.md`) plus a full exploration of the AltaVox production harness
(`../altavox`) informed a structured interview with the user. Decisions below came from that interview.

### D39: Pivot — the spec is the `.agents/` directory
**Decision:** Harnessfile v0.2 specifies the **`.agents/` directory** as the unit of definition, not a single root YAML file. Layout:
```
.agents/
├── harness.yaml          # the harness: triggers, gates, graph, routing, targets
├── agents/<slug>.md      # role cards — Markdown + YAML frontmatter
├── skills/<name>/SKILL.md # Agent Skills open standard, adopted as-is
└── squads/<slug>.md      # leader + members + orchestration instructions
```
**Rationale:** The industry converged on Markdown+frontmatter entities and the `.agents/` path (Codex, Cursor, and Gemini CLI read `.agents/skills/` natively); the directory itself has no formal spec — only community drafts. The AltaVox production harness already works this way. The harness layer (everything in `harness.yaml`) is the part no standard covers.
**Impact:** Amends D6 (built-in agent format is now Markdown role cards, not inline YAML) and D24 (file location). The provider model (D7, D8), graph model (D31–D33), and all standard interfaces carry over into `harness.yaml`.

### D40: Squads are agent-compatible orchestrator nodes
**Decision:** A squad (leader agent + members + orchestration instructions as the file body) can be used **anywhere an agent can** — as a graph step, a trigger target, etc. The leader orchestrates members internally according to its instructions; the graph does not model the squad's internals.
**User note:** "squads são um bom conceito... eles podem entrar em qualquer lugar onde hoje entra um agente (é um padrão de coordenação orquestrador)."
**Impact:** Squads become the orchestrator coordination pattern. The v0.1 `type: orchestrator` step (agent + pool) is superseded by referencing a squad. Explicit graph and leader-orchestration coexist: the graph is optional; a harness can be a single squad reference.

### D41: Autopilots unify into triggers
**Decision:** No separate autopilot entity in the spec. A trigger node may declare `schedule` (cron) + `timezone` and a `prompt` (inline or a path to a Markdown file). AltaVox/Multica-style `autopilots/*.md` compile to scheduled triggers on sync.
**Rationale:** One concept instead of two overlapping ones; keeps the unified graph (D31).

### D42: Ownership boundary — portable defaults + target-owned fields
**Decision:** Entity files MAY declare portable defaults (e.g., `model`) useful for local tools and the headless runtime. In `harness.yaml`, each sync target declares which fields it **owns** (e.g., `owns: [model, runtime, concurrency, env]`). Owned fields are set once at bootstrap (first push, using the portable default if present) and **never overwritten by subsequent syncs** (bootstrap-then-hands-off). Secrets are never in the repo (reaffirms D27).
**Rationale:** Formalizes the boundary proven by AltaVox's `multica-push.py`: git owns definition, the environment owns operational config.

### D43: Naming after the pivot
**Decision:** The project, CLI, spec, and packages remain **Harnessfile** (D24's name stands — npm/PyPI secured). The canonical file is `.agents/harness.yaml` (extension kept for editor/tooling support). Precedent: Terraform's config files are not named `terraform`.

### D44: Ecosystem posture — own spec, compatible and ambitious
**Decision:** Publish the Harnessfile spec of the `.agents/` directory as a candidate standard. Adopt **SKILL.md** (Agent Skills) and **AGENTS.md** as-is; specify `agents/*.md` using the Markdown+frontmatter plurality convention (Claude Code / Cursor / Gemini CLI compatible); add `harness.yaml` and `squads/` where no standard exists. Engage the community ".agents Protocol" draft author; aim for AAIF/Linux Foundation alignment later — without waiting for anyone.

### D45: CLI dual mode — sync + headless runtime
**Decision:** Two modes: (1) **`harnessfile sync`** compiles/pushes the definition to targets (Multica, `.claude/` symlinks, Codex TOML, `.github/agents/`, …) honoring D42 ownership; (2) **`harnessfile up`** runs the headless orchestrator that binds triggers/gates to systems already in production (Jira/Linear/GitHub/Slack via providers) and drives agent runtimes. Extends D35; the LangGraph engine (D37) powers `up`.
**Rationale:** Sync delivers value immediately and generalizes proven AltaVox tooling; `up` is the "Multica without UI lock-in" differentiator.

### D46: v0.2 integration targets
**Decision:** First wave, all four: (1) **Multica** sync provider; (2) **local code tools** — Claude Code (`.claude/` symlinks), Cursor/Gemini (native `.agents/`), Codex (TOML subagent generation); (3) **GitHub Agent HQ** (`.github/agents/*.md`); (4) **production boards/chat** — Jira, Linear, GitHub, Slack trigger/gate providers for the headless runtime.

### D47: First implementation milestone — AltaVox as the flagship case
**Decision:** Express the AltaVox harness in `.agents/harness.yaml` and make `harnessfile sync` generate/maintain its targets, generalizing the production-proven `multica-push.py`/pull scripts into the official Multica provider. Validates the spec against a real harness before anything else.

### D48: v0.1 assets — adapt CLI, pause UI
**Decision:** `packages/cli`'s parser/runtime is adapted to read the `.agents/` directory (becomes the basis of `up`). The `ui/` visual editor is frozen until the v0.2 spec stabilizes, then updated to the new format. Nothing is deleted.

### D49: Version continuity — v0.2 with a pivot note
**Decision:** Publish as `spec/v0.2-draft.md`; `spec/v0.1-draft.md` gets a superseded banner. Decision numbering continues (no reboot). Rationale: the repo was never widely announced; the change cost is internal.

### D50: The project maintains its own harness (dogfood)
**Decision:** The Harnessfile repository carries its own `.agents/` harness: a maintenance squad
(maintainer leader, researcher, spec-editor, cli-engineer, ui-engineer, reviewer), project skills
(decision-record, spec-consistency, fermata-fidelity), a GitHub issue trigger, and a weekly
scheduled `industry-watch` sweep (tracks Open Item #7 among others). Local targets (claude-code
symlinks, codex TOML, github agents) are synced by the CLI and committed; the multica target is
declared but unbound (`--apply` refuses until a workspace is set).
**Rationale:** The spec's first ongoing user should be itself; every spec change now has to
survive its own harness.

---

## Session 6 — AGENTS.md canonicalization (2026-07-12)

Source: A parallel commit by the project owner (`e440aa8`), integrated by rebase. Originally
numbered D39; renumbered to D51 to resolve a collision with the Session 5 pivot decisions.

### D51: AGENTS.md is the canonical project guidance
**Decision:** Keep all shared project guidance in `AGENTS.md`. `CLAUDE.md` must contain only `@AGENTS.md`, using Claude Code's import syntax, so every supported coding agent reads the same instructions from a single source of truth.
**Note:** Complements D44 (the spec adopts AGENTS.md as-is) — this is about the project's own guidance files. `AGENTS.md` content was updated to the v0.2 reality (`.agents/` directory, `spec/v0.2-draft.md`) as part of the same integration.

---

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | **Import/compose mechanism** — multi-file harnesses. Partially resolved by the directory pivot (D39); cross-repo composition still open. | OPEN |
| 2 | **Dynamic fan-out** — map-reduce pattern (N instances from runtime state). | DEFERRED |
| 3 | **Provider version pinning / lockfile** — reproducible harness execution. | DEFERRED |
| 4 | **JSON Schema** — needs to be written against v0.2 (D28). | TODO |
| 5 | **GitHub repo rename** — rename openharness to harnessfile (D29). | TODO |
| 6 | **Codex TOML subagent generator** — the one missing translation in the AltaVox setup (D46). | TODO |
| 7 | **Track MCP 2026-07-28 final spec** (publishes Jul 28) before freezing gate/HITL and observability interfaces. | WATCH |
| 8 | **Engage ".agents Protocol" community draft author** (D44). | TODO |
