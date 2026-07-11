# Industry Research — April–July 2026

Deep research conducted 2026-07-11 to catch the project up after going stale in April 2026.
Method: multi-agent fan-out web search with adversarial verification (25/25 claims confirmed, 0 refuted),
plus three targeted follow-up sweeps (frameworks, squad platforms, config conventions) and a full
exploration of the AltaVox production harness. This document informs the v0.2 pivot (see D39–D49 in `decisions.md`).

## 1. "Harness" became mainstream vendor vocabulary

- **Microsoft Agent Framework 1.0 GA (Apr 2, 2026)** — AutoGen + Semantic Kernel merged; ships
  *declarative YAML agents and workflows*. At Build 2026 (Jun 3) Microsoft defined the **agent harness**
  as a first-class product concept: "the layer where model reasoning meets real execution: shell and
  filesystem access, human-in-the-loop approval flows, and context management across long-running sessions."
  https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/
- **Microsoft Conductor (May 14, 2026, MIT)** — YAML-first CLI for deterministic multi-agent workflows:
  Jinja2 routing, parallel groups, loop-backs, human-in-the-loop gates, per-agent model overrides, driving
  Claude Agent SDK and Copilot SDK as providers. The closest conceptual competitor — but Microsoft-owned
  and CLI-agent-centric. https://github.com/microsoft/conductor
- **OpenAI Agents SDK "model-native harness" (Apr 15, 2026)** — configurable memory, named sandbox
  providers, workspace **Manifest** abstraction. Meanwhile **AgentKit's visual Agent Builder and hosted
  Evals were deprecated (Jun 3, 2026; gone Nov 30, 2026)** — the cautionary tale for UI-owned config:
  users whose config lived as data in their own repos migrated painlessly.
  https://openai.com/index/the-next-evolution-of-the-agents-sdk/
- **CrewAI v1.15 (Jun 2026)** — "JSON-first crews", `crewai run --definition`, declarative flows with
  human feedback driven from flow definitions. https://docs.crewai.com/en/changelog
- **LangGraph** — Python v1.2.0 (May 12): per-node `TimeoutPolicy`, node `error_handler`, `DeltaChannel`
  checkpoint deltas, graceful drain. JS lags months behind. **LangGrap OSS still has no declarative config
  layer** (LangSmith Fleet is closed SaaS) — the slot Harnessfile's runtime occupies remains open.
- **Claude Code / Agent SDK** — nested subagents (5 levels, Jun 10), experimental agent teams (Jun 15),
  background-by-default subagents (Jul 1), richer sandbox/permission rules. All config remains
  filesystem-based (`.claude/`); no orchestration graph surface.

## 2. Protocols settled

- **MCP 2026-07-28 revision** (RC locked May 21; final Jul 28) — the largest revision ever: stateless core
  (handshake and `Mcp-Session-Id` removed), first-class `extensions` (reverse-DNS IDs), Tasks moved to an
  extension, **MRTR** (`input_required` result) replaces server-initiated requests — directly relevant to
  how gates/human-in-the-loop are implemented. Roots/Sampling/Logging deprecated (migrate logging to
  stderr/OpenTelemetry). https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
- **A2A 1.0** (release Mar 12; LF announcement Apr 9) — first stable spec; 150+ orgs; Azure AI Foundry,
  Copilot Studio, and Bedrock AgentCore integrations; five SDK languages.
- **Governance**: MCP, AGENTS.md, and A2A all sit under the Linux Foundation (Agentic AI Foundation,
  formed Dec 2025). LF positions MCP = agent↔tool, A2A = agent↔agent, explicitly complementary.
  A harness spec orchestrates *across* both layers.

## 3. Config conventions: two winners, one vacuum

- **Project guidance: AGENTS.md won.** AAIF-governed, 60k+ repos, read by every major tool. Deliberately
  unversioned, "just Markdown", no frontmatter; nested files codified.
- **Skills: Agent Skills (SKILL.md) won.** Published as an open standard Dec 18, 2025 (agentskills.io);
  ~45 client tools by mid-2026 (Claude Code, Codex, Gemini CLI, Cursor, Copilot, VS Code, Goose, Factory…).
  Still Anthropic-stewarded (NOT donated to AAIF, despite syndicated claims).
- **The `.agents/` directory**: `.agents/skills/` is read natively by **Codex, Cursor, and Gemini CLI**
  (Claude Code is the holdout — reads only `.claude/skills/`). Beyond `skills/`, the directory has no
  formal spec — only community drafts (".agents Protocol", DRAFT Feb 24, 2026, single maintainer;
  https://dotagentsprotocol.com/).
- **Subagents: nobody won.** Markdown+frontmatter is the plurality (Claude Code, Cursor, Gemini CLI —
  near-identical fields: name, description, tools, model); **Codex uses TOML**; vocabularies are
  incompatible. Cursor cross-reads `.claude/agents/`. Sync tools (Ruler, rulesync, agentsync) exist but
  are small; native convergence is eroding them.
- **Everything harness-shaped is proprietary per tool**: hooks, permissions, triggers/scheduling, memory,
  evals, observability, squads. This is exactly Harnessfile's scope and remains open territory.

## 4. Squad platforms: the board is the lock-in

- **Multica (multica.ai)** — open-source (modified Apache 2.0; commercial rehosting restricted),
  Linear-style board where agents are assignees. 0 → ~40k GitHub stars in ~4 months. Squads (May 2026),
  autopilots (cron/webhook), skills (SKILL.md), 14 local CLI runtimes; code never transits their servers.
  **No config-as-code**: agents/squads/autopilots are UI/DB state; only skills are file-based. No Jira or
  Linear integration — Multica *replaces* the board.
- **GitHub Agent HQ** — mission control; custom agents as `.github/agents/*.md` (Markdown+frontmatter);
  Claude and Codex in public preview on GitHub since Feb 4, 2026. Personas are git files; orchestration is
  locked to GitHub + Copilot billing. On track to become the de facto *closed* harness.
- **Devin** — best partial portability (`.devin.md` playbooks, `.devin/blueprint.yaml`), single-vendor agent.
- **Factory** — droids as repo files (`.factory/droids/`), platform proprietary. **Linear** — Agent API as
  protocol ("bring your own agent", not "bring your own board"). **Cursor/Jules** — env files in git,
  orchestration in vendor cloud.
- Open-source bring-your-own-board orchestrators exist (Emdash, Agent Fleet-O, Vibe Kanban) but none has a
  portable declarative harness format.

## 5. Adjacent specs

- **Oracle Agent Spec 26.1.2 (Jun 2, 2026)** — adapters for MAF/OpenAI Agents SDK/WayFlow; new
  framework-agnostic **Agent Spec Evaluation** (overlaps our evals scope). Still agent-definition-focused;
  remains complementary. https://github.com/oracle/agent-spec
- **Harness Protocol** (harness.yaml for a *single* agent's operational context), **Open Agent Format**,
  **AgentSPEX** (academic, arXiv Apr 2026), **GitHub Next Agentic Workflows** (markdown-frontmatter
  workflows compiling to Actions; research prototype). All one level below or beside the multi-agent
  harness layer; none covers squads + triggers + gates + bindings to production systems.

## 6. The AltaVox production harness (internal reference)

A working harness that validates the model the spec should express (see `../altavox`):

- `.agents/` with four entity types as Markdown+frontmatter: `agents/*.md` (role cards: name, description,
  skills, `multica.display_name`), `skills/*/SKILL.md` (~30, Agent Skills standard), `squads/*.md`
  (leader + members + the PM's routing prose as body — risk×ambiguity, three paths, UI overlay),
  `autopilots/*.md` (cron frontmatter + task-prompt body).
- Distribution by **symlinks + native discovery** (`.claude/skills → ../.agents/skills`; Cursor/Codex/
  Gemini read `.agents/` natively). Only missing piece: Codex TOML subagent generation.
- **Multica sync** (`scripts/multica-push.py` + 4 pull scripts, CI on merge to main) with an explicit
  **ownership boundary**: git owns definition (name, description, skills, instructions, agent members,
  schedule triggers); Multica owns operational config (model, runtime, concurrency, env, MCP, secrets,
  human members, webhook URLs). **Bootstrap-then-hands-off**: first push creates the agent with a default
  model; later pushes never touch owned fields.

## Strategic conclusions for v0.2

1. **The thesis is validated but the window is narrowing.** "Declarative harness config" is no longer
   whitespace (Conductor, MAF, CrewAI). The defensible differentiator is **vendor neutrality + binding to
   systems already in production + the versioned-definition/environment-owned-operational boundary**.
2. **Adopt what won, specify what didn't.** Adopt AGENTS.md and SKILL.md as-is; specify `agents/*.md`
   (the plurality subagent format) and the harness layer (`harness.yaml`) where no standard exists.
3. **The board is the lock-in.** Nobody ships "your squad, your triggers, your gates — as files in your
   repo — bound to whatever board/chat/VCS you already run." That is the product.
4. **AgentKit's death is the argument** for spec-in-repo; **Multica's growth without config-as-code** is
   the immediate opportunity (AltaVox's push/pull scripts are the missing piece, proven in production).
5. **Track MCP 2026-07-28 final** (Jul 28) before hard-coding gate/HITL semantics; prefer OpenTelemetry
   for the observability interface.
