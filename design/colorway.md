# Colorway — "Ashfall & Ember" (v0.1)

The core visual system for Zurvival Reborn. This is the **canonical palette**: every client
(web, native, and the future chat-bot), every tool, and every doc pulls from it. The machine
source of truth is [`tokens.css`](tokens.css); this file is the human rationale and the rules.

> **The one rule.** The base is desaturated warm charcoal. Saturated color is *rationed* — it
> is only ever spent to **communicate**, never to decorate. If a color isn't carrying meaning,
> it shouldn't be there. (See GDD Part XVII.)

## Palette

| Token | Hex | Role | Where it's used |
| --- | --- | --- | --- |
| `--bg` | `#0E0F10` | Base | App background — the dark you read on |
| `--surface-1` | `#17181B` | Surface | Story card, panels, sheets |
| `--surface-2` | `#1E2024` | Raised | Choice rows, list items, cards |
| `--surface-3` | `#26282E` | Elevated | Hover / pressed surfaces |
| `--line` | `#2C2E34` | Hairline | Borders, dividers |
| `--line-strong` | `#3A3D45` | Divider | Stronger separation, device edge |
| `--text` | `#EDE7DB` | Text · Bone | Primary body copy — the star |
| `--text-2` | `#B7B3A9` | Text 2 | Secondary copy |
| `--muted` | `#8B8981` | Muted | Meta, labels, timestamps (mono) |
| `--accent` | `#F2803A` | **Ember** | Action, links, focus, anything interactive |
| `--danger` | `#D84334` | **Blood** | Combat, low health, threats |
| `--infection` | `#93A63E` | **Bile** | Infection symptoms, toxins |
| `--hope` | `#5FB3A1` | **Clean water** | Relief, safe, success, rescue |
| `--info` | `#5C7A94` | **Steel** | Radio, map, night, quiet info |
| `--warning` | `#E0A33B` | **Amber** | Caution, thresholds |

## What each hue *means*

Color is a language here. Keep the vocabulary tight so players learn to read it:

- **Ember `--accent`** — "you can act on this." Interactive nouns in prose, choice edges,
  links, focus rings, the active nav item. If it glows ember, it does something.
- **Blood `--danger`** — "this can hurt you." Threat nouns, low-health vitals, combat framing,
  destructive costs (e.g. `NOISE +12`).
- **Bile `--infection`** — "this is sickness." Infection tags (`FEVERISH`, `INFECTED · II`),
  toxins, spoilage, a feverish survivor's glyph. Never used for anything healthy.
- **Clean water `--hope`** — "relief / safe." Home, rescue, success, the flee-to-safety option,
  the `ARTIFACT` tag. The palette's warmth-of-relief.
- **Steel `--info`** — "the world speaking quietly." Radio signals, the map, night, micro-info.
- **Amber `--warning`** — "watch this." Thresholds crossing toward bad (fatigue, thin guard).

Because the base is desaturated, a single saturated element reads instantly. That is the whole
point — protect it by never over-using color.

## Do / Don't

**Do**
- Keep text on `--bg`/`--surface-1`; keep the reading surface calm.
- Pair every hue with a **label or icon** — color is never the sole signal (accessibility).
- Use the `-wash` tints for tag/state backgrounds; keep the hue itself for text/edges.
- Let quiet screens be quiet: mostly `--bg`, one ember hairline.

**Don't**
- Don't tint whole backgrounds with a hue (no red "combat mode" full-bleed — reddening the
  *frame and threat words* is enough).
- Don't use `--hope` and `--infection` next to each other for adjacent meanings — the green/teal
  read can blur; separate them with neutrals.
- Don't introduce a new accent color for a feature. Extend meaning within these seven.
- Don't use gradients or glows as decoration.

## Accessibility

- **Body text** `--text` on `--bg` clears WCAG AAA — the game is text-first, so reading comfort
  is non-negotiable. Ships with a **high-contrast** mode (`[data-contrast="high"]` in
  `tokens.css`) and scales to 200%.
- `--accent`, `--infection`, `--hope` meet AA for normal text on the dark base. `--danger` and
  `--info` are reserved for **large text, icons, edges, and accents** (≥14px semibold), not long
  body copy, where their contrast is tighter.
- Every color meaning is duplicated in text/iconography (e.g. infection is the word `FEVERISH`,
  not just a green pixel), so the palette is fully legible to colorblind and screen-reader users.

## States & degradation

- **Feverish / infected** — as infection advances, story text desaturates and letter-spacing
  drifts; the bile tag is the only overt tell. The palette bends to carry the symptom.
- **Power out** — when the grid fails, the whole UI dims one step and the header loses color;
  night screens go darker. The interface tells the world's story too.

## Using the tokens

Import once, reference by variable — never hard-code hex:

```css
@import "design/tokens.css";
.choice        { background: var(--surface-2); border-left: 3px solid var(--accent); }
.choice .cost  { color: var(--danger); font-family: var(--font-mono); }
.tag-infected  { color: var(--infection); background: var(--infection-wash); }
```

For non-CSS tooling, the same values as data:

```json
{
  "bg": "#0E0F10", "surface1": "#17181B", "surface2": "#1E2024", "surface3": "#26282E",
  "line": "#2C2E34", "lineStrong": "#3A3D45",
  "text": "#EDE7DB", "text2": "#B7B3A9", "muted": "#8B8981",
  "accent": "#F2803A", "accentPress": "#D96A28",
  "danger": "#D84334", "infection": "#93A63E", "hope": "#5FB3A1",
  "info": "#5C7A94", "warning": "#E0A33B"
}
```

See the palette applied to every screen in [`wireframes.html`](wireframes.html).
