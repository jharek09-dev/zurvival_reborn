# Design notes

Supporting design work that isn't the GDD or PRD themselves.

## Visual design system — "Ashfall & Ember"

The canonical look of the game. Used across every client and tool.

- [`colorway.md`](colorway.md) — the palette spec: what each hue means, do/don't rules,
  accessibility, and usage. **Read this before touching color.**
- [`tokens.css`](tokens.css) — the machine source of truth (CSS custom properties). Import
  it; never hard-code hex.
- [`wireframes.html`](wireframes.html) — the wireframe kit: the palette applied to every key
  screen (exploration, combat, inventory, companions, shelter, map, journal, the Quiet
  Screen), fully annotated. Open in a browser.

## Other

- `diagrams/` — flowcharts and system maps (the simulation pipeline, the encounter
  pipeline, the state hierarchy, the survival curve). Keep a source format alongside any
  exported image where possible.
- `decisions/` — Architecture Decision Records. Any significant, hard-to-reverse choice
  gets a short record here so the *why* is not lost.
