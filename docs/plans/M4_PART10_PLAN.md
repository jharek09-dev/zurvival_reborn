# M4 Part 10 — Depth screens (T54 · "information on demand")

The primary screen (T19) holds the **one decision**; M4 has spent nine parts making the world behind
that decision deep — a full city, companions, a shelter that runs itself, an economy, factions. T54
gives the player a way to *look at* that depth without ever cluttering the story: five purpose-built,
on-demand **depth screens** — inventory, companions, shelter, map/journal, codex — summoned by a key,
dismissed back to the scene, and read-only (GDD XVII "Information on demand"; wireframes SCR-03..07).

## What FR-UI-04 asks for

> **FR-UI-04 (Must, MVP)** — Depth screens on demand: inventory, companions, shelter, map/journal, codex.

Plus the accessibility baseline these inherit from the first UI (T20):

- **NFR-ACC-01** — every critical fact in words; no colour/glyph-only meaning; zero ANSI; a plain-text
  transcript is enough to play.
- **NFR-ACC-02** — a stable, navigable region order; keyboard-only, nothing pointer- or timing-gated.

And the M4 component-library states the requirement names (design/wireframes.html §03): **default /
pressed / focus halo / trust-locked** — "locked rows state their gate in words, never a mystery grey."

## The architecture: 100% harness-client, zero engine change

FR-UI-04 is a **presentation** requirement, and every fact a depth screen shows already exists in the
engine's public read API (inventory/economy/companions/social/jobs/shelter/map/radio selectors) over the
single `GameState`. So T54 lives **entirely in the harness client** — one new module `screens.ts` plus
small seams in `play.ts` / `playCli.ts` / `playSlice.ts` — and **touches no engine file, no schema, no
content, no save rung, no RNG.** The engine bytes are literally unchanged, which is the strongest
possible byte-identity story: not "gated so prior runs stay dark," but *the determinism surface was
never edited at all*. A depth screen is a pure `(state, graph) => string[]`; opening one resolves no
turn, spends no time, and mutates no state.

This is the cleanest shape the [[zurvival-byte-identity-loot-hazard]] discipline can take: no
`floor(f·len)` pick set is touched, no new item is added, no lazy stream is drawn — because nothing in
the engine is touched.

## The five screens (SCR-03..07)

Each is a labelled, words-only view; the *actions* (equip/use/drop, give an order, assign a job, travel,
add a note) stay on the primary Scene where the engine offers them — the screens **inform** the one
decision, they don't replace it (FR-UI-01 preserved).

- **Inventory** (`I`) — pack weight vs. capacity in words (room to spare / getting heavy / full — leave
  something behind), items grouped by category (medical / food & water / weapons / materials / other),
  **artifacts** in their own section with provenance from the instance metadata ("the fire station ·
  repaired 2 times · well-kept"), the economy's freshness + learned recipes when live, and the "no level
  here — a better tool and a full pack are the only progress" note.
- **Companions** (`C`) — "N with you · M at home · K/PARTY_CAP", then per companion: condition (needs in
  words, the worst wound named, infection as a **symptom never a number**), mood + **trust as a tier
  word** (not the raw 0–100), and their standing orders with the active one marked `(current)` and the
  ranged/holding orders **trust-locked with the gate in words** when trust is short. A held-back
  authored lead surfaces as a teaser ("ask them, and it becomes a place on your map").
- **Shelter** (`B` — "base") — walls as a word (sturdy/holding/thin/breached, never a bar), morale band,
  stores; built rooms vs. buildable "could build" rooms; who's home and their assigned job; the latest
  daily report (`shelterLine`/`jobLine`) — how your absence is being spent.
- **Map & Journal** (`M`) — the fog percentage ("N of T places known — fog over X%"), where you are and
  home, every known node grouped by region with its **memory** (searched-state, walkers, discoveries),
  the player's own **handwritten notes** pinned to nodes, the fog edge (`?` unknown ways out), and the
  auto-annotated **recent Living History**.
- **Codex** (`L` — "lore") — discovered lore; the **radio** (gated on actually carrying a radio — the
  airwaves are silent without one), each signal's label/type and a readable status-plus-reception
  phrase; rumors (leads confided, mysteries open); the **memorial** — the dead and the departed listed by
  name and by *how*, drawn from the append-only history; and the run's moral shape felt, not counted.

## The component-library states, in text

- **pressed / active** — the title bar names the screen you are in (`— Companions — …`).
- **focus** — a `>` marker on the row that is the natural next action, always paired with words.
- **trust-locked / locked** — the gate is **stated in words** (`[locked — needs their trust]`), never a
  colour or a mystery grey (wireframe §03 rule).
- **default** — a plain `-` row.

## The seam

`screens.ts` exports a small registry (`DEPTH_SCREENS`, one mnemonic key each — `I C B M L`, none
colliding with the reserved `S`/`Q` or the digit choices), `screenForKey` / `renderDepthScreen`, and the
five pure renderers. `play.ts` gains a `{kind:"screen"}` `Command` variant; `parseCommand` routes a
screen key (case-insensitive) to it; the **footer** is rebuilt from the registry so it always advertises
every screen key (discoverability = accessibility, "nothing missable"). `playByInputs` treats a screen
key as a **free overlay** — records it in a new `screensViewed` list and resolves no turn — which is the
in-suite proof that the keyboard reaches the screens without spending time or changing state. The
interactive `playCli.ts` / slice `playSlice.ts` loops render the screen then redraw the scene, no
`applyAction`.

## Determinism & byte-identity (trivial by construction)

No engine file is edited, so every engine suite, the golden slice, and the cross-tree `saveGame` proof
are byte-identical by construction — there is no gated system to leave dark because there is no new
system in the engine at all. Verified anyway (the discipline): a proof that the engine tree is untouched
(zero diff under `prototype/engine`), and the standard cross-tree scripted-run save comparison (many
seeds) returning empty, raw, no normalization.

## Test plan

- `harness/test/screens.test.ts` — registry + non-reserved distinct keys; `parseCommand` routes every
  screen key (and leaves choice/save/quit/invalid intact); each screen's stable frame (title first, back
  hint last) + zero ANSI over a rich state; **no number leaks** (infection symptom not `63`, trust tier
  not `55`); **free overlay** (rendering never mutates state; a screen key mid-play adds no turn and
  yields a byte-identical transcript; `screensViewed` records the keyboard path); and each screen's
  purpose-built facts (pack load/categories/artifact provenance; companion condition/trust-lock/current
  order; shelter walls/rooms/stores; map fog%/notes/here; codex radio-gate/memorial).
- `harness/test/accessibility.test.ts` — extends the T20 baseline: the footer advertises every screen
  key, and all five keys open a screen while resolving no turn.
- Full CI green in a clean sandbox: engine typecheck+test, content-loader, harness typecheck+test,
  `npm start` smoke, schema gate (160 entries / 13 types) + malformed-reject — all unchanged from M4P9
  since nothing outside the harness moved.

## Definition of done

Code + tests + this plan + `docs/qa/QA_REVIEW_M4_PART10.md` + `CHANGELOG.md`; `docs/status.json` T54 →
done with the completion note + refreshed banner + audit parking-lot items (under the concurrency
guard); Zurvival Mission Control snapshot refreshed; a verified `git format-patch` delivered; changed
files synced to the E: mount. Two-subagent adversarial audit (engineering: byte-identity / no engine
drift / non-mutation / no-crash over odd states; design: FR-UI-04 fidelity / no-number-leak /
reachable+surfaced / voice) with all findings fixed.

## Parking lot / deferrals

- **FR-UI-06 — Emotional UI & the "Quiet Screen"** (SCR-08; Should/MVP) is its own item: the loss-moment
  UI strip-back and state-degraded rendering, distinct from the depth screens. Deferred (PL-M4-45).
- **In-screen sub-navigation / actions from within a screen** (e.g. equipping straight off the inventory
  screen). T54 keeps actions on the primary Scene (FR-UI-01) and points to them; a shipping GUI client
  may fold them in. First pass surfaces, it doesn't rewire the decision loop (PL-M4-46).
- **Lore/rumor content** — the codex renders whatever `story.lore`/mysteries exist; authoring a real lore
  set is a later content block (PL-M4-47).
- **Companion leads post-recruit** — the engine's `ask` verb is NPC-only, so a recruited survivor's
  authored knowledge isn't reachable; T54 removed the misleading teaser rather than promise it (PL-M4-48).
- All screen **wording/ordering** is first-pass, tunable with the M5 comprehension playtests.
