---
name: spec-consistency
description: Checklist that keeps every artifact of the Harnessfile spec in sync — spec prose, JSON Schemas, CLI validator, UI validation, examples, README. Run before closing any spec-facing change and during review of one.
---

# Spec consistency

The spec is one artifact expressed in six places. A spec-facing change is done only when all
of them agree. Walk the checklist; every "no" is a finding.

## The sync surface

| Artifact | Path | What must agree |
|---|---|---|
| Spec prose | `spec/v0.2-draft.md` | fields, defaults, semantics (normative) |
| JSON Schemas | `schema/*.json` | every field in prose exists here with the same default/enum |
| CLI validator | `packages/cli/src/validator/validate.ts` (+ `ir/normalize.ts` defaults) | same checks, same defaults |
| UI validation | `ui/src/lib/validate.ts` (+ `ui/src/types.ts`) | mirrors the CLI checks it can run client-side |
| Examples | `examples/minimal`, `examples/altavox` | still valid; new fields demonstrated when user-facing |
| README | `README.md` | core-ideas and examples sections not contradicted |

## Checklist

1. Grep the changed field/concept across all six paths — every occurrence updated or
   consciously exempted.
2. `cd packages/cli && npm test` — green.
3. `npx tsx bin/harnessfile.ts validate ../../examples/minimal` and `../../examples/altavox`
   — both valid.
4. `cd ui && npm run build` — clean (when UI surface changed).
5. Defaults stated in prose match `normalize.ts` and the schemas (`default:` keys).
6. Decision recorded (decision-record skill) when the change alters what the standard says.

## Smell tests

- A field only in the schema, or only in prose → inconsistency.
- The CLI accepts what the schema rejects (or vice versa) → inconsistency.
- An example that no longer round-trips through the UI byte-identical → regression.
