# Zurvival Reborn — Localization Plan

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`GDD.md`](GDD.md) (what & why) · [`PRD.md`](PRD.md) (what to build & when) · [`../DESIGN.md`](../DESIGN.md) (how) · [`../design/colorway.md`](../design/colorway.md) · [`../design/tokens.css`](../design/tokens.css)

---

## 1. Purpose

This plan says *how Zurvival Reborn becomes multilingual without breaking the thing that makes
it good.* It expands PRD **NFR-LOC-01** ("all player-facing strings externalized from day one")
and **NFR-LOC-02** ("layout tolerates text expansion; RTL considered") into an architecture, a
pipeline, and a per-locale hazard map. It is written to be actionable **before** the engine
language is chosen (ADR-0001), because localization-readiness is an architectural stance, not a
library — and retrofitting it is the single most expensive localization mistake a text-first
game can make.

Audience: whoever builds the engine, authors content, writes a client, or manages translation.

## 2. Why localization is load-bearing here

Most games localize a *shell* around gameplay — menus, tooltips, a few thousand words of story.
Zurvival Reborn is the inverse. **The prose is the product** (GDD XVII: "the words are the
game"). A run is a survival novel the simulation writes at runtime, so almost everything the
player reads is content: scene text, choices, encounters, NPC dialogue, radio broadcasts,
environmental notes, the daily report, endings. Two consequences:

1. **Volume.** The launch Content Bible (GDD XV) — one city of regions, locations, ~60–100
   survivors, encounters, radio — is a large-word-count literary translation, not a UI string
   table. Word budget and translator quality dominate cost.
2. **The sentences are assembled, not stored.** The engine injects live state into prose:
   a named survivor, an artifact with provenance (*"Sarah's flashlight"*), a plural count of
   zombies, a wound, a symptom. Injection is where naive localization dies — because the moment
   you drop a noun into a sentence, every inflected language wants to change the words *around*
   it. This document treats that as the central problem (§7), not an edge case.

The upside: because content is already **data, not code** (PRD TEC-02, FR-CNT-01), and the
engine is **headless** with a tiny Scene/Choice/Action contract (DESIGN §10, NFR-PLAT-02), we
are unusually well-placed to do this right *if* we bake it in now.

## 3. Goals & constraints

These are load-bearing; most decisions below fall out of them.

1. **Externalize from day one.** No player-facing string is ever a literal in engine or client
   code. Every one has a stable key and lives in a locale resource. (NFR-LOC-01, FR-CNT-01)
2. **Never build a sentence by concatenation.** Grammar is not string addition. Word order,
   agreement, and punctuation are the translator's to control, per language. (§6, §7)
3. **English is the source of record.** `en` is authored first, frozen per milestone, and is the
   pivot every other locale translates from. Source quality gates everything downstream.
4. **The engine localizes; the client themes.** Narrative text is resolved to the player's
   locale at the Scene boundary so *every* client — web, native, chat-bot — gets correct text
   without re-implementing grammar. Clients own only their own chrome catalog. (NFR-PLAT-02)
5. **Layout is locale-elastic.** UI tolerates +35% expansion and full RTL mirroring by
   construction, using logical properties, not hand-tuned pixels. (NFR-LOC-02)
6. **Color, audio, and text stay redundant across locales too.** Every meaning already carries a
   label or icon (colorway rule); translation must preserve that pairing, never a bare glyph.

Non-goals for v1.0: full voice-over localization (we design to avoid VO entirely, §12);
machine-translation shipping without human LQA; per-dialect splits beyond those in §4.

## 4. Target locales & waves

Scope confirmed with the owner: plan for **all four language families** so the hardest technical
decisions (RTL mirroring, CJK breaking, Slavic/Arabic agreement) are designed in from the start,
even if lower-priority locales ship later. Waves are a *sequencing* tool, not a scope cut.

| Wave | Locales | Why this wave | Hardest thing it forces |
| --- | --- | --- | --- |
| **0 — Pilot** | one "torture-test" locale (recommend **de-DE** *or* **ru-RU**) | prove the whole pipeline against a hard case before content scales | expansion (de) or full case agreement (ru) |
| **1 — FIGS+** | fr-FR, it-IT, de-DE, es-ES, pt-BR | standard first commercial wave; Latin script, gendered, T–V formality | gender agreement, formality, +30% expansion (de) |
| **2 — CJK** | zh-Hans, ja-JP, ko-KR | large markets; different script & typography model | fonts, line-breaking, no-space text, ratings/approval |
| **3 — Slavic/Turkic** | ru-RU, pl-PL, tr-TR | the real stress test for procedural text | 3–4 plural forms, 6–7 cases, agglutination (tr) |
| **4 — RTL** | ar (MSA) | biggest layout lift | full UI mirroring, bidi, 6 plural forms, shaping |

The per-locale hazard matrix is Appendix A. **Pick the Wave-0 pilot now** and localize the
vertical slice into it (§15) — it is the cheapest way to find every architectural leak while the
surface area is still 5–8 locations, not a full city.

## 5. Architecture: where strings live

There are exactly **two string domains**, both using the same format (§6) and the same TMS (§13):

- **Narrative / content strings** — everything authored in `content/` (scenes, encounters,
  dialogue, radio, items, notes, endings). Owned by the engine's localization layer.
- **Client chrome strings** — buttons, menu labels, settings, error toasts, the accessibility
  UI. Owned by each client. Small, stable, low-churn.

### 5.1 The localization layer sits at the Scene boundary

The engine already emits a `Scene` for the client to render (DESIGN §10). We resolve locale
**inside** that step so the contract stays tiny and every client is correct by default:

```
GameState + action
   → turn pipeline (unchanged, English-agnostic — operates on keys/ids, never prose)
   → generateScene:  select content by id → resolve strings for state.locale
                     via the i18n resolver (catalog + ICU + termbase)
   → Scene { text: string[] (already localized), choices:[{label localized}], ... }
```

The turn pipeline never touches prose — it moves **ids and keys**. Determinism (PRD TEC-01) is
unaffected: locale is a render-time projection of state, not part of the seeded simulation, so
`(state, action, seed)` still reproduces byte-identical *state* regardless of language.

### 5.2 Content schema changes (extend, don't rewrite)

Content today mixes English prose into data files. Introduce a **string-key discipline** and
validate it in CI (FR-CNT-02):

```yaml
# content/encounters/pharmacy_cabinet.yaml  (illustrative)
id: enc.pharmacy_cabinet
text_key: enc.pharmacy_cabinet.body        # → resolved from locale catalog, not inline
choices:
  - id: pry_open
    label_key: enc.pharmacy_cabinet.choice.pry
    costs: { time: 5, noise: 8 }
requires: [ "node.searchPct < 1.0" ]
effects: [ { op: adjust, path: player.stress, by: +5 } ]
```

```jsonc
// locales/en/encounters.json  (source of record)
{
  "enc.pharmacy_cabinet.body": [
    "The shelves are bare, but the controlled-substances cabinet is still locked.",
    "Behind the glass: three amber bottles."
  ],
  "enc.pharmacy_cabinet.choice.pry": "Pry the cabinet open  ({noise} noise, {time} min)"
}
```

Rules: **one source string per key**; keys are stable and namespaced by content type; the source
locale is `en`; a content file references keys and never embeds a translatable literal. A
schema-validated build fails on any inline prose in a translatable field.

## 6. The message format: ICU MessageFormat

Adopt **ICU MessageFormat** as the string format for both domains. It is the industry standard,
has mature libraries in every plausible engine language (ADR-0001), and — critically — handles
the three things a procedural narrative can't live without: **plural**, **select** (gender /
arbitrary category), and locale-correct number/date skeletons. Store messages as ICU; interchange
via XLIFF for the TMS (§13).

The **one inviolable rule**: *sentences are templates with placeholders, never runtime string
concatenation.* `you_pick_up + " " + item.name + "."` is banned. The correct form gives the
translator the whole sentence and the variables:

```
pickup.item = You pocket {item}.
```

…and lets each language decide word order, article, case, and punctuation around `{item}`.
Everything in §7 is downstream of obeying this rule.

## 7. The hard problems of a procedural narrative

This is the part generic localization guides skip and the part this game lives or dies on.

### 7.1 Plurals — CLDR categories, never "if n==1"

Counts appear constantly: zombies in a pack, doses of antibiotics, days survived, rounds of
ammo, survivors at the gate. English has 2 plural forms; **Arabic has 6** (zero/one/two/few/
many/other), **Russian and Polish have 3–4**, **CJK have 1**. Hand-written `n==1 ? "" : "s"` is
wrong in most of our target languages. Always author with ICU `plural`:

```
horde.count = {n, plural,
  one {# zombie shambles out of the dark.}
  other {# zombies shamble out of the dark.}}
```

Translators receive the full set of categories their language needs; the engine picks the right
one via CLDR. Never assume the English category set survives translation.

### 7.2 Grammatical gender & case — the injected-noun problem

The engine injects nouns into sentences: survivor names, item names, place names. In gendered
and case-marked languages, the words *around* the noun must agree with it, and the noun itself
may change form. *"Sarah's flashlight, found in the hospital"* is trivial in English and a
minefield in German (genitive), Russian (6 cases × 3 genders), or Arabic (definiteness +
agreement). Three mechanisms handle it:

1. **A grammatical termbase.** Every injectable proper noun and item carries per-locale
   grammatical metadata — gender, declension class, and pre-inflected forms where a language
   needs them. The ~60–100 survivors (GDD XII) and the item catalog (GDD XV) get this as content
   fields, authored alongside the translation, not guessed at runtime.

   ```jsonc
   // locales/ru/terms.json  (illustrative — Russian needs case forms)
   "npc.sarah": { "gender": "f",
     "forms": { "nom": "Сара", "gen": "Сары", "dat": "Саре", "acc": "Сару",
                "ins": "Сарой", "pre": "Саре" } }
   ```

2. **`select` on gender for the surrounding words.** Where a sentence's adjectives/verbs agree
   with an injected actor, branch on that actor's gender token:

   ```
   npc.wounded = {gender, select,
     female {She's hurt — {name} won't make the next fight.}
     male   {He's hurt — {name} won't make the next fight.}
     other  {They're hurt — {name} won't make the next fight.}}
   ```

3. **Whole-sentence variants as the escape hatch.** When agreement ripples too far to patch with
   placeholders (common in Slavic and Arabic), the translator authors complete per-gender or
   per-case sentence variants keyed off the same state. Costlier, but always correct. The engine
   must expose the needed selectors (actor gender, grammatical number, case slot) to content.

The design intent — items and people as *specific, remembered* things, not interchangeable
tokens (GDD Principles 5 & 6) — is exactly what makes this non-optional: a generic "the item"
would dodge the problem, but that generic-ness is the thing we deliberately don't ship.

### 7.3 Player gender & the second-person narrator

The narrator is **second-person** ("you") and English hides gender there completely (GDD III).
Many target languages do not: French adjectives agreeing with "tu" inflect (*"tu es blessé"* vs
*"blessée"*), Russian past-tense verbs agree with the subject's gender, Arabic's "you" is itself
gendered (*anta* / *anti*). **A second-person narrator is not gender-safe once localized.**

Therefore: add a **player address setting** — masculine / feminine / neutral — surfaced at
first run and in settings, feeding a `pgender` selector available to all narrative content.
Neutral maps to each locale's best inclusive strategy (epicene forms, mid-dot *blessé·e*, or a
rephrase the style guide prescribes). This is a small player-facing choice with large linguistic
reach; it is cheap if designed now and near-impossible to retrofit into thousands of strings.

```
status.exhausted = {pgender, select,
  feminine {Tu es épuisée. Tes mains tremblent.}
  masculine {Tu es épuisé. Tes mains tremblent.}
  other {L'épuisement te gagne. Tes mains tremblent.}}
```

### 7.4 Formality & honorifics — and using them as a signal

Target languages carry a **T–V distinction** (French *tu/vous*, German *du/Sie*, Spanish
*tú/usted*, Russian *ты/вы*) and, in Japanese and Korean, layered honorific systems (keigo,
jondaenmal). Every locale's style guide must fix a **default register** (recommend: intimate,
close, *tu/du* — matching the narrator's close second person, GDD III).

Better, this game can make register *mean* something. Trust is per-relationship and evolves
(GDD XII). A survivor who moves from formal *vous* to intimate *tu* as trust crosses a threshold
is characterization the English build can't even express — free narrative depth in exactly the
languages that support it. Expose a relationship's formality tier to dialogue content as a
selector so translators *can* use it. Treat it as opt-in polish (Wave 1+), not a launch blocker.

### 7.5 Word order, articles, punctuation

Do not assume English order. German pushes verbs to the end; Japanese is SOV and particle-marked;
Arabic is RTL with different punctuation shapes (، ؛ ؟). Never hard-code a comma, a space
(CJK has none), a quotation mark («» „" 「」), or an English possessive `'s` into engine logic.
All of it belongs inside the localized template, per §6.

## 8. Scripts & typography

The current type system (`tokens.css`) uses **Literata** (serif — the story), **Inter** (sans —
UI/choices), **JetBrains Mono** (meta — costs/tags), all SIL OFL and embeddable. Literata and
Inter cover **Latin, Cyrillic and Greek** — so FIGS+ and Slavic wave are typographically fine.
Neither covers **CJK or Arabic.** That is a font-coverage gap, not a nuance:

| Script | Story (serif) | UI (sans) | Notes |
| --- | --- | --- | --- |
| Latin / Cyrillic / Greek | Literata | Inter | current stack; covers Waves 1 & 3 |
| CJK (zh/ja/ko) | **Noto Serif CJK** SC/JP/KR | **Noto Sans CJK** | per-language builds; Japanese ≠ Chinese glyphs |
| Arabic | **Noto Naskh Arabic** / IBM Plex Sans Arabic | **Noto Sans Arabic** | Naskh for body; pair weights to Inter |

All Noto faces are SIL OFL — same embed-everywhere licensing model the project already chose.
Add **per-script font-family tokens** to `tokens.css` (Appendix D) selected by `:lang()` /
document language, so the "three families, three jobs" system extends per script instead of
breaking.

Typographic gotchas the style guide must encode:

- **No CSS `text-transform: uppercase` as meaning.** The meta layer leans on caps (`NOISE +12`,
  `INFECTED · II`); caps are a Latin concept. In CJK, carry that emphasis with weight/color/tag
  chrome, not letter-casing; in Arabic there is no case at all.
- **Italics don't localize.** Literata's italic emphasis (a whispered line, a dream) has no CJK
  equivalent; use weight, color, or spacing instead for those scripts.
- **The "feverish" letter-spacing drift** (colorway "States & degradation") must be disabled for
  CJK and Arabic, where inter-glyph spacing breaks shaping and legibility. Symptom effect stays;
  its *typographic expression* becomes per-script.
- **Line length.** `--measure: 64ch` protects the reading trance in Latin; CJK reads comfortably
  denser and Arabic differently — treat `--measure` as per-script, not a constant.

## 9. Layout, expansion & RTL

**Text expansion budget** (design every string container to flex to these, per Ibelow/W3C
norms):

| From English | Typical growth | Worst offenders |
| --- | --- | --- |
| → German | +30–35% | compound nouns, choice labels |
| → Russian / Polish | +20–30% | case endings |
| → French / Spanish / pt-BR | +15–25% | — |
| → CJK | −40 to −10% (contracts) | but taller line-height |
| → Arabic | ~+25% + RTL | shaping + direction |

Choice labels (`--type-choice`, 17px) and the status row are the tightest real estate; design
them to wrap or grow, never to truncate. **Pseudolocalization** (§13) is how we catch overflow
before a translator ever sees the build.

**RTL (Arabic) is a first-class layout mode, not a flip filter.** Concretely, in this codebase:

- **Migrate `tokens.css` and components to CSS logical properties.** Today choices use
  `border-left: 3px solid var(--accent)` (colorway §"Using the tokens"). Under RTL the ember edge
  must sit on the *right*. Use `border-inline-start` so it follows text direction automatically —
  one change that fixes the whole choice list, nav, and sheet layout.
- Set `dir="rtl"` and `lang="ar"` at the document root; let logical properties do the mirroring.
- **Bidi handling** for mixed content: Latin item codes, numbers, and the mono meta tags embedded
  in Arabic prose need proper bidi isolation (`<bdi>` / Unicode isolates) so `NOISE +12` doesn't
  visually scramble next to RTL text.
- **Mirror directional icons** (arrows, "back", progress) and directional affordances; do **not**
  mirror inherently-LTR glyphs (clock hands are conventional, logos aren't mirrored).
- The **Quiet Screen** and Emotional-UI restraint (GDD XVII) must be verified in RTL — a single
  ember hairline and centered text should Just Work under logical properties, but it's on the
  visual-LQA checklist.

## 10. Numbers, dates, time & units

Route **all** numeric and temporal formatting through the platform's CLDR/ICU (`Intl` on web),
never string-built. This game is number-dense in a diegetic way — *Day 18*, *5 min*, *8 hr*,
noise values, doses, ammo counts — and each is a locale decision:

- **Digits.** Decide per-locale whether Arabic uses Western (0-9) or Eastern Arabic numerals
  (٠-٩); recommend Western for the mono meta layer (keeps `NOISE +12` legible and monospaced),
  Eastern optional in prose. Ensure the mono numeral set exists for the chosen script.
- **Clock.** In-world time respects locale 12h/24h conventions; "8 hr", "40 min" are ICU-plural +
  unit-formatted, not literals.
- **Grouping/decimals.** 1,000 vs 1.000 vs 1 000 — CLDR handles it; we must never hard-code a
  separator.
- **Dates** (save timestamps, "where you are" summaries, DESIGN §9) use locale date skeletons.

## 11. Culturalization, sensitivity & age ratings

Because Waves 2 (CJK) and 4 (Arabic) are in scope, culturalization is a real workstream, not a
footnote. Zurvival's core content — zombies, gore, infection, killing survivors for supplies,
children in peril, burying the dead, a memorial wall (GDD VI, X, XI, XII) — intersects several
markets' sensitivities:

- **Germany (USK).** Historically strict on gore; the modern USK routinely rates zombie survival
  titles, but excessive dismemberment can push age bands. Design a **gore-restraint** capability
  (the game is text, so this is word choice, not a blood decal) so a market variant is possible.
- **China.** Content approval historically disfavors undead/skeletons, graphic blood, and
  "society-destabilizing" themes; a compliant SKU may need reskinned framing or may be out of
  scope. Flag as a **business/legal decision**, not something translation alone solves.
- **MENA / Arabic markets.** Sensitivities around religion, profanity, alcohol, and sexual
  content; our understated romance (GDD XII) and any religious framing of death/burial need a
  culturalization pass. Keep the memorial/funeral content respectful and locale-reviewed.
- **Japan/Korea (CERO/GRAC).** Generally accommodating of the genre; standard ratings submission.

Practical stance:

1. **Author culturalization-aware.** Avoid untranslatable idioms and US-centric references in
   *engine-required* strings; keep idiom in NPC voice where a translator can transcreate it.
2. **Ratings early.** Use **IARC** for digital storefront self-rating; plan **ESRB / PEGI / USK /
   CERO / GRAC / ClassInd (BR)** for the markets that need them. Ratings depend on *depicted*
   content — a text game's "depiction" is its words, which is an advantage.
3. **Radio & real-world texture.** Broadcasts, signage, and notes (GDD XIII) carry
   culture-specific idiom; localize as **transcreation** (recreate the effect) not literal
   translation, guided by the voice brief (§14).

## 12. Audio & VO strategy

The cheapest localization decision available to us: **stay text-forward and ship no voice-over.**
Audio (GDD XVIII) is atmosphere and information — noise direction/distance, zombie signatures,
the Fear heartbeat, radio *timbre* — carried by **sound design, not spoken words.** Keep it that
way and there is nothing to dub, re-record, or lip-sync per locale.

Rules that keep this true:

- **No baked-in text in audio or images.** Any words a player must read are strings, not pixels
  or waveforms.
- **Any diegetic speech is subtitled**, with speaker labels and per-channel volume — which we owe
  the player anyway under **FR-AUD-06** ("non-audio equivalent for every meaningful sound cue")
  and the accessibility plan. Localization and accessibility share this requirement; build it
  once.
- If VO is ever added post-launch, it becomes a major new localization track (casting, direction,
  QA per locale) — treat as a separate future decision, explicitly out of v1.0 scope.

## 13. Tooling & pipeline

**Translation Management System.** Adopt one of **Crowdin**, **Lokalise**, or **Weblate**
(open-source, self-hostable — fits a project that values embeddable/OFL assets and open tooling).
It holds translation memory, glossary/termbase, screenshots-for-context, and the reviewer
workflow. Requirements: ICU MessageFormat support, XLIFF import/export, plural-category editors,
RTL preview, and an API/CLI for CI.

**Format & interchange.** Source strings live as ICU messages in the repo (`locales/<lang>/…`),
grouped to mirror content types. XLIFF is the interchange with the TMS. Final format follows
ADR-0002 (JSON vs YAML) — both carry ICU fine; decide once and keep keys identical across
locales.

**CI gates (all block the build, mirroring FR-CNT-02's "malformed content fails the build"):**

1. **No bare strings.** Static check: no translatable literal in engine/client code or in a
   content file's translatable field. Everything is a key.
2. **Key coverage.** Every key present in `en` exists (or is explicitly deferred) in each active
   locale; report % coverage per locale.
3. **ICU validity + placeholder parity.** Every message parses as ICU; every locale's variant
   uses the *same* placeholders and the *correct* plural categories for that language.
4. **Pseudolocalization.** A generated pseudo-locale (accented, +40% padded, bracketed,
   optionally RTL-wrapped) ships in dev builds. It catches hard-coded strings, truncation,
   concatenation, and RTL leaks **before** human translation — a first-class test, not a nicety.
5. **Glossary/termbase enforcement.** Coined terms and proper nouns (§14) are used consistently.

**Determinism note.** The i18n resolver is pure with respect to `(key, locale, params)` — same
inputs, same output — so it never threatens the deterministic core (PRD TEC-01) or golden-run
tests (DESIGN §11). Add a locale axis to golden tests: the *same* seed + actions in two locales
must produce structurally identical runs differing only in resolved text.

## 14. Translator enablement

Translators of a literary, systemic game need more than a string list. Ship them a kit:

- **Voice & tone brief.** The narrator is close, second-person, sparing, and never editorializes
  emotion (GDD III "The narrator"). Translators must *transcreate* that restraint, not translate
  literally. Include the Golden Scene Test and the Manifesto as touchstones.
- **Character bios.** Each of the ~60–100 survivors' background, personality, and register so
  their voice is consistent across scattered strings (GDD XII). A translator seeing one line out
  of context will get the voice wrong without this.
- **Glossary / termbase — translate vs. keep.** Decide, once, per term:

  | Term | Recommendation |
  | --- | --- |
  | Proper nouns / survivor names (Sarah, Marcus) | keep; transliterate only for non-Latin scripts, with grammatical forms (§7.2) |
  | Coined system terms — *the Last Can*, *Living History*, *the Survival Triangle*, *the Quiet Screen*, *Last Stand* | **transcreate** to keep the resonance; lock the chosen term per locale in the glossary |
  | Place/region names (Downtown, Hospital District) | translate for meaning |
  | UI/meta tags (`NOISE`, `INFECTED · II`, `ARTIFACT`) | translate, watch length/casing (§8) |

- **In-context screenshots & length hints.** Piped from the TMS; every choice label carries a max
  advisory length and its cost-tag context.
- **Query loop.** A channel for translators to flag ambiguous source — which also *improves the
  English*, because ambiguity that stumps a translator often stumps a player.

## 15. Process & phasing

Localization tracks the production roadmap (GDD XIX / PRD §6), front-loading the architecture and
back-loading the volume:

| Milestone | Localization work |
| --- | --- |
| **M1 — Vertical slice / Foundation** | Externalize 100% of slice strings (keys + ICU); stand up pseudoloc in CI; add player-address setting; migrate `tokens.css` to logical properties. **Localize the slice into the Wave-0 pilot locale** end-to-end. |
| **M2 — Reactive world** | Extend termbase/gender/case coverage as content grows; wire per-script font tokens; add RTL preview to the client. |
| **M3 — People & shelter** | Character bios + voice brief to translators; formality-as-signal groundwork (§7.4); daily-report & dialogue plurals audited. |
| **M4 — Content-complete city** | Full Content Bible frozen in `en`; Wave 1 (FIGS+) translation + LQA; culturalization pass; ratings/IARC submissions begin. |
| **M5 — Release candidate** | Waves 2–4 (CJK, Slavic/Turkic, Arabic) translation + full LQA; RTL & CJK visual QA; localized golden-run tests green. This is where PRD "localized" in the M5 definition-of-done is satisfied. |

**Why the pilot at M1 matters:** it converts localization from a late, panicky retrofit
(PRD risk: "Accessibility retrofit — bolted on late"; the same risk exists for loc) into a solved
architecture proven while the surface is tiny.

## 16. Definition of done & metrics

A locale is "done" for a release when:

- **Coverage** = 100% of active keys translated + reviewed (no fallback-to-English in shipped
  scope).
- **Pseudoloc** passes with zero truncation/concatenation/hard-coded-string defects.
- **Grammar suite** green: plural categories correct per language; gender/case selectors resolve;
  player-address variants correct; a fixed test set of injected-noun sentences reads correctly.
- **Visual LQA** signed off in-context, including RTL mirroring and CJK line-breaking.
- **Linguistic LQA** signed off by a native reviewer against the voice brief.
- **Localized golden-run**: same seed + actions produce a structurally identical run in this
  locale (text differs, systems don't).

Tracked metrics: per-locale coverage %, open LQA defects by severity, expansion-overflow count,
and — tying to PRD §4 — that the accessibility metric ("100% of critical info available without
color or audio") holds in every locale, since translation must preserve label/icon redundancy.

## 17. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **Retrofit** — loc bolted on after content scales | High | Externalize + pseudoloc + pilot locale from M1 (§15); keys from day one (NFR-LOC-01) |
| **Concatenation creep** — a dev builds a sentence with `+` | High | CI "no bare strings" + code review rule; template-only (§6); pseudoloc surfaces it |
| **Hidden-string leakage** — prose sneaks into engine/content fields | Med | Schema validation of translatable fields (§5.2); pseudoloc |
| **Injected-noun grammar wrong** in Slavic/Arabic | High | Grammatical termbase + selectors + whole-sentence escape hatch (§7.2); grammar test suite |
| **Font gaps** for CJK/Arabic | Med | Per-script Noto stacks in `tokens.css` now (§8, App. D) |
| **Market approval** (China undead/gore) | Med (biz) | Flag as legal/business decision early; gore-restraint capability; don't assume translation solves it |
| **Word-count/cost blowout** for a literary game | Med | Depth-before-breadth authoring (GDD XIX); TM reuse; freeze `en` per milestone |

## 18. Design rules for localization

1. Every player-facing string has a key; no literal ever lives in code or a content field.
2. Sentences are templates; grammar is never string addition.
3. Plurals and gender go through ICU (CLDR), never `if n==1` or `he/she` hacks.
4. The engine resolves locale at the Scene boundary; the simulation stays language-agnostic and
   deterministic.
5. Layout is elastic and direction-agnostic by construction (logical properties, +35%, RTL).
6. Color/audio/text redundancy survives translation — never localize a meaning down to a bare
   glyph.
7. Prove it in one hard locale early; scale volume late.

---

## Appendix A — Locale hazard matrix

| Locale | Script/dir | Plural forms | Gender | Case | Formality | Expansion | Special |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fr-FR | Latin LTR | 2 | 2 + agreement | — | tu/vous | +15–25% | elision (l'), mid-dot neutral |
| it-IT | Latin LTR | 2 | 2 + agreement | — | tu/Lei | +15–25% | — |
| de-DE | Latin LTR | 2 | 3 | 4 (light) | du/Sie | **+30–35%** | compounds, verb-final |
| es-ES | Latin LTR | 2 | 2 + agreement | — | tú/usted | +15–25% | ¿ ¡ |
| pt-BR | Latin LTR | 2 | 2 + agreement | — | você | +15–25% | — |
| ru-RU | Cyrillic LTR | **4** | 3 | **6** | ты/вы | +20–30% | verb past agrees w/ subject gender |
| pl-PL | Latin LTR | **4** | 3 | **7** | ty/Pan(i) | +20–30% | — |
| tr-TR | Latin LTR | 2 | none | agglutinative | sen/siz | +15% | vowel harmony, suffix chains |
| zh-Hans | Han LTR | 1 | — | — | — | −30 to −10% | no spaces, line-break strict, no caps/italics |
| ja-JP | JP LTR | 1 | — | — | keigo | −20% | SOV, particles, distinct glyphs from zh |
| ko-KR | Hangul LTR | 1 | — | — | jondaenmal | ~0% | spacing rules differ |
| ar | Arabic **RTL** | **6** | 2 | 3 | — | +25% | bidi, shaping, gendered "you" |

## Appendix B — Worked ICU examples

```
# Plural (Arabic will expand these 2 English categories to its 6)
horde.count = {n, plural, one {# zombie shambles closer.} other {# zombies shamble closer.}}

# Player-address (second person) agreement — French
status.exhausted = {pgender, select,
  feminine {Tu es épuisée.} masculine {Tu es épuisé.} other {L'épuisement te gagne.}}

# Injected actor gender + name
npc.down = {gender, select,
  female {{name} is down and won't get up on her own.}
  male   {{name} is down and won't get up on his own.}
  other  {{name} is down and won't get up on their own.}}

# Cost tag with locale number/unit formatting (never string-built)
choice.pry = Pry it open ({noise, number} noise · {mins, plural, one {# min} other {# min}})

# Nested: doses remaining feeding a moral beat (the Last Can)
supply.doses = {n, plural,
  one {One dose left. {who} needs it — and so does the shelter.}
  other {# doses left. Not enough for everyone.}}
```

## Appendix C — `tokens.css` i18n additions (sketch)

```css
/* Per-script family tokens — selected by document/element language.
   Extends the existing "three families, three jobs" system (art-bible §3). */
:root {
  --font-serif-latin: 'Literata', Georgia, serif;
  --font-sans-latin:  'Inter', system-ui, sans-serif;
}
:lang(zh) { --font-serif: 'Noto Serif CJK SC', var(--font-serif-latin);
            --font-sans:  'Noto Sans CJK SC',  var(--font-sans-latin); }
:lang(ja) { --font-serif: 'Noto Serif CJK JP', var(--font-serif-latin);
            --font-sans:  'Noto Sans CJK JP',  var(--font-sans-latin); }
:lang(ko) { --font-serif: 'Noto Serif CJK KR', var(--font-serif-latin);
            --font-sans:  'Noto Sans CJK KR',  var(--font-sans-latin); }
:lang(ar) { --font-serif: 'Noto Naskh Arabic', var(--font-serif-latin);
            --font-sans:  'Noto Sans Arabic',  var(--font-sans-latin);
            --measure: 60ch; }

/* Direction-agnostic choice edge — replaces `border-left` so RTL mirrors for free */
.choice { border-inline-start: 3px solid var(--accent); }

/* Disable feverish letter-spacing drift where it breaks shaping */
:lang(ar), :lang(zh), :lang(ja), :lang(ko) { --fever-tracking: 0; }
```

---

*End of Localization Plan. This document tracks the GDD, PRD, and DESIGN; when the Scene
contract, content schema, or `tokens.css` change, revisit §5, §8, and §9.*
