---
name: fermata-fidelity
description: The non-negotiable Fermata design-system rules for the Harnessfile UI, plus how to verify a change against them. Use on every visual change to ui/ and when reviewing one.
---

# Fermata fidelity

The editor (ui/) is a Fermata artifact — editorial restraint, warm printed palette, hairline
precision. Source of truth lives in the fermata repo (`site/colors_and_type.css`,
`reference/components.css`, `DESIGN.md`); the tokens are replicated in `ui/src/styles/fermata.css`.
Never invent values — if a token is missing, port it from the source, don't improvise.

## Non-negotiables

- **Surfaces:** page is linho-base `#F5EFE0`, never `#fff`; near-black is carvão `#1A1A1B`,
  never `#000`. The carmine dot-matrix texture goes ONLY on the page/stage background — never
  on cards, panels, or dark surfaces.
- **Accent:** carmim `#B8001C` is THE accent, ≤10% of any screen; hover/depth is carmim-noite
  `#8B0010`. Exactly one carmine primary action per state.
- **Borders over shadows:** hairline carmine-tinted borders (`rgba(184,0,28,.14/.22/.40)`);
  shadows near-unused; depth = background changes.
- **Type:** Cormorant Garamond for display (one italic carmine word in the app title), Inter 300
  for body, DM Mono UPPERCASE tracked for labels/tags. `html { font-size: 20px }`.
- **Radii:** 2px buttons/inputs, 4px cards, `9999px` pills only. Nothing in between.
- **Theme:** light only (`color-scheme: light only`); dark surfaces exist only as intentional
  inverse panels (carvão bg, linen text).
- **Motion:** color transitions only, 0.12s/0.22s ease; no scale, translate, or bounce;
  respect `prefers-reduced-motion`.
- **Voice:** sentence case, no emoji, no gradients, no exclamation marks.

## Verify

1. Run the app and screenshot the changed screens (headless browser).
2. Check each screenshot against the list above — texture placement, carmine budget, border
   weights, and type families are where regressions hide.
3. `npm run build` and lint clean.
4. Round-trip check when the change touches parsing/serialization: open the demo, edit one
   entity, export, diff — only the edited file changes.
