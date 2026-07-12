---
name: decision-record
description: Record a design decision in decisions.md following the project's D-number process — numbering, redaction of superseded decisions, contradiction check, and spec update. Use whenever a design decision is made, changed, or found to conflict with existing ones.
---

# Decision record

All design decisions live in `decisions.md` as a chronological record. This skill is the
process (from CLAUDE.md, D30):

## Recording a new decision

1. Find the highest existing D-number; the new decision is the next one.
2. Add it under the current session heading (create one: `## Session N — <title> (YYYY-MM-DD)`
   with a `Source:` line) as:
   ```markdown
   ### D<n>: <short imperative title>
   **Decision:** <what was decided, in one or two sentences>
   **Rationale:** <why — optional but preferred>
   **Impact:** <what it changes — optional>
   ```
3. Include the user's verbatim words as a **User quote:** when they capture the intent better
   than a paraphrase.

## Superseding

If the new decision replaces an earlier one:
- Mark the old title with `[redacted by D<n>]`, strike through its original text (`~~...~~`),
  and add a `**Superseded:**` note pointing forward.
- If only part of it is replaced, use `[amended by D<n>]` and add an `**Amended:**` note —
  no strikethrough.

## Contradiction check

Before finishing, scan existing decisions for conflicts with the new one. A contradiction is
never resolved silently: surface it to the human with both decisions quoted and ask which one
stands.

## Spec update

A decision is not done until `spec/` (current draft) reflects it. Schemas in `schema/` follow
in the same change when the decision has a field-level surface.
