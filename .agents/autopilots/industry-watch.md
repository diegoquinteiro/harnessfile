Run the weekly ecosystem sweep now.

Check what changed in the agent-harness ecosystem since the last sweep, comparing against what
`reviews/` already records (start from `reviews/2026-07-industry-research.md` and any later
sweep reports). Sources, in order:

1. **MCP** — spec changelog and blog (the 2026-07-28 revision and anything after): changes to
   Tasks, extensions, or the MRTR human-in-the-loop pattern affect our gate semantics (Open
   Item #7 in decisions.md).
2. **Standards** — Agent Skills (agentskills.io) spec changes and adoption; AGENTS.md / AAIF
   announcements; the community ".agents Protocol" draft; Oracle Agent Spec releases.
3. **Competitors/adjacent** — Multica changelog (especially anything config-as-code shaped),
   Microsoft Conductor and Agent Framework, GitHub Agent HQ custom agents, CrewAI declarative
   flows, LangGraph releases (our runtime).
4. **Conventions** — subagent format movements across Claude Code, Cursor, Codex, Gemini CLI.

Report only what is NEW, each item with a date and a primary-source link, and end with an
implications paragraph: which findings touch the spec, the CLI, or the UI, and whether any
contradicts a recorded decision (cite the D-number). File the report to
`reviews/watch/YYYY-MM-DD.md` and open issues for anything actionable. If nothing meaningful
changed, say exactly that in one line — do not pad.
