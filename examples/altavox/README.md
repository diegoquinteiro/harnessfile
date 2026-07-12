# AltaVox development harness

A **real production harness** expressed in Harnessfile v0.2 — the flagship example (decision D47).
This is the AltaVox development squad: nine role agents led by a PM, routing every issue through
risk×ambiguity gates, with an hourly Sentry triage autopilot.

## What it shows

| Spec feature | Where |
|---|---|
| The `.agents/` directory | this folder |
| Agent role cards with portable runtime and opaque model defaults | [`.agents/agents/`](.agents/agents/) |
| A squad as an agent-compatible orchestrator node (D40) | [`.agents/squads/development.md`](.agents/squads/development.md) + `steps.development` |
| Leader-orchestration in prose (risk×ambiguity routing, three paths, UI overlay) | the squad body |
| Scheduled trigger with a prompt — the "autopilot" form (D41) | `triggers.sentry-sweep` → [`.agents/autopilots/sentry-triage.md`](.agents/autopilots/sentry-triage.md) |
| Board trigger with a swappable provider | `triggers.issue-assigned` (`multica/v1` — same shape for `jira/v1`, `linear/v1`, `github/v1`) |
| Targets with `owns` and bootstrap-then-hands-off (D42) | `targets.multica` |
| Agent Skills (SKILL.md) with supporting files | [`.agents/skills/`](.agents/skills/) (e.g. `risk-assessment/scripts/score.py`) |
| Per-role runtime/model defaults | Claude Code for most roles, Codex for the Reviewer; model and effort remain runtime-specific |

## Try it

```bash
harnessfile validate examples/altavox
harnessfile sync examples/altavox --target claude-code          # dry-run: shows the plan
harnessfile sync examples/altavox --target codex --apply        # generates .codex/agents/*.toml
harnessfile up examples/altavox                                 # headless runtime
```

## Fidelity notes

This is the real AltaVox harness with light trims for example purposes: the Designer role card is
condensed (the production one is ~34 KB) and its skill list — plus the Copy Writer's — is trimmed to
the skills bundled here; internal repository URLs are genericized. In production the operational
fields (model, runtime, thinking-level, concurrency, env) are owned by Multica; the role-card
values here are portable defaults that seed that target at bootstrap.
