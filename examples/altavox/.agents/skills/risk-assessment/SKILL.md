---
name: risk-assessment
description: >
  Assess the delivery risk and ambiguity of an issue. Scores three anchored 1-5 risk dimensions —
  Code Blast Radius, Complexity, Business Blast Radius — into an overall risk level (Low/Medium/High)
  with safeguards, plus a separate Ambiguity score (how many open questions remain) with the open
  questions listed. Use this BEFORE work starts, whenever someone wants to know how risky, how big,
  how complex, or how well-specified an issue is, or asks to "assess risk", "risk assessment", "score
  this issue", "how risky is this", "what's the blast radius", "how complex is this", "how ambiguous
  is this", or "how many open questions are there". Accepts a Multica issue ID, a GitHub issue/PR, or
  a free-text description as the argument.
---

# Risk Assessment

Score a single issue across three **risk** dimensions plus a separate **ambiguity** signal, and turn
them into an actionable verdict. This runs **early — before the change is planned or approved** — so
both the risk and the open questions are understood up front, not discovered after an incident.

**Risk and ambiguity measure different things and are kept separate.** Risk (blast radius +
complexity) is *how bad it is if the code is wrong* — a "build it right" signal. Ambiguity is *how
likely we are to build the wrong thing* — a "build the right thing" signal. A task can be high on one
and low on the other, so ambiguity is **never folded into the risk number**; it is reported on its own.

## Principles

- **Reason per dimension, then score.** For each dimension, write the reasoning first and assign
  the number last. A bare number with no justification is not acceptable.
- **Anchor to evidence, not vibes.** Every score must cite the concrete files, modules, services,
  or features that drive it. If you can't point to evidence, you haven't grounded the score.
- **Use the anchored rubric.** Each level (1-5) has a named definition below. Match the issue to
  the closest anchor; don't default to 3.
- **List the open questions.** For ambiguity, don't just score it — enumerate the actual unresolved
  questions a human would have to answer. The count and weight of those questions *is* the score.
- **Judgment is yours; the math is deterministic.** You assign the four scores; `scripts/score.py`
  computes the overall risk level, the ambiguity band, and safeguards so the verdict is reproducible.
- **Declare confidence.** For each dimension, note your confidence (high/medium/low) and the single
  biggest unknown that could move the score.

## Step 1 — Resolve the input (auto-detect the source)

The argument is an issue identifier or a raw description. Detect which:

- **Multica issue** — an issue ID/slug, or a `multica.ai` URL. Fetch it:
  ```bash
  multica issue get <id> --output json          # title, description, status, metadata
  multica issue comment list <id> --output json # comments (may contain existing research)
  ```
  Set `source = multica`.
- **GitHub issue/PR** — a `#number`, an `owner/repo#number`, or a github.com URL. Fetch with
  `gh issue view <n> --json title,body,comments` (or `gh pr view`). Set `source = github`.
- **Free text** — anything else. Use the text as-is. Set `source = text`.

If the identifier is ambiguous or the fetch fails, tell the user what you tried and fall back to
treating the argument as free text.

## Step 2 — Gather grounding context (reuse research if it already exists)

**First check whether research already exists — if so, do NOT re-explore the codebase:**

- A `RESEARCH.md` in the repo root (written by the `/research` skill).
- A research / Planner-handoff comment already on the Multica issue (from `comment list` in Step 1).
- Substantial code context already gathered earlier in this conversation.

If grounded research exists, read it and score from it.

**Otherwise, run a scoped, read-only risk exploration** — focused on risk signals only, not a full
research pass. Use the `Explore` agent or grep/read to determine:

- **Affected surface:** which files/modules a solution would touch (`server/`, `web/`, both?).
- **Fan-out / coupling:** who imports or calls the affected code — how far a change ripples.
- **Test coverage:** do the touched areas have tests, and at what tier (mocked/VCR/integration)?
- **Cross-cutting touches:** DB migrations, GraphQL schema changes (which force frontend codegen),
  auth/account/tenant propagation, shared job infrastructure.

Keep it tight. The goal is enough evidence to anchor the scores, not an exhaustive map.

**Ambiguity is best assessed last — as the residue.** Score it *after* research, against whatever
open questions research could not resolve. Research exists precisely to drive out ambiguity, so the
ambiguity score reflects the questions that genuinely still need a human, not everything that was
once unclear.

## Step 3 — Score the dimensions

For each dimension, match the issue to the closest anchor, write the reasoning with cited evidence,
then record the 1-5 score, your confidence, and the top unknown. The first three are **risk**
dimensions (they feed the risk number); **Ambiguity** is scored and reported separately.

### Code Blast Radius — *how much of the code a solution will affect*

| Score | Anchor |
|---|---|
| **1 — Pinpoint** | A single file/component; no exported/shared symbols; isolated. Copy, one Tailwind class, one self-contained function. No migration, no schema change. |
| **2 — Local** | A handful of files within one feature/module; limited fan-out; stays inside one app (server *or* web). No DB migration, no GraphQL schema change. |
| **3 — Module-wide** | A whole feature or one GraphQL type end-to-end (schema + resolver + frontend query + codegen). Moderate fan-out; may include a backward-compatible migration; crosses server↔web in a contained way. |
| **4 — Cross-cutting** | Shared infrastructure many features import (base models, shared jobs, core GraphQL types), OR a non-trivial/destructive migration, OR a change rippling across many call sites. High fan-out across both apps. |
| **5 — Systemic** | Foundational plumbing used almost everywhere — core data-model relations, the job/`INSTANCE` framework, account/tenant propagation, middleware/contextvar layer, or a sweeping multi-dozen-file refactor. Hard to bound. |

### Complexity — *how complex the solution is*

| Score | Anchor |
|---|---|
| **1 — Trivial** | Obvious one-step change following a known pattern; config/styling/copy; no real logic. High confidence. |
| **2 — Simple** | Straightforward CRUD/component on an existing pattern; minimal logic; no new concepts. Low uncertainty. |
| **3 — Moderate** | Several components wired together; some non-trivial logic, or a new GraphQL type + job, or a known 3rd-party/async path. A few decisions, but the path is clear. |
| **4 — Complex** | Significant new logic, async/concurrency coordination, consistency/race concerns, new data modeling, or an unfamiliar integration. Several unknowns; needs a real plan and careful testing. |
| **5 — Very complex** | Deep/novel problem — distributed or concurrent correctness, large interdependent refactor, ML/matching/embedding logic, performance-critical paths, or major unknowns. Expect iteration; hard to estimate. |

> **Watch for deceptively simple framings.** A short ask like "clean up the bad data", "figure out why X is slow/broken", or "fix the flaky Y" hides its work in an *unknown root cause or messy state* — the effort is unbounded until you've diagnosed it, and the fix is often larger than the request implies. Score these by the likely effort to resolve the unknown, not the brevity of the ask: investigation, data-cleanup, and "why is this broken" debugging tasks routinely land at **3–4** even when stated in one line. (The flip side also holds — a request that *sounds* sweeping but names one concrete, well-scoped change stays low.)

### Business Blast Radius — *how critical the affected business features are*

| Score | Anchor |
|---|---|
| **1 — Cosmetic** | Internal tooling, docs, styling, copy. A failure is invisible or trivial to users. No data, revenue, or trust impact. |
| **2 — Peripheral** | A non-core, low-traffic feature. A failure annoys a few users; the core product keeps working. Easily reversible; no data-integrity concern. |
| **3 — Important feature** | A feature users rely on regularly (Brainstorm/Ideas/Search, data ingestion inputs). A failure degrades the experience or blocks a workflow, but no data loss or cross-account exposure. |
| **4 — Core product value** | The **core analysis pipeline** (AnalysisConfig → AnalysisReport → Topic, comment/topic matching, report generation) or the data its outputs depend on. A failure breaks the product's main value or corrupts analysis for many users. |
| **5 — Critical / trust & safety** | **Auth & tenant isolation**, account/data separation, security, or billing/data-loss/total-outage surfaces. A bug risks cross-account leakage or catastrophic, possibly regulatory, harm — not just a broken feature. |

### Ambiguity — *how many open questions survive research* (separate signal, not part of risk)

Enumerate the actual unresolved questions first, then pick the anchor that matches their count and weight.

| Score | Anchor |
|---|---|
| **1 — Crystal clear** | Fully specified. Acceptance criteria obvious, intended behavior unambiguous. Zero open questions. |
| **2 — Minor unknowns** | One or two small decisions the team can safely make itself (a default value, a label). No human input needed. |
| **3 — Some open questions** | A few decisions that benefit from product input but aren't blocking; reasonable defaults exist. A human *should* weigh in. |
| **4 — Significantly underspecified** | Multiple open questions about scope, behavior, or intent. Building without answers risks building the wrong thing; a human *must* weigh in before committing to a plan. |
| **5 — Wide open / exploratory** | The problem itself is fuzzy ("make onboarding better"). Needs discovery and human framing before any plan; proceeding blind would almost certainly miss the mark. |

## Step 4 — Compute the verdict (deterministic)

Run the aggregation script with the four scores and the detected `--source`:

```bash
python .agents/skills/risk-assessment/scripts/score.py \
  --complexity <1-5> --code-blast <1-5> --business-blast <1-5> --ambiguity <1-5> \
  --source <multica|github|text>
```

It returns JSON with `overall_score`, `risk_level` (Low/Medium/High via
`0.5·business + 0.3·code + 0.2·complexity`; Low ≤2.3 · Medium ≤3.6 · High >3.6), `safeguards`, and a
separate `ambiguity` block (`score` + `band`: 1-2 low · 3 medium · 4-5 high). Ambiguity is **not** in
the risk formula. Use these verbatim — do not recompute by hand.

## Step 5 — Deliver

Render the report in this format:

```markdown
## Risk Assessment — <issue title or summary>

| Dimension | Score | Why |
|---|---|---|
| Code Blast Radius | N/5 | <one line + cited evidence> |
| Complexity | N/5 | <one line + cited evidence> |
| Business Blast Radius | N/5 | <one line + cited evidence> |

**Overall risk: <Low/Medium/High>** (<overall_score> — weighted 0.5·business + 0.3·code + 0.2·complexity)

**Ambiguity: N/5 (<low|medium|high>)** — <one line on how open-ended the issue is>

**Open questions** (the unresolved questions behind the ambiguity score)
- <each open question a human would need to answer; "none" if fully specified>

**Watch-outs**
- <each safeguard from the script>

**Confidence & unknowns**
- <per-dimension confidence + the biggest unknown that could move a score>
```

**Then deliver the output based on the source:**

- **`source = multica`** — write the assessment back to the issue:
  ```bash
  # Human-readable report as a comment (preserves the markdown verbatim):
  printf '%s' "<report markdown>" | multica issue comment add <id> --content-stdin

  # Machine-readable scores as metadata (queryable by the PM when it routes the issue):
  multica issue metadata set <id> --key risk_code_blast      --value <N>
  multica issue metadata set <id> --key risk_complexity      --value <N>
  multica issue metadata set <id> --key risk_business_blast  --value <N>
  multica issue metadata set <id> --key risk_level           --value '"<Low|Medium|High>"'
  multica issue metadata set <id> --key risk_ambiguity       --value <N>
  ```
  Confirm to the user that the comment and metadata were written, and share the issue link.

- **`source = github` or `source = text`** — print the report to the terminal only. Do not write
  anywhere external.
