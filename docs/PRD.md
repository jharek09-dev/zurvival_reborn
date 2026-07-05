# Zurvival Reborn — Product Requirements Document

**Version:** 1.0 · **Status:** Pre-production (draft for review) · **Owner:** Jharek
**Companion document:** [`GDD.md`](GDD.md) — the creative and systemic vision this PRD builds on.

---

## 1. Purpose of this document

The GDD says *what the game is and why*. This PRD says *what we build, in what order, and how
we'll know it works*. It translates the GDD's vision into scoped, prioritized, testable
requirements, defines the first shippable slice, and records the decisions and risks that
front-load a project.

Every requirement here traces back to a GDD part (see the traceability matrix, §14) and is
tagged with a MoSCoW priority. This document is expected to change; it is a plan, not a
contract.

### Priority key (MoSCoW)

- **Must** — required for the target release it's listed under; the release is not done
  without it.
- **Should** — high value, included if at all possible; can slip a release without killing it.
- **Could** — desirable, done if time allows.
- **Won't (now)** — explicitly out of scope for the current horizon; recorded so it isn't
  relitigated.

Requirement IDs are stable (`FR-<area>-##` functional, `NFR-<area>-##` non-functional) so they
can be referenced by tickets and tests.

---

## 2. Problem & opportunity

The original *Zurvival* Kik bot had a devoted following because of its people and its
moment-to-moment tension, but it was a scripted, scene-to-scene chatbot with shallow systems
and no persistence. Modern chat-driven and systemic survival games (*A Dark Room*, *Reigns*,
*This War of Mine*, *NEO Scavenger*) prove there's an audience for text-forward games with
real depth — but few combine that audience's appetite for **emergent, systemic survival** with
the **intimate, character-driven chat heritage** the original had.

**The opportunity:** a chat-driven survival roguelite where a genuine world simulation, not a
writer's branch, decides what happens next — so every run produces a unique, retellable story.
The bet is that *systemic depth + handcrafted characters + a messaging interface* is an
underserved, defensible space.

---

## 3. Product goals & non-goals

### Goals

1. **Emergent stories, not scripted branches.** The primary output of a run is a story the
   player wants to retell. (GDD I, II, III)
2. **A world that reacts and remembers.** Player actions leave permanent marks on nodes,
   regions, people, and history. (GDD IV, VII, XIII)
3. **Constant, honest pressure.** The player is always a little short; every choice trades
   Safety, Resources, or Time. (GDD II, XVI)
4. **Characters players care about.** Handcrafted survivors that feel like people and can be
   lost. (GDD XII)
5. **Progress through preparation, not levels.** Growth is gear, shelter, allies, and
   knowledge. (GDD V)
6. **Reach on any screen.** Mobile-first web, extensible to native and a chat-bot client.
   (GDD I, XIV, XVII)

### Non-goals

- Not a real-time or twitch-action game; not a zombie shooter. (GDD I)
- Not a linear, pre-authored branching novel or visual novel. (GDD I)
- No character XP/levels or power-fantasy progression. (GDD V)
- No always-online requirement, no PvP, no live-service treadmill at launch.
- No monetization design in this version of the PRD (deferred; see Open Questions).

---

## 4. Success metrics

Metrics are split between the subjective core (the real goal) and measurable proxies.

### The core metric

- **The "one more day" test (GDD XVI):** at session end, does the player want to continue?
  Measured qualitatively in playtests and via a proxy: session-end-to-next-session return rate.

### Quantitative targets (directional, for beta → launch)

| Metric | Target intent |
| --- | --- |
| Story recall | ≥ 60% of playtesters can recount a specific, unscripted moment unprompted after a run. |
| Run completion | A meaningful share of started runs reach an ending (win *or* authored failure), not rage-quit. |
| Session length | Median session in the 10–30 min design window (GDD I). |
| Return rate | Strong day-1/day-7 return among players who finish a first session. |
| Encounter variety | < 5% verbatim encounter repetition within a single full run. |
| Decision weight | Low rate of "no-consequence" turns in telemetry (every turn changes ≥ 1 system — GDD III). |
| Accessibility | 100% of critical information available without color or audio (GDD XVII). |
| Stability | Crash-free sessions ≥ 99.5%; zero save-corruption defects at launch. |

Exact numeric thresholds are set during closed testing once a telemetry baseline exists.

---

## 5. Target users & personas

- **The Story Collector** — plays for emergent narrative and characters (*This War of Mine*,
  Telltale). Wants people to care about and moments to retell. Cares most about GDD XII, XIII.
- **The Systems Survivalist** — plays for depth and mastery (*NEO Scavenger*, *Project
  Zomboid*). Wants scarcity, meaningful trade-offs, and a world that doesn't cheat. Cares most
  about GDD IV, X, XVI.
- **The Commuter** — plays in short bursts on a phone (*A Dark Room*, *Reigns*). Needs
  stop-anywhere sessions, instant load, and one-hand play. Cares most about GDD XVII, NFRs.
- **The Nostalgic** — knew the original bot; wants its heart (people, tension, chat feel) done
  justice at modern depth. Cares most about GDD I, XII.
- **Accessibility-dependent players** — rely on screen readers, scalable text, or reduced
  motion. A mostly-text game should serve them exceptionally well. Cares most about NFR-ACC.

---

## 6. Scope & release strategy

Development follows the GDD's "depth before breadth" rule (GDD XIX): prove the loop is
compelling at small scope, then expand content. Three horizons:

### 6.1 Vertical Slice (first playable — internal)

The proof that the core is fun. One region, ~5–8 remembering locations, the real turn loop
(move / search / fight-or-avoid / rest) with time, noise, wounds, and finite loot; 3–5
handcrafted survivors with one recruitable companion; one claimable shelter node with a daily
report. **Exit criteria:** a single slice run produces an emergent, retellable story and passes
an informal "one more day" test with playtesters.

### 6.2 MVP / Early-Access (public beta)

The full system set at moderate content depth: all six simulation layers active, the director,
the Storyteller, shelter with rooms and night attacks, infection as staged identity, the radio
network, and a content-complete first city. Difficulty modes and accessibility baseline in.

### 6.3 v1.0 (launch)

Balanced, localized, accessible, hardened. Multiple endings, the full launch Content Bible,
save migration, and the polish pass. Chat-bot and native clients are **post-launch** unless
promoted.

### Out of scope for v1.0 (Won't-now)

Multiplayer/PvP, user-generated-content marketplace, additional cities beyond the launch city,
full faction territory wars, animal ecosystems, and vehicle modification depth — all recorded
as future expansion (GDD IV hooks) rather than cut ideas.

---

## 7. Functional requirements

Grouped by area. Each row: ID · requirement · priority (MoSCoW) · earliest release
(VS = vertical slice, MVP = beta, v1 = launch). "Key acceptance criteria" follow each area.

### 7.1 Core loop & turn engine (GDD III, IV, XIV)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-CORE-01 | Turn loop: present scene → player picks one action → resolve → apply consequences → advance time → generate next scene, with no direct `choice→scene` edge. | Must | VS |
| FR-CORE-02 | Fixed simulation pipeline order (per GDD IV) executed every turn. | Must | VS |
| FR-CORE-03 | Every action has a time cost; time always advances. | Must | VS |
| FR-CORE-04 | Every resolved action changes ≥ 1 system (no no-op turns). | Must | VS |
| FR-CORE-05 | Scenes answer the Four Questions (where / what's happening / what can I do / what changed). | Must | VS |
| FR-CORE-06 | Micro-choices can appear inline at low/zero cost. | Should | MVP |
| FR-CORE-07 | Safe-to-stop after any resolved turn (autosave boundary). | Must | VS |

**Key acceptance criteria:** given identical state + seed, a turn is reproducible (ties to
NFR-TEC-01); a telemetry audit of 100 turns shows every turn mutated at least one tracked
system; QA can quit and resume at any turn boundary with no state loss.

### 7.2 World simulation (GDD IV)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-SIM-01 | Six state layers modeled and independently updatable (player, companion, local, region, global, story). | Must | MVP |
| FR-SIM-02 | Local-area memory: node state (loot %, damage, corpses, occupants, discoveries) persists all run. | Must | VS |
| FR-SIM-03 | Regional threat/density/loot evolve independently of player presence. | Must | MVP |
| FR-SIM-04 | Time-of-day phases modify encounter odds, visibility, and danger. | Must | VS |
| FR-SIM-05 | Weather types with multi-system gameplay effects. | Should | MVP |
| FR-SIM-06 | Noise model: actions emit noise that attracts/repels actors and decays over time. | Must | VS |
| FR-SIM-07 | Zombie population + migrating hordes that evaluate noise to redirect. | Must | MVP |
| FR-SIM-08 | Global infrastructure decay (power, water, roads, bridges) that unlocks/removes content. | Should | MVP |
| FR-SIM-09 | Other survivor groups simulated off-screen (move, trade, fight, collapse). | Should | MVP |
| FR-SIM-10 | Apocalypse Director biases pacing/probabilities without breaking world logic. | Must | MVP |
| FR-SIM-11 | Living History: append-only log of significant world events, queryable for callbacks. | Should | MVP |

**Key acceptance criteria:** a region's threat measurably changes across days with the player
absent; a logged gunshot causes a nearby horde to re-path in ≥ X% of eligible cases; disabling
the director changes pacing metrics but never produces impossible states.

### 7.3 Exploration, map & travel (GDD VII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-MAP-01 | Node graph of locations grouped into regions, connected by routes. | Must | VS |
| FR-MAP-02 | Fog of war: only visited/known nodes revealed. | Must | VS |
| FR-MAP-03 | Node-to-node travel costs time, stamina, noise; can trigger travel events. | Must | VS |
| FR-MAP-04 | Route conditions (clear/blocked/flooded/on-fire/collapsed) change with world state. | Should | MVP |
| FR-MAP-05 | Map-as-journal: player pins handwritten notes to nodes; game auto-annotates history. | Should | MVP |
| FR-MAP-06 | Claimable safehouse nodes; a claimed node can be lost. | Must | VS |
| FR-MAP-07 | Vehicles change travel economy (speed, capacity, noise, fuel). | Could | v1 |
| FR-MAP-08 | Fast travel only between known safe nodes; still costs time and is interruptible. | Could | v1 |

**Key acceptance criteria:** damage done to a node on day N is still present on a later visit;
player notes persist and render on the map screen; claiming a node marks it and enables the
shelter loop.

### 7.4 Player systems (GDD V)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-PLR-01 | Persistent player state (condition, inventory, equipment, skills, traits, reputation). | Must | VS |
| FR-PLR-02 | Visible core stats limited to a critical few; no bar overload. | Must | VS |
| FR-PLR-03 | Weight/slot-limited inventory forcing leave-behind decisions. | Must | VS |
| FR-PLR-04 | Equipment defines capability; growth comes from gear, not levels. | Must | VS |
| FR-PLR-05 | Artifact metadata (provenance/history) attached to significant items. | Should | MVP |
| FR-PLR-06 | Durability: gear wears, jams, breaks, and can be repaired. | Should | MVP |
| FR-PLR-07 | Skills improve narrowly through use; never create a combat god. | Should | MVP |
| FR-PLR-08 | Unlockable starting backgrounds as optional starting advantages (not classes). | Could | v1 |
| FR-PLR-09 | Legacy progression between runs that broadens starts, never survival power. | Could | v1 |
| FR-PLR-10 | No XP bar or character level exists anywhere. | Must | VS |

**Key acceptance criteria:** the UI never shows an XP/level element; a named artifact displays
its history; over-capacity pickups force an explicit drop/replace choice.

### 7.5 Injuries, infection, health & mind (GDD VI)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-INJ-01 | Damage produces named wounds with specific gameplay effects (sprain, deep cut, fracture, burn, concussion, illness). | Must | VS |
| FR-INJ-02 | Wound severity tiers scale effect and treatment. | Should | MVP |
| FR-INJ-03 | Bleeding ticks over time; a deep cut leaves a zombie-attracting scent trail. | Should | MVP |
| FR-INJ-04 | Health is treated, not auto-regenerated. | Must | VS |
| FR-INJ-05 | Infection as staged identity (asymptomatic → symptomatic → advanced → terminal); no infection bar. | Must | MVP |
| FR-INJ-06 | Infection alters perception, available dialogue, and visible symptoms by stage. | Should | MVP |
| FR-INJ-07 | Diagnosis, treatment, and quarantine paths; late stages costlier and less certain. | Should | MVP |
| FR-INJ-08 | No instant "Game Over" on infection; it becomes a harder way to keep playing. | Must | MVP |
| FR-INJ-09 | Mind model: stress, fear, hope/morale surfaced via behavior/dialogue/dreams, not bars. | Should | MVP |
| FR-INJ-10 | Hidden Humanity value influences endings, companion loyalty, and world memory. | Could | v1 |
| FR-INJ-11 | Scars persist and are referenced by NPCs. | Could | v1 |

**Key acceptance criteria:** no numeric infection value is ever shown; an untreated deep cut
demonstrably increases nearby-zombie attraction along the traveled path; reaching a severe
infection stage opens new play (cure race) rather than ending the run.

### 7.6 Encounters & events (GDD VIII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-ENC-01 | Tagged encounter pool filtered by state conditions (requirements engine). | Must | VS |
| FR-ENC-02 | Weighting + cooldowns favor fitting, non-repeated content. | Must | VS |
| FR-ENC-03 | Encounter chains (flags set now enable follow-ups later). | Should | MVP |
| FR-ENC-04 | Multi-stage encounters (negotiation → fight → chase). | Should | MVP |
| FR-ENC-05 | Category coverage: exploration, combat, social, environmental, story, psychological, shelter. | Must | MVP |
| FR-ENC-06 | Moral encounters with no clean answer, feeding Humanity. | Should | MVP |
| FR-ENC-07 | False encounters (tension without payoff) supported. | Could | MVP |
| FR-ENC-08 | Encounter evolution: same node yields before/during/after variants by its state. | Should | MVP |
| FR-ENC-09 | Rare + legendary encounters gated behind world conditions. | Could | v1 |
| FR-ENC-10 | Director can inject a needed pacing beat. | Should | MVP |

**Key acceptance criteria:** every shipped encounter passes the five-question test (§tie to
FR-CNT-02); repeat-suppression keeps verbatim repeats under the §4 target within a run.

### 7.7 Combat, stealth & zombie AI (GDD IX)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-CBT-01 | Combat is avoidable and always spends scarce resources (stamina/durability/ammo/noise/health). | Must | VS |
| FR-CBT-02 | Turn-based exchange resolution (attack/heavy/aim/push/retreat/hide) vs. systems, not twitch. | Must | VS |
| FR-CBT-03 | Improvised/environmental actions (lure, trap, fire, chokepoint) available. | Should | MVP |
| FR-CBT-04 | Weapon categories with trade-offs; firearms are loud (region-wide noise cost). | Must | VS |
| FR-CBT-05 | Stealth via sound/light/line-of-sight detection, modulated by weather/dark. | Must | VS |
| FR-CBT-06 | Zombie state machine (dormant/wander/investigate/chase/feed/hibernate) driven by senses. | Must | MVP |
| FR-CBT-07 | Distinct zombie types incl. Screamer (calls others) and Stalker (night hunter). | Should | MVP |
| FR-CBT-08 | Hordes routed/funneled/fled rather than out-traded. | Should | MVP |
| FR-CBT-09 | Fear Meter + panic degrade options/text at extremes; companion fear affects allies. | Should | MVP |
| FR-CBT-10 | Last Stand: terminal combat resolves as a heightened final-choice sequence, not a death card. | Should | MVP |

**Key acceptance criteria:** a stealth path exists through the vertical-slice combat scenarios;
firing a gun raises regional threat/noise measurably; a Last Stand presents at least one
meaningful final choice.

### 7.8 Inventory, crafting, loot & economy (GDD X)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-ECO-01 | Finite, contested loot; taking removes from world; rivals can beat player to it. | Must | VS |
| FR-ECO-02 | Plausibility-based loot distribution by location type, in tiers. | Must | VS |
| FR-ECO-03 | Search costs time/stamina/noise, returns partial results, persists search %. | Must | VS |
| FR-ECO-04 | Four resource loops (body/safety/health/power) each with drains and sinks. | Should | MVP |
| FR-ECO-05 | Food spoilage (faster after power loss) and water purification. | Should | MVP |
| FR-ECO-06 | Crafting (medical/weapon/shelter/survival) gated by blueprints, components, rooms. | Should | MVP |
| FR-ECO-07 | Repairs keep artifacts alive. | Should | MVP |
| FR-ECO-08 | Trading with other groups at scarcity/reputation-driven prices. | Could | v1 |
| FR-ECO-09 | Hidden loot rewarding curiosity + NPC hints. | Should | MVP |
| FR-ECO-10 | Balance preserves "the last can" moral-scarcity moment as an emergent outcome. | Should | v1 |

**Key acceptance criteria:** a second visit to a searched node reflects prior depletion; at
least one NPC hint resolves to real hidden loot in the slice; economy tuning produces a
"last can" decision in a majority of balanced test runs.

### 7.9 Shelter & community (GDD XI)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-SHL-01 | One evolving home shelter with integrity, population, morale, storage, rooms. | Must | VS |
| FR-SHL-02 | Daily report summarizing off-screen community activity. | Must | VS |
| FR-SHL-03 | Assignable jobs that run while the player is away (produce/consume). | Should | MVP |
| FR-SHL-04 | Craftable rooms (kitchen, medical, workshop, radio, watchtower, garden) unlock capability. | Should | MVP |
| FR-SHL-05 | Generator on scarce fuel powers dependent rooms. | Could | MVP |
| FR-SHL-06 | Night attacks (zombie/hostile) resolved as defensive scenes with real losses. | Must | MVP |
| FR-SHL-07 | Hope-vs-survival tension: cold-optimal choices bleed morale. | Should | MVP |
| FR-SHL-08 | Memorial wall records the dead; affects morale. | Could | v1 |
| FR-SHL-09 | Emergent community identity read by NPCs/factions/endings. | Could | v1 |
| FR-SHL-10 | Shelter can be lost (overrun/burned/abandoned). | Must | MVP |

**Key acceptance criteria:** the daily report reflects actual simulated job output; a night
attack outcome is legibly driven by prior preparation; losing the shelter is a survivable but
heavy state, not an auto game-over.

### 7.10 Survivors, companions & factions (GDD XII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-NPC-01 | Handcrafted, named survivor pool (target ~60–100 by v1) with background, personality, secret. | Must | VS (subset) |
| FR-NPC-02 | Per-character memory driving per-relationship trust/respect/fear (not a global bar). | Must | MVP |
| FR-NPC-03 | Recruitable companions with autonomous AI and followable orders gated by trust. | Must | VS |
| FR-NPC-04 | Permanent companion death, remembered by the community. | Must | VS |
| FR-NPC-05 | Desertion and betrayal from low trust/mistreatment. | Should | MVP |
| FR-NPC-06 | Dynamic conversations where memories/knowledge act as real loot/location hints. | Must | MVP |
| FR-NPC-07 | Inter-NPC relationships (friendship/rivalry) affecting shelter morale. | Should | MVP |
| FR-NPC-08 | Personal quests emerging from relationships; optional romance. | Could | v1 |
| FR-NPC-09 | Storyteller surfaces relationship/secret/history threads as narrative moments. | Should | MVP |
| FR-NPC-10 | Survivor groups/factions with identity, diplomacy, reputation, dynamic leadership. | Could | v1 |

**Key acceptance criteria:** the same named survivor is recognizable across runs; ≥ 1 NPC
conversation hint resolves to actionable loot/location; a companion's death is referenced later
by others.

### 7.11 Story, radio & endings (GDD XIII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-STY-01 | Three story layers (your story / city's story / the truth), player-story primary. | Should | MVP |
| FR-STY-02 | Story events fire on world conditions, not a chapter clock. | Must | MVP |
| FR-STY-03 | Radio network: emergency/military/civilian/ham/unknown signals that evolve with state. | Should | MVP |
| FR-STY-04 | Player broadcasting (call for help / warn / lure / lie) with consequences. | Could | v1 |
| FR-STY-05 | Rumor system turning radio/NPCs/notes into variably-reliable leads. | Could | v1 |
| FR-STY-06 | Multiple endings assembled from run components; no single "true ending". | Must | v1 |
| FR-STY-07 | Authored failure endings (Last Stand / overrun / infection) with real closure. | Must | MVP |
| FR-STY-08 | Epilogues following surviving NPCs. | Should | v1 |
| FR-STY-09 | Living History surfaces in later runs as ruins/rumor/legend. | Could | v1 |

**Key acceptance criteria:** two "survival" endings differ based on tracked components; a
failure never shows a bare "You Died" with no scene.

### 7.12 UI / UX (GDD XVII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-UI-01 | Story-first single-decision primary screen (header/status/story/choices/footer). | Must | VS |
| FR-UI-02 | Only critical stats visible; infection shown as symptoms, never a bar. | Must | VS |
| FR-UI-03 | Choices display known costs/risks; never present a fake choice. | Must | VS |
| FR-UI-04 | Depth screens on demand: inventory, companions, shelter, map/journal, codex. | Must | MVP |
| FR-UI-05 | Mobile-first one-hand layout; scales to desktop. | Must | VS |
| FR-UI-06 | Emotional UI + "Quiet Screen" for loss moments; UI degrades with player state. | Should | MVP |
| FR-UI-07 | Keyboard/controller parity with touch. | Should | v1 |

### 7.13 Audio & atmosphere (GDD XVIII)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-AUD-01 | Layered, state-driven adaptive mix (ambient/environmental/dynamic/player/music). | Should | MVP |
| FR-AUD-02 | Audio as information (noise direction/distance, zombie-type signatures, heartbeat with Fear). | Should | MVP |
| FR-AUD-03 | Deliberate silence + adaptive music led by the director. | Should | MVP |
| FR-AUD-04 | Radio sonic identity distinct per signal type. | Could | v1 |
| FR-AUD-05 | Dynamic audio memory: event-linked cues return in dreams/quiet screens. | Could | v1 |
| FR-AUD-06 | Non-audio equivalent for every meaningful sound cue. | Must | MVP |

### 7.14 Content pipeline (GDD XIV, XV)

| ID | Requirement | Pri | Rel |
| --- | --- | --- | --- |
| FR-CNT-01 | All game content authored as external data, loaded at runtime (content-as-data). | Must | VS |
| FR-CNT-02 | Content validated against published schemas in CI; malformed content fails the build. | Must | MVP |
| FR-CNT-03 | Requirements + effects declared in data (no hard-coded branching for content). | Must | VS |
| FR-CNT-04 | Rule of Three: significant locations support ≥ 3 approaches/outcomes. | Should | MVP |
| FR-CNT-05 | Mod-friendly structure (external data + schemas) — capability, not a shipped storefront. | Could | v1 |

---

## 8. User stories & key flows

Representative stories, each tied to requirements. Format: *As a [persona], I want [goal], so
that [reason].*

- **Emergent story (Story Collector).** *I want the game to remember who I saved and lost, so
  that my run becomes a story I can retell.* → FR-SIM-11, FR-NPC-04, FR-STY-06.
- **Meaningful search (Systems Survivalist).** *I want searching to cost time and noise and
  leave the place depleted, so that where and how I scavenge is a real decision.* →
  FR-ECO-01/03, FR-MAP-01, FR-SIM-06.
- **Stop anywhere (Commuter).** *I want to quit after any turn and resume instantly, so that I
  can play in short bursts on my phone.* → FR-CORE-07, NFR-PERF-01, NFR-SAVE-01.
- **A wound with weight (Nostalgic).** *I want a bite to start a frightening story instead of
  just subtracting health, so that survival feels personal.* → FR-INJ-01/05/08.
- **People, not spawns (Story Collector).** *I want survivors who feel authored and whose
  offhand memories actually help me, so that talking matters.* → FR-NPC-01/06.
- **The hard trade (Systems Survivalist).** *I want to be forced to choose Safety, Resources,
  or Time, so that no run plays itself.* → FR-CORE-04, FR-CBT-04, FR-ECO-03.
- **A home to lose (Story Collector).** *I want a shelter and community that lives while I'm
  away and can be lost, so that leaving home has stakes.* → FR-SHL-01/02/06/10.
- **Accessible by default (Accessibility-dependent).** *I want full screen-reader and
  scalable-text support, so that a text game plays flawlessly for me.* → NFR-ACC-01..04.
- **A death that means something (Nostalgic).** *I want dying to be a scene, not a card, so
  that the end of a run lands.* → FR-CBT-10, FR-STY-07.

---

## 9. Non-functional requirements

| ID | Requirement | Pri |
| --- | --- | --- |
| NFR-PERF-01 | Turn resolves and renders in < 100 ms on a mid-range 2022 phone; initial load < 3 s. | Must |
| NFR-PERF-02 | Simulation cost bounded per tick; heavy region/horde updates amortized to hold NFR-PERF-01. | Should |
| NFR-PLAT-01 | Runs in current evergreen mobile + desktop browsers; mobile-first responsive. | Must |
| NFR-PLAT-02 | Engine is headless/renderer-agnostic to enable native + chat-bot clients without a rewrite. | Must |
| NFR-PLAT-03 | Playable offline for a session; no always-online requirement. | Should |
| NFR-SAVE-01 | Save = serialized GameState + seed; save/resume is lossless; autosave at turn boundaries. | Must |
| NFR-SAVE-02 | Versioned saves with a documented migration path; no silent corruption. | Must |
| NFR-REL-01 | Crash-free session rate ≥ 99.5% at launch; deterministic core enables repro from seed+state. | Must |
| NFR-ACC-01 | All critical info conveyed without reliance on color or audio alone. | Must |
| NFR-ACC-02 | Full screen-reader support; semantic, navigable text UI. | Must |
| NFR-ACC-03 | Scalable text and high-contrast / colorblind-safe themes. | Must |
| NFR-ACC-04 | Reduced-motion and reduced-flicker modes. | Should |
| NFR-LOC-01 | All player-facing strings externalized for localization from day one. | Should |
| NFR-LOC-02 | Layout tolerates text expansion; RTL considered. | Could |
| NFR-PRIV-01 | Minimal data collection; clear opt-in for any telemetry; no PII required to play. | Must |
| NFR-MAINT-01 | Content authorable and validated without engine changes (ties FR-CNT-01/02). | Must |

---

## 10. Technical requirements & constraints

The stack is **deliberately undecided** (user direction; see Open Questions §15 and
`design/decisions/`). These constraints hold regardless of the language ultimately chosen and
derive from GDD Part XIV.

- **TEC-01 · Deterministic core.** Same GameState + seed ⇒ same turn result. All randomness
  derives from the run seed. This underpins testing (NFR-REL-01), save/resume (NFR-SAVE-01),
  and reproducible bug reports.
- **TEC-02 · Content as data.** Regions, locations, items, weapons, survivors, zombies,
  encounters, and radio are external data validated against schemas; the engine reads content
  and never hard-codes it (FR-CNT-01/02/03).
- **TEC-03 · Headless engine.** The core takes (state, action) → (state, scene); rendering is a
  separable client layer (NFR-PLAT-02).
- **TEC-04 · Single serializable state.** One GameState object is the source of truth, enabling
  snapshot saves and clean debugging tools (state inspector, seed setter, event/flag console,
  simulation fast-forward).
- **TEC-05 · Declarative requirements + effects.** Content gates on state predicates and
  declares its state changes; prefer meaningful world state over ad-hoc boolean flags.
- **TEC-06 · Append-only history.** Significant events log to a queryable Living History for
  callbacks, run summaries, and cross-run memory.
- **TEC-07 · Bounded performance.** The simulation is bookkeeping, not physics; keep per-tick
  work bounded to meet NFR-PERF-01 on mobile.

**Decision gate:** the engine-language/runtime ADR (`0001`) must be accepted before
`prototype/` code begins. Selection criteria: strong web deployment story, good testing story
for a deterministic core, and viability of a shared core across web + bot clients.

---

## 11. Release plan & milestones

Aligned to GDD Part XIX. Dates are intentionally omitted pre-staffing; sequence and exit
criteria are the commitment.

| # | Milestone | Definition of done |
| --- | --- | --- |
| M1 | **Core loop playable** | One region, ~5–8 remembering nodes; move/search/fight-or-avoid/rest with time, noise, wounds, finite loot; deterministic core with passing unit tests. (Vertical Slice) |
| M2 | **Reactive world** | Six layers + director produce visibly reactive turns; regional threat evolves off-screen; hordes respond to noise; weather live. |
| M3 | **People & shelter** | Companions, first survivor subset, shelter loop + daily report + night attacks, Storyteller producing an emergent end-to-end story. |
| M4 | **Content-complete city** | Full launch Content Bible for the first city; infection-as-identity, radio network, encounter breadth; schema-validated in CI. (MVP/beta) |
| M5 | **Release candidate** | Balanced (Part XVI targets), accessible (NFR-ACC), localized (NFR-LOC), save migration, multiple + failure endings, hardened. (v1.0) |

Gate between M1 and M2 is the **fun gate**: if the slice doesn't pass the "one more day" test,
scope stays on the loop, not on content.

---

## 12. Dependencies & assumptions

**Dependencies**
- Accepted engine-language ADR (`0001`) before `prototype/` work (blocks all code milestones).
- Content schemas defined before large-scale authoring (blocks M4 content volume).
- A telemetry baseline from closed testing before numeric metric thresholds are fixed (§4).
- Art/audio direction locked before the polish pass (M5).

**Assumptions**
- Single-player, offline-capable at launch; no server-authoritative state required for v1.
- One launch city is sufficient scope to prove the game; more cities are post-launch.
- The handcrafted survivor pool (~60–100) is authored incrementally; the slice ships a subset.
- Team can author content in parallel with engine work because content is data (TEC-02).

---

## 13. Risks & mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| **Systemic but not fun** — the simulation is impressive but the moment-to-moment is flat. | High | Med | Fun gate at M1; prototype the slice before content; playtest for the "one more day" test early and often. |
| **Content volume** — an emergent game is content-hungry; repetition breaks the illusion. | High | High | Tag/condition recombination (FR-ENC-01/02), Rule of Three (FR-CNT-04), encounter evolution (FR-ENC-08), cooldowns; measure verbatim-repeat rate (§4). |
| **Scope creep** — the design is deep and every system tempts expansion. | High | High | The six principles as an explicit cut filter (GDD II / XIX); strict Won't-now list (§6). |
| **Balance fragility** — scarcity tuning that produces either trivial or hopeless runs. | Med | Med | Director + comeback mechanics (GDD XVI); staged balance passes; telemetry on death timing/causes and margins. |
| **Infection-as-identity is confusing** — hidden state frustrates instead of unsettling. | Med | Med | Strong symptom design + optional diagnosis; playtest comprehension; never require the hidden number to make a decision. |
| **Accessibility retrofit** — bolted on late and incomplete for a text game. | Med | Low | NFR-ACC as Must from M1; screen-reader semantics built into the UI foundation. |
| **Undecided stack stalls delivery** — analysis paralysis on the language. | Med | Med | Time-boxed ADR `0001` with explicit selection criteria (§10); doc/design work proceeds regardless. |
| **Save-schema churn** — evolving state model breaks saves. | Med | Med | Versioned saves + migration path from the first save format (NFR-SAVE-02). |

---

## 14. Traceability matrix (requirement area → GDD source)

| PRD area | GDD part(s) |
| --- | --- |
| §7.1 Core loop | III (Core Loop & Scenes), IV (Pipeline) |
| §7.2 World simulation | IV (World Simulation Engine) |
| §7.3 Exploration & map | VII (Exploration, Map & Travel) |
| §7.4 Player systems | V (Player Systems) |
| §7.5 Injuries & infection | VI (Injuries, Infection, Health & Mind) |
| §7.6 Encounters | VIII (Encounters & Events) |
| §7.7 Combat & stealth | IX (Combat, Stealth & Zombie AI) |
| §7.8 Economy | X (Inventory, Crafting, Loot & Economy) |
| §7.9 Shelter | XI (Shelter & Community) |
| §7.10 Survivors & factions | XII (Survivors, NPCs & Factions) |
| §7.11 Story, radio, endings | XIII (Story, Radio & Endings) |
| §7.12 UI/UX | XVII (UI, UX & Presentation) |
| §7.13 Audio | XVIII (Audio & Atmosphere) |
| §7.14 Content pipeline | XIV (Technical Architecture), XV (Content Bible) |
| §9 Non-functional | XIV, XVI, XVII |
| §10 Technical constraints | XIV (Technical Architecture) |
| §11 Milestones | XIX (Production Roadmap) |

The six principles (GDD II) are cross-cutting and touch every area; they are the acceptance
lens for the whole product, not a single section.

---

## 15. Open questions & decisions to make

Tracked as ADRs in `design/decisions/`.

1. **Engine language & runtime (ADR-0001).** Deferred by direction. Must be resolved before
   code. Criteria in §10.
2. **Content data format (ADR-0002).** JSON vs YAML vs a custom authoring format; affects
   tooling and modding.
3. **Save format & versioning (ADR-0003).** Storage target (local vs. optional cloud sync) and
   migration strategy.
4. **Platform ordering (ADR-0004).** Web-first is set; the order of native app, Steam, and the
   Discord/Telegram bot after launch is open.
5. **Monetization & business model.** Out of scope for this PRD version; needs a decision before
   launch planning (premium, free + cosmetic, episodic content, etc.).
6. **Persistence of cross-run memory.** How much Living History carries between runs, and
   whether that's account-bound.
7. **Numeric metric thresholds (§4).** Finalized after a closed-test telemetry baseline.
8. **Licensing.** Final license selection (proprietary / source-available / open) before any
   public release.

---

*End of PRD. This document tracks the GDD; when the GDD changes, revisit the affected
requirements and the traceability matrix.*
