# Art Bible — "Ashfall & Ember" (v0.1)

The canonical visual and asset specification for Zurvival Reborn. Where
[`colorway.md`](colorway.md) governs **color** and [`tokens.css`](tokens.css) is the machine
source of truth, this document governs **everything else you can see** — typography,
layout, iconography, illustration, motion, emotional states — and the **rules for making,
naming, and shipping every art asset**.

**Version:** 0.1 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`docs/GDD.md`](../docs/GDD.md) Part XVII (UI/UX) & XVIII (Audio) · [`colorway.md`](colorway.md) · [`tokens.css`](tokens.css) · [`wireframes.html`](wireframes.html)

> **The one rule.** Zurvival Reborn is a game made of words. Every visual decision either
> serves the reading or gets out of its way. Type is the art; color is a language; illustration
> is rationed. When in doubt, remove it and see if the scene is weaker. Usually it is stronger.

---

## 1. How to use this document

This is a **reference**, not a read-through. Find the section for the thing you are making,
follow its rules, run it through the checklist in §16 before it ships.

Precedence, when two documents seem to disagree:

1. [`tokens.css`](tokens.css) — the literal values (color, spacing, radius, type).
2. [`colorway.md`](colorway.md) — the meaning and rules for color.
3. **This document** — everything else visual, and all asset governance.
4. [`docs/GDD.md`](../docs/GDD.md) Part XVII–XVIII — the design intent this expands.

If this bible needs a value that isn't in `tokens.css`, the value is defined here **and added
to `tokens.css` in the same change** — the two never drift. Never hard-code a value that a
token already names.

---

## 2. Art direction — the north star

### The feeling

**Literary and melancholic.** Zurvival Reborn looks the way its best sentences read: grounded,
human, elegiac. This is not a splatter-horror aesthetic and not a military-tactical one. It is
the quiet after the sirens stop — a world that was warm and is now cold, remembered by someone
still living in it. There is beauty in the ruin, and the interface is the hand that turns the
page.

Horror is present, but it arrives through **restraint**, not volume: the dread of a light that
won't stay on, a name you can no longer read, a single red word in a calm paragraph. The
palette's name says it — **ash** (what everything has cooled to) and **ember** (the little
warmth left, and worth protecting).

### The five art pillars

Every asset should be traceable to at least one. They are the visual echo of the GDD's six
design principles.

1. **The word is the star.** Typography is the primary art form. Nothing on screen competes
   with the sentence the player is reading. (GDD Principle 1; Part XVII.)
2. **Color is meaning, never mood-lighting.** A saturated hue appears only to say something —
   danger, sickness, relief, an action. The base is ash so a single ember reads instantly.
   (colorway.md.)
3. **Restraint is the effect.** Empty space, stillness, and silence are chosen, not leftover.
   The heaviest moments have the least on screen. (GDD Part XVII, the Quiet Screen.)
4. **Everything remembers.** The interface carries history — a node you've scarred, an artifact's
   provenance, a scar on the map. Visuals accrue rather than reset. (GDD Principles 3 & 6.)
5. **The frame is honest and accessible.** No faked choices, no color-only signals, no
   decorative difficulty. A text game must be exceptionally legible to everyone. (GDD Part XVII.)

### The one-line brief for any asset

Before you make anything, answer this. If you can't, it isn't ready:

> *"This asset helps the player [understand / feel / remember] **\_\_\_**, using the least
> visual weight that does the job."*

### Verbal moodboard

We describe references in words on purpose — no external image is canon, so nothing anchors us
to another game's look.

- **Light:** a single working bulb in a dark room; dawn through smoke; a phone screen at 3 a.m.;
  candlelight on a page.
- **Surface & texture:** cooled ash, matte concrete, water-stained paper, warm charcoal, dried
  blood gone brown, the greenish cast of old fluorescents.
- **Kin in tone (not in look):** the melancholy of *Kentucky Route Zero*; the restraint of
  *Return of the Obra Dinn*'s single-ink world; the diegetic UI discipline of *Metro*; the
  literary weight of interactive fiction like *80 Days* and *Sorcery!*; the paperwork-dread of
  *Papers, Please*.
- **The feeling in one image:** a hand-annotated city map, folded soft at the creases, one
  street circled in ember, one crossed out in blood.

### Anti-references — what it is NOT

- Not neon apocalypse, not comic-book gore, not tacticool HUDs with corner brackets everywhere.
- Not a stat dashboard: no rows of bars, no XP fireworks, no loot rarity confetti.
- Not skeuomorphic grime for its own sake — no torn-metal frames, no dripping-blood typefaces.
- Not "gamified" motion: nothing bounces, pulses, or celebrates. Dread has no easing curve that
  overshoots.

---

## 3. Typography — the primary art

Type does the work other games give to environment art. It is the single most important visual
system in Zurvival Reborn, so it gets the most rules.

### 3.1 The type families

Three faces, each with one job. All are open-licensed (SIL OFL) so they embed on every client
without a licensing question (see §15).

| Role | Family | Why | Token |
| --- | --- | --- | --- |
| **Reading** (the story window — the star) | **Literata** | A humanist serif built for long-form on-screen reading; warm, literary, calm at length. Carries the "survival novel." | `--font-serif` |
| **Interface** (choices, headers, labels, buttons) | **Inter** | Neutral, exceptionally legible UI sans; disappears so the prose leads. | `--font-sans` |
| **Meta / machine** (costs, tags, timestamps, stats, radio) | **JetBrains Mono** | Monospace reads as "system / instrument," separating hard data from human prose. | `--font-mono` |

The division is semantic, not decorative: **serif = the world speaking to you; sans = you
choosing; mono = the machine measuring.** A player should feel the register change before they
can name it. Each family ships with a platform fallback stack (see `tokens.css`); Literata falls
back to Georgia/serif so an un-embedded client still reads correctly.

### 3.2 The type scale

Mobile-first, tuned so the story window is comfortable to read for an hour. Sizes are the phone
baseline; the web/desktop client may scale up one step but never changes the ratios. All are
added to `tokens.css` as tokens.

| Token | Size / line-height | Family · weight | Use |
| --- | --- | --- | --- |
| `--type-display` | 32 / 1.15 | Serif · 600 | Title cards, chapter breaks, the Quiet Screen line. Rare by design. |
| `--type-title` | 24 / 1.2 | Serif · 600 | Scene or section titles. |
| `--type-story` | 19 / 1.62 | **Serif · 400** | **Body prose — the star.** The default reading size. |
| `--type-story-lg` | 21 / 1.62 | Serif · 400 | Reader "large text" setting; also key emotional beats. |
| `--type-choice` | 17 / 1.35 | Sans · 500 | Choice labels. |
| `--type-body` | 15 / 1.5 | Sans · 400 | Secondary UI copy, menus, drill-downs. |
| `--type-meta` | 13 / 1.4 | Mono · 500, tracking +0.02em | Costs, tags, timestamps, stat readouts. Often uppercase. |
| `--type-micro` | 12 / 1.35 | Mono · 500 | Captions, footnotes, the smallest labels. |

Reading measure is capped at **60–68 characters** (`--measure: 64ch` guidance) regardless of
screen width — long lines break the reading trance. On wide screens the story column stays narrow
and centered; the margins are allowed to be empty. Emptiness is correct.

### 3.3 Prose treatment — the story window

The story window is a sacred space. Rules:

- **One column, generous margins, ragged right** (no justification — it opens rivers and hurts
  legibility). Paragraph spacing over indents.
- **Rhythm is authored.** A short paragraph after a long one is a held breath. Respect the
  content author's line breaks; the renderer never re-flows a deliberate single-line beat into a
  block.
- **No walls.** A scene is a few paragraphs, not an essay. If text overflows a comfortable
  screen, that is a content problem, not a scroll problem.
- **Never inside a bar or box that fights it.** The prose sits on `--surface-1` or `--bg` with a
  hairline at most. No card chrome around the sentence.

### 3.4 Semantic text styling — color inside prose

Color enters the prose only through the colorway's vocabulary, and only on **nouns the player can
act on or fear.** This is how the game teaches its language without a legend.

| In-prose treatment | Meaning | Token |
| --- | --- | --- |
| Interactive noun (a door, a **toolbox**) | "you can act on this" | `--accent` (Ember) |
| Threat noun (the **shape** in the hall) | "this can hurt you" | `--danger` (Blood) |
| Infection / sickness word (`FEVERISH`) | "this is sickness" | `--infection` (Bile) |
| Relief / safe (**home**, rescue) | "relief" | `--hope` (Clean water) |

Rules: at most a **few colored words per scene** — if everything glows, nothing does. Color is
never the only cue (the interactive door is also underlined-on-focus and tappable; the threat is
also named as a threat). Never color a verb or a whole sentence. See colorway.md §"What each hue
means."

### 3.5 Voice-in-type — registers

Different sources of text look different so the player always knows who is speaking:

- **Narration / the world:** Literata, `--text` on `--bg`. The default.
- **Radio & broadcasts:** JetBrains Mono, `--info` (Steel), slightly reduced contrast, often
  prefixed with a tuning glyph. Reads as a signal, not a voice. (GDD Part XIII/XVIII.)
- **Remembered / dream text:** Literata *italic*, `--text-2`, tighter leading — a memory
  resurfacing (ties to the dynamic-audio-memory device, GDD XVIII).
- **Survivor dialogue:** Literata, quotation-led, the speaker's name in `--muted` mono above.
- **System / diegetic notes** (a note you scrawled, an inventory line): Mono, `--muted`.

### 3.6 Degradation — type that carries symptoms

The type system bends to tell the body's story (colorway.md §"States & degradation"):

- **Feverish / infected:** as infection advances, story text **desaturates** toward `--muted`
  and **letter-spacing drifts** (+0.01 → +0.03em by stage); the `FEVERISH` / `INFECTED · II`
  bile tag is the only overt tell. The reading gets subtly harder — the player *feels* unwell.
  Never so much that it fails accessibility or WCAG AA at the reading size.
- **Power out:** the whole UI dims one step and the header loses color; the serif stays, night
  screens go darker. (GDD Part XVII.)
- **Hearing damage** (after a blast): a companion's dialogue may render partly `--muted` /
  spaced-out for a few turns — a visual caption of an audio consequence (GDD XVIII).

### 3.7 Typography rules

1. The story window is Literata; never set long prose in the UI sans.
2. Costs, tags, stats, timestamps, and radio are always mono. Human prose is never mono.
3. Cap the measure at ~64ch; ragged right; paragraph spacing over indentation.
4. Colored words are rare, always nouns, always paired with a second cue.
5. Every size is a token. If you need a new size, add it to `tokens.css`.
6. Reader text-scaling to 200% must never break a layout (§13).

---

## 4. Color — how art uses the palette

The full palette, meanings, accessibility, and do/don't live in [`colorway.md`](colorway.md) and
are **not duplicated here.** This section only covers what color rules mean for *art and
illustration*, which colorway.md doesn't reach.

- **One ration, one budget.** The seven semantic hues (`--accent`, `--danger`, `--infection`,
  `--hope`, `--info`, `--warning`) are the *entire* saturated vocabulary. Illustration invents no
  new hue — a region wash that needs "warmth" uses Ember; "cold/night" uses Steel. Extend meaning
  within the seven; never add an eighth.
- **Duotone is the house rendering.** Spot art is built as a **duotone**: shadows map to `--bg` /
  warm charcoal, highlights to `--text` (Bone), with **at most one** semantic hue introduced as
  the accent ink for that image (usually Ember or Steel). This keeps every illustration native to
  the palette and cheap to produce (§7.5).
- **Backgrounds stay ash.** Never flood a screen or a card with a hue (no red "combat mode"
  full-bleed). Reddening the *frame and the threat words* is the whole effect.
- **Washes, not fills.** For tag/state backgrounds use the `-wash` tints from `tokens.css`; keep
  the pure hue for text, edges, and the single accent ink.

---

## 5. Layout, grid & spacing

### The primary screen

A single vertical stack, phone-first (GDD Part XVII). Top to bottom:

```
┌──────────────────────────────────────┐
│ HEADER   day · time · place · weather │  slim, mono meta, hairline under
├──────────────────────────────────────┤
│ STATUS   only critical stats          │  restrained; infection is symptoms, not a bar
├──────────────────────────────────────┤
│                                      │
│ STORY WINDOW   the scene prose        │  the star — serif, ~64ch, generous margins
│                                      │
├──────────────────────────────────────┤
│ CHOICES   a few options + known costs │  sans labels, mono cost chips
├──────────────────────────────────────┤
│ FOOTER   menu access (map/pack/…)     │  quiet, icon-led, one tap to depth
└──────────────────────────────────────┘
```

Everything else — inventory, map, companions, journal, shelter — is a **drill-down**, never
crowding the main view. One decision at a time.

### Spacing & measure

- Use the 4-based spacing scale from `tokens.css` (`--s1`…`--s6`). No off-scale margins.
- Vertical rhythm favors air: `--s5`/`--s6` between the story window and its neighbors so the
  prose has room to breathe.
- Radius tokens `--r-sm/md/lg` only; the phone frame uses `--r-phone`. Nothing else invents a
  corner.
- **Touch targets ≥ `--tap-min` (44px).** Choice rows are full-width tap zones.
- Elevation is restrained: `--shadow-card` for genuinely floating sheets only. Flat by default.

### Layout rules

1. One primary column; depth is a drill-down, not a panel that competes.
2. Only critical stats live on the main screen; everything else is one tap away.
3. Everything aligns to the spacing scale and radius tokens.
4. Let quiet screens be quiet — mostly `--bg`, one ember hairline (§12).

---

## 6. Iconography

Icons are a support act — signposts for menus and tags, never a replacement for a word. The
game's default state is text; an icon earns its place only where it's faster than reading and
appears repeatedly.

### The icon system

- **Style:** single-weight **line icons**, geometric-humanist, drawn on a **24×24 grid** with a
  **1.75px stroke**, round caps and joins, `--r-sm`-consistent corner feel. Optically balanced,
  not pixel-fitted.
- **Ink:** icons inherit text color by default (`currentColor`). A semantic hue is applied only
  when the icon *is* the signal (a bile-green infection glyph, an ember action glyph).
- **Metaphors stay concrete and survival-literal:** a pack, a wrench, a flame, a droplet, a
  waveform (radio), a footprint (noise), a moon (night), a pin (location). No abstract
  corporate glyphs.
- **Sizes:** 16 (inline/meta), 20 (choices/footer), 24 (headers). Never scale a 24 icon below 16;
  draw the small size if needed.

### Icon rules

1. An icon never carries meaning alone — it pairs with a label or a known, taught context
   (accessibility, GDD Part XVII).
2. One visual weight across the whole set; a heavier or filled icon means a *state* (active/
   selected), not a different topic.
3. SVG only, `currentColor`, no baked-in color or gradients (§15).
4. If a concept is used once, use a word, not a new icon.

---

## 7. Illustration & spot art — the "type + spot art" policy

Illustration exists, and it is **rationed like color.** The rule of thumb: a run should be
*carried by prose* and *punctuated by images*, never illustrated wall-to-wall. Most survivors,
rooms, and monsters are drawn in the player's head by the writing. Art appears at the few moments
where a held image deepens memory.

### 7.1 Where illustration is allowed

| Use | Frequency | Notes |
| --- | --- | --- |
| **Key art / cover** | A handful | Marketing, title screen, store. The one place the look is fully rendered. |
| **Region & scene washes** | ~1 per region + rare pivotal scenes | Near-abstract atmosphere behind/above the header. Duotone, low detail. |
| **Artifact & signature-item cards** | Only true artifacts | A small treated image for items that carry provenance (GDD Principle 6). Ordinary loot is text + icon. |
| **Named-companion portraits** | Key survivors only | Optional, stylized, small. Not the whole 60–100 pool. |
| **Chapter / ending plates** | Endings, major story beats | A single held image to mark a threshold. |

### 7.2 Where illustration is forbidden

- Behind or around live **story prose** (never illustrate the sentence being read).
- **Ordinary items, ordinary zombies, ordinary rooms** — these are the writing's job.
- As decoration on menus, loading, or empty states. Empty states get a line of type, not a
  drawing.
- Any image that competes with a choice for attention at the moment of deciding.

### 7.3 Region & scene washes

Atmospheric, not illustrative. Think a single-ink print of a skyline in smoke — **low detail,
high mood, heavy negative space.** They sit at very low contrast so header text stays readable on
top (they never drop text below AA). One per region establishes place; the world's *changes*
(threat, fire, power-out) are shown by **dimming/desaturating the same wash**, not by swapping
art — the image remembers, like the node does (§2, pillar 4).

### 7.4 Artifacts, items & portraits

- **Artifacts** get a small duotone card image plus their history line in mono. The image is
  understated — a worn object, not a hero render — because the *story* is the value.
- **Ordinary items** are an icon + name. No bespoke art. (This is what keeps a 60–100 survivor,
  many-item game shippable.)
- **Portraits**, when used, are **stylized and monochrome/duotone** — charcoal-sketch or
  reductive woodcut, expressive silhouette over likeness, never photoreal, never a portrait
  "bust in a frame." Reserved for companions and pivotal named survivors; the rest are evoked in
  prose. A missing portrait is fine — a neutral monogram tile stands in, and that's an accepted
  state, not a gap.

### 7.5 Technique & rendering rules

1. **Duotone in the palette** (§4): charcoal shadows, Bone highlights, one semantic accent ink
   per image. No off-palette color.
2. **Restraint over rendering:** suggest, don't detail. Grain and negative space over texture and
   clutter. A little **film grain** (subtle, static) is the house texture; nothing else.
3. **No gore-for-shock, no jump-scare imagery.** Horror is implication (a stain, an empty bed),
   consistent with the melancholic tone and content ratings.
4. **Readability first:** any image under text must pass the contrast bar for that text (§13).
5. Every illustration is optional to the *information* — the game is fully playable and
   understandable with all art replaced by its alt text (§13, chat-bot client).

---

## 8. Component visual language

The recurring pieces, all built from tokens. See them rendered in
[`wireframes.html`](wireframes.html).

- **Choice row:** full-width, `--surface-2`, a **3px `--accent` left edge**, `--r-sm`. Label in
  sans (`--type-choice`); known costs as **mono chips** on the right. Pressed = `--accent-press`
  edge + `--surface-3`. The whole row is one ≥44px tap target.
- **Cost chip:** mono, `--type-meta`, hue by kind — `NOISE +12` in `--danger`, `TIME 30m` in
  `--muted`, a resource cost in `--muted`. Shows what's *known*; never reveals hidden outcome.
- **Tag / state pill:** mono uppercase on a `-wash` background, hue text — `INFECTED · II`
  (bile), `ARTIFACT` (hope), `SAFE` (hope), `WOUNDED` (blood). Always word + color, never color
  alone.
- **Status readout (header/status row):** mono meta, `--muted` labels, value in `--text`; a
  value crossing a threshold takes `--warning`, a critical one `--danger`. No bars for hidden
  fields (infection/stress/morale are prose, per GDD Part VI).
- **Header:** slim, mono meta — `DAY 07 · 03:14 · Downtown · rain`. Hairline under. Loses color
  on power-out.

Rule: a new component is assembled from existing tokens and these patterns before any new visual
primitive is invented. If it needs something genuinely new, it's added to `tokens.css` and noted
here.

---

## 9. Map & journal visual identity

The map is **a journal you annotate**, not a minimap (GDD Part VII).

- **Aesthetic:** a hand-marked paper city on `--surface-1` — thin Steel (`--info`) roads and
  district lines, Bone labels, `--muted` for the unknown.
- **Fog of war:** unexplored = flat `--bg`, no outline. Discovery *reveals*, and revealed stays
  revealed (memory).
- **Annotations accrue:** player notes in a "handwritten" register (Literata italic, `--text-2`);
  auto-history marks in mono. A scavenged node dims; a dangerous one carries a small `--danger`
  mark; a home/safe node an `--hope` mark; a barricaded one an ember mark. The map *is* the run's
  memory made visible.
- **No live radar, no enemy blips.** Threat is inferred from marks and prose, not tracked in real
  time.

The **journal / codex** (discovered lore, rumors, memorials) uses the reading serif on
`--surface-1`, like a real book — the one place text density is welcome, because the player chose
to sit and read.

---

## 10. Radio visual identity

The radio has its own sonic identity (GDD XVIII); it gets a matching visual one, all in **Steel
(`--info`)** — "the world speaking quietly."

- Broadcast text in mono, `--info`, reduced contrast, a leading tuning/waveform glyph.
- A minimal **waveform or static texture** (Steel on ash) marks a live signal; a lost signal
  decays to `--muted` flat.
- An "signal that shouldn't exist" (GDD XIII) breaks the rule *once* — that's its power. Reserve
  a single visual anomaly for it; document it when authored.

---

## 11. Motion & animation

Minimal and **diegetic** (GDD Part XVII). Motion is a tone instrument, never game-feel candy.

| Allowed | Meaning |
| --- | --- |
| Text arriving with slight weight/fade | the world "speaks"; sets reading cadence |
| A flicker on a failing light / power event | the world's state, shown not told |
| A held stillness (deliberate pause before a beat lands) | dread, the Quiet Screen |
| Gentle crossfade between scenes | turning a page |

**Forbidden:** bounce/overshoot easing, spinners-as-personality, celebratory pops, parallax
flourish, anything that undercuts dread. All motion respects **reduced-motion** (§13): every
animation has a static equivalent, and reduced-motion is honored globally. Durations are short
(120–240ms) and eased calm (standard ease-out, no overshoot).

---

## 12. Emotional UI states

The interface is an instrument of tone. Four canonical states change the look:

- **The Quiet Screen** (after a death or loss): UI strips to bare `--bg`, a single line of serif
  `--type-display`, and **one** way forward. No stats, no header, no color but the text. Give the
  moment room. (GDD Part XVII.)
- **Feverish / infected:** §3.6 — prose desaturates, letter-spacing drifts, bile tag present.
- **Power out:** whole UI dims one step, header loses color, night goes darker. (§3.6.)
- **Night / high tension:** darker base, more negative space, fewer options surfaced; the
  director's read of the moment can quiet the screen (GDD Part IV/XVI).

These are **built from the same tokens** at reduced intensity — never a separate skin. Tone comes
from subtraction.

---

## 13. Accessibility as an art constraint

First-class, not a checkbox (GDD Part XVII). These are hard requirements on every asset:

- **Reading comfort is non-negotiable.** Body text (`--text` on `--bg`) clears WCAG **AAA**;
  ships a **high-contrast** mode (`[data-contrast="high"]`, tokens.css) and scales to **200%**
  without breaking layout.
- **Color is never the sole signal.** Every hue meaning is duplicated in a word or icon (bile
  green is *also* the word `FEVERISH`). Verified for colorblindness and screen readers.
- **Contrast bars for art:** any text over a wash/illustration meets AA for its size; reserve
  `--danger`/`--info` for ≥14px semibold, icons, and edges — not long body copy (colorway.md).
- **Reduced motion & reduced flicker** modes are honored globally; flicker effects (failing
  lights) are capped and disabled in reduced-flicker.
- **Every image has alt text**, every audio cue a visual/caption equivalent (GDD XVIII). Alt text
  is authored *with* the asset, not after (§15).
- **Screen-reader excellence:** the game is mostly text and should read beautifully; visual order
  = DOM/reading order.

### The chat-bot / plain-text floor

The engine is headless and one target is a messaging client (GDD Part XVII, DESIGN.md §10). So
the visual language has a **plain-text floor**: the game must be fully playable and legible with
**no color, no icons, and no illustration** — hues degrade to their words (`[INFECTED · II]`),
icons to labels, art to alt text. If a design only works in full color, it's wrong. Design the
meaning in text first, then let color and image *reinforce* it.

---

## 14. Cross-client scaling

One visual language, three fidelities, degrading gracefully:

1. **Web / mobile (reference):** the full system in this bible; phone-first, then scaled up.
2. **Native app:** identical system; may use platform type rendering and larger reading sizes.
3. **Chat-bot / plain text:** the §13 floor — words, spacing, and mono conventions only.

The core never renders (DESIGN.md §10): it emits a `Scene`; the client draws it using this
bible. Tokens are the contract that keeps every client consistent.

---

## 15. Asset rules & governance

The production law for every file in `assets/`. Mirrors the content-as-data discipline of
[`CONTRIBUTING.md`](../CONTRIBUTING.md) and DESIGN.md §8.

### 15.1 Directory structure

Extends [`assets/README.md`](../assets/README.md). One purpose per folder:

```
assets/
├── art/
│   ├── icons/         # SVG line icons (the §6 set)
│   ├── key-art/       # cover, title, marketing — the fully-rendered look
│   ├── regions/       # one atmospheric wash per region
│   ├── scenes/        # rare pivotal-scene / chapter / ending plates
│   ├── artifacts/     # treated images for provenance items only
│   ├── portraits/     # stylized named-companion portraits (optional)
│   ├── brand/         # logo, wordmark, favicons, social
│   └── source/        # layered/editable source (see 15.4)
├── audio/             # governed by GDD Part XVIII (cross-ref only)
└── README.md
```

### 15.2 Naming conventions

Match the repo's content convention — lowercase **kebab-case**, one meaningful entity per file,
readable diffs (CONTRIBUTING.md).

- **Pattern:** `<category>-<entity>[-<variant>][@<scale>].<ext>`
- **IDs match content IDs.** A region wash is named for its region id so engine + art line up:
  `region-downtown.webp`, `region-downtown-power-out.webp`.
- **Icons:** `icon-<concept>.svg` — `icon-pack.svg`, `icon-noise.svg`, `icon-radio.svg`.
- **Artifacts/portraits:** by content id — `artifact-fathers-watch.webp`,
  `portrait-sarah.webp`.
- **Raster scales:** suffix `@1x/@2x/@3x`. No spaces, no capitals, no version numbers in
  filenames (git is the version history). `lf` line endings, UTF-8 (`.editorconfig`).

### 15.3 File formats

| Asset | Format | Rule |
| --- | --- | --- |
| Icons, logo, wordmark, simple line art | **SVG** | `currentColor`, no embedded raster, no baked color/gradient, stripped of editor cruft (run through SVGO). |
| Photographic/duotone illustration, washes, portraits | **WebP** (delivery) + **PNG** (fallback/source export) | sRGB, 8-bit; WebP quality tuned to budget (15.5). |
| Anything needing transparency at small size | SVG if vector, else PNG-24 | — |
| **Never** | JPG for UI art, GIF, ICO (except favicon), TIFF in delivery | JPG artifacts and GIF banding fight the duotone look. |

Color profile is **sRGB** everywhere; no wide-gamut assets (must match the token hexes on every
screen).

### 15.4 Source files

- Keep an **editable source** for anything non-trivial in `art/source/`, named to match its
  export (`region-downtown.<psd/afphoto/svg>`). "Source next to export where size allows"
  (assets/README.md).
- Prefer **non-destructive** layered files; document the duotone recipe (which hue as accent ink)
  in the file or a sidecar note so it's reproducible.

### 15.5 Optimization & budgets

The game is **mobile-bounded** (DESIGN.md §2/§12) — art must not blow the turn budget or the
download.

- **Icons:** < 3 KB each after SVGO.
- **Region wash:** ≤ 120 KB WebP at delivery size; scene/ending plate ≤ 200 KB.
- **Artifact/portrait card:** ≤ 40 KB WebP.
- **Total in-run art** for the vertical slice stays within a documented budget; art loads lazily
  and never blocks a turn resolving (< 100ms target).
- Ship the smallest scale a device needs; don't send `@3x` to a `@1x` screen.

### 15.6 Git LFS

Binary art (WebP/PNG/PSD/AF) is tracked with **Git LFS** once the pipeline is set up
(assets/README.md). SVG and other text assets stay in normal git (diffable). Add LFS patterns
before the first large binary lands, not after.

### 15.7 Licensing & provenance

- **Every asset must have a clear right to ship.** Project is *all rights reserved pending
  licensing* (LICENSE) — no un-cleared third-party art, textures, brushes, or fonts.
- **Fonts:** Literata, Inter, JetBrains Mono are **SIL OFL** — free to embed and ship; keep the
  license files in `art/brand/` or a `THIRDPARTY` note. Don't substitute a non-OFL face without
  clearing it.
- **Provenance recorded:** each non-trivial asset lists source/author/tool in its sidecar or the
  commit. Stock or CC assets record the license and attribution requirement.
- **AI-generated art:** if used for concepting, it is *reference only* and does not ship as a
  final asset unless its license and provenance are cleared and recorded here. Final shipped art
  follows the duotone house style regardless of origin.

### 15.8 Accessibility metadata (per asset)

Not optional (§13). Every shipped image carries:

- **Alt text** authored with the asset (concise, meaningful — what it tells the player, not
  "image of…").
- For any asset that encodes state (region power-out variant, threat marks), a **text equivalent**
  the engine can emit to the plain-text client.

---

## 16. Definition of Done — the art review checklist

No asset ships until it passes. This is the visual analog of the content **five-question test**
(CONTRIBUTING.md).

**The five art questions**

1. **Does it serve the reading?** (Or does it compete with the prose? — §2)
2. **Is every color earning its meaning?** (No decorative hue — §4)
3. **Is it native to the palette and the duotone house style?** (§4, §7.5)
4. **Does it degrade to the plain-text floor?** (Works with no color/icon/art — §13)
5. **Is it accessible?** (Contrast, alt text, reduced-motion, color-not-alone — §13)

**The production checklist**

- [ ] Built from tokens; no hard-coded hex, spacing, radius, or off-scale size.
- [ ] Correct folder, kebab-case name matching its content id (§15.1–15.2).
- [ ] Correct format, sRGB, SVGO/optimized, within budget (§15.3–15.5).
- [ ] Source file saved; duotone recipe reproducible (§15.4).
- [ ] Alt text + any state text-equivalent written (§15.8).
- [ ] Right-to-ship / license / provenance recorded (§15.7).
- [ ] Reads correctly at 200% and in high-contrast; motion has a static equivalent (§13).
- [ ] Reviewed against the five art questions above.

---

## 17. Versioning & ownership

- This bible is **source-of-truth Markdown**, versioned in git alongside `colorway.md`. A `.docx`
  export can be generated for sharing (do not hand-edit the export — regenerate from this file,
  per CONTRIBUTING.md).
- **Any new visual value** (a color, a type size, a radius) is added to
  [`tokens.css`](tokens.css) in the same change that documents it here — the two never drift.
- Bump the version line at the top on any rule change; note substantive changes in
  [`CHANGELOG.md`](../CHANGELOG.md).
- Owner: Jharek. Open sub-decisions (a chosen illustrator's hand, final portrait technique) can
  become ADRs in [`design/decisions/`](decisions/) if they're hard to reverse.

---

*Ashfall is what the world cooled to. Ember is what's worth protecting. Every pixel in Zurvival
Reborn is one or the other.*
