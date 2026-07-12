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

### D39: AGENTS.md is the canonical project guidance
**Decision:** Keep all shared project guidance in `AGENTS.md`. `CLAUDE.md` must contain only `@AGENTS.md`, using Claude Code's import syntax, so every supported coding agent reads the same instructions from a single source of truth.

---

---

## Session 5 — v0.2 and Archon parity (2026-04-12)

Source: Archon parity worktree (`compare-with-archon`)

Goal: Express the 20 default workflows from `coleam00/Archon` in Harnessfile
and compile them back to Archon YAML with round-trip fidelity, to validate
that the Harnessfile model covers the "AI coding workflow engine" use case.

This session opened Harnessfile v0.2 as a new, additive version — v0.1 is
frozen per D13. All changes below are purely additive; v0.1 files continue
to parse and validate identically.

### D39: v0.2 as an additive version
**Decision:** Open a new `harnessfile: "0.2"` version level. v0.2 is
strictly additive over v0.1 — any v0.1 Harnessfile is also a valid v0.2
Harnessfile. v0.1 remains frozen per D13.
**Rationale:** Archon parity requires ~10 new constructs. A clean version
bump avoids pretending these are clarifications of v0.1.

### D40: Inline execution modes on steps
**Decision:** A step in v0.2 can carry its own work via one of four
mutually-exclusive fields instead of referencing a pre-defined agent:
`prompt:` (ad-hoc agent call), `bash:` (shell script), `command:` (external
command reference, opaque to Harnessfile), `loop:` (iterative block, see
D42). The existing `agent:` field stays as-is.
**Rationale:** Archon workflows almost never predefine agents — they inline
everything in `nodes[].prompt` / `.bash` / `.command`. Requiring Harnessfile
authors to redeclare "agents" that only exist to hold instructions was
wasteful.
**Impact:** `agents:` is now optional in v0.2 (still required in v0.1).
`type: agent` steps without an `agent:` ref are valid as long as they
provide an inline execution mode.

### D41: `depends_on` as a backward-edge form
**Decision:** v0.2 adds `depends_on: [id, ...]` as an alternative to the
forward-edge `next:`. Both forms coexist in a harness; the validator folds
them into a unified forward-graph view for reachability and cycle checks.
The Archon compile provider emits `depends_on:` natively for round-trip
fidelity.
**Rationale:** Archon's DAG model is `depends_on:`-first. Translating
`next:` → `depends_on:` (by inverting the graph) is mechanical and happens
in the compile provider. Accepting both in the parser saves authors the
mental tax of inverting edges in their head.

### D42: `loop:` is orthogonal to `eval:`
**Decision:** v0.2 adds a `loop:` block on steps with fields `until`,
`until-bash`, `max-iterations`, `fresh-context`, `interactive`,
`gate-message`. Termination is by agent signal (`<promise>{until}</promise>`
marker in output) or bash exit code, not by metric threshold. `eval:` (v0.1,
metric-based retry) continues to exist unchanged. A step can have both.
**Rationale:** Archon's `loop:` and Harnessfile's `eval:` are fundamentally
different loop constructs. Collapsing them was considered and rejected
during v0.1 design (D15 collapsed eval-loop into a step property); in v0.2
we keep that direction for evals but add a second loop kind for
agent-signal termination.

### D43: `wait-for` — four fan-in quadrants
**Decision:** v0.2 adds `wait-for: all | any | all-done | any-done` on
steps. Refines (does not supersede) D33. Implicit default is still `all`,
which continues to fan-in-append as D33 specified. `any` / `all-done` /
`any-done` are opt-in.
**Rationale:** Archon has three trigger rules (`all_success`, `one_success`,
`all_done`); v0.2 exposes all three plus `any-done` for quadrant
completeness. `any-done` has no Archon equivalent — the compile provider
warns and falls back to `one_success`.

### D44: Provider passthrough via `raw:` bag
**Decision:** Any field not in the core spec vocabulary — at both top-level
and per-step — is preserved verbatim in a `raw:` bag on the IR. Compile
providers (and runtime providers) consume the bag to emit/execute
target-specific fields.
**Rationale:** Archon uses provider-specific fields like `approval:`,
`skills:`, `mcp:`, `idle_timeout:`, `context: fresh`, `hooks:` (in Claude
Code PreToolUse/PostToolUse format). Formalizing each of these in the
core spec would bloat the vocabulary and constrain future targets. The
passthrough bag is Kubernetes CRD–style: the spec defines what it knows,
and everything else flows through untouched.
**Impact:** The `hooks:` key has dual semantics. When all its children are
v0.1 lifecycle events (`on-start`, `before-step`, …), it parses as a v0.1
`HooksDef`. Otherwise it flows to `raw` as a provider-specific construct.

### D45: CompileProvider — code-gen face of the provider interface
**Decision:** v0.2 introduces a second provider contract,
`CompileProvider`, alongside v0.1's execute-oriented `HarnessProvider`. A
compile provider translates IR → target files (YAML, JSON, source) without
running the harness. Output is `{ files, warnings }` where warnings are
structured with `{ severity, code, message, path, suggestion }`.
**Rationale:** Archon is not a runtime we want to reimplement — it's a
compile target. The provider interface originally assumed runtime execution
(createRun, resumeRun, listRuns). Adding a distinct contract keeps the two
faces clean and leaves room for multiple compile targets (CrewAI, LangFlow)
without rewriting the runtime interface.
**Companion:** new CLI command `harnessfile compile --target <target>` with
`--out`, `--strict`, `--json` options.

### D46: Archon as a compile-only provider
**Decision:** The `archon/v1` compile provider emits Archon workflow YAML
matching the format used in `coleam00/Archon`'s
`.archon/workflows/defaults/`. It does not execute Harnessfiles. Archon
itself runs them after compilation.
**Round-trip goal:** all 20 default Archon workflows, vendored in
`packages/cli/tests/fixtures/archon/`, have hand-written Harnessfile
equivalents in `examples/archon/` that compile back to structurally
equivalent YAML under canonical normalization. The parity test asserts
this on every run.
**Rationale:** This gives Harnessfile a credible claim on the "AI coding
harness" use case Archon defines, without forking Archon's runtime. Authors
who want Archon's worktree isolation, Slack/Discord/Telegram adapters, and
dashboard get them for free; authors who want to stay Harnessfile-native
swap compile targets later.

### D47: `${{ VAR }}` env substitution in v0.2
**Decision:** v0.2 switches env var substitution from v0.1's `${VAR}` /
`${VAR:-default}` (Docker Compose style) to `${{ VAR }}` / `${{ VAR:-default }}`
(GitHub Actions style). The substituter detects the declared
`harnessfile:` version in a pre-parse regex scan and picks the pattern
accordingly. v0.1 files are unaffected.
**Rationale:** v0.1's syntax collides with POSIX shell parameter expansion
inside `bash:` block scalars. Archon workflows commonly contain shell
expansions like `${DURATION:-150}` in bash nodes, and the v0.1 substituter
would eat them as if they were env var references. The double-brace form
is unambiguous: Harnessfile-substitutable refs use `${{ ... }}`; shell
expansions use `${...}` and pass through untouched.

---

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | **Import/compose mechanism** — multi-file harnesses. All reviews suggest deferring to v0.2. | STILL DEFERRED |
| 2 | **Dynamic fan-out** — map-reduce pattern (N instances from runtime state). | STILL DEFERRED |
| 3 | **Provider version pinning / lockfile** — reproducible harness execution. | STILL DEFERRED |
| 4 | **JSON Schema** — needs to be written (D28). | TODO |
| 5 | **GitHub repo rename** — rename openharness to harnessfile (D29). | TODO |
| 6 | **Runtime execution of v0.2 shapes** — LangGraph provider only supports v0.1 shapes; v0.2-only features compile via `harnessfile compile` but don't execute via `harnessfile up`. | DEFERRED to post-v0.2 |
| 7 | **Additional compile targets** — CrewAI, LangFlow. Interface is general; no concrete targets beyond `archon/v1` yet. | FUTURE |
