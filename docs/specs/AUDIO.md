# Zurvival Reborn — Audio Bible

**Version:** 1.0 · **Status:** Pre-production · **Owner:** Jharek
**Reads with:** [`docs/specs/GDD.md`](GDD.md) Part XVIII (the audio vision) · [`docs/specs/PRD.md`](PRD.md) (requirements) · [`DESIGN.md`](../../DESIGN.md) §10 (the engine↔client contract)
**Companion:** [`assets/audio/Zurvival_Audio_Cue_Sheet.xlsx`](../../assets/audio/) — the asset manifest of record.

---

## 1. Purpose

The GDD says *what audio is for* (Part XVIII). This document says *how it is built, mixed,
triggered, named, and shipped* — the reference an audio designer, composer, and engine
programmer work from without re-deriving intent. It is **middleware-agnostic** on purpose:
the runtime is not chosen (ADR-0001), so nothing here assumes one. §13 maps the abstract
model onto Web Audio, FMOD, and Wwise.

Audio in Zurvival is not decoration on a text game. In a text-forward game **the soundtrack
is the graphics**. It carries the mood the prose implies, delivers information the player
must act on, and burns specific moments into memory. Every rule below serves that.

The single sentence to keep: **the mix is a readout of the simulation, not a playlist.** If a
cue is playing, some system put it there — a threat rose, a horde neared, the wind changed,
the Fear Meter climbed. Audio that isn't driven by state is a bug.

## 2. The five pillars

Carried from GDD XVIII and made load-bearing. Every asset serves at least one; the best
serve several.

1. **Atmosphere** — sound builds the world the text only names. The prose says "the ward is
   quiet"; the bed makes *quiet* a place with a dripping pipe and a dead fluorescent buzz.
2. **Information** — audio is a gameplay signal. A distant shot, a nearing horde, a change in
   the wind, a Screamer heard before it is seen: the player learns to *listen* as a survival
   sense.
3. **Emotion** — music and tone shape how a scene feels without narrating it. The score never
   tells the player they are sad; it makes the room cold.
4. **Memory** — signature sounds bind to specific events and resurface with meaning (§9,
   Dynamic Audio Memory). Sound is one of the game's memory organs, alongside node memory and
   Living History.
5. **Silence** — the most powerful tool in the kit. Quiet used on purpose is terror; the
   *return* of sound after silence is an event. Silence is authored, not absence.

### 2.1 The Golden Rule of audio

> **When in doubt, take it out.** The default state of the mix is sparse. Layers earn their
> place by carrying atmosphere, information, or emotion; if a layer does none of the three in
> the current moment, it fades. A scene that breathes is worth more than a scene that is full.

## 3. The layer model

The mix is assembled from five layers, each owned by a different part of the simulation and
each independently duckable. This is the spine every later section hangs on.

| Layer | Source in the sim | Examples | Behaviour |
| --- | --- | --- | --- |
| **Ambient bed** | region + time + weather + interior/exterior | city hum, ward silence, rain on a roof, wind through a stairwell | Loops; cross-fades on context change; the floor of the mix. |
| **Environmental** | specific node/world sources | dripping pipe, flickering ballast, gas hiss, a distant fire, a car alarm two blocks over | Positioned one-shots and short loops tied to node discoveries. |
| **Dynamic** | threat & state (Director-driven) | horde approach, stinger on a bad reveal, the swell before an attack | The informational layer; interrupts and ducks the rest. |
| **Player** | the body | heartbeat (Fear), breathing, footsteps, pain, infection distortion, tinnitus | Intimate, close-mic'd; scales with condition, not the world. |
| **Music** | the Director's read of tension | the six themes (§4) | Sparing, adaptive, allowed to drop to nothing. |

Two rules govern the stack:

- **Layers are mixed adaptively, never scripted.** The client's Audio Director (§13.2) sets
  each layer's level every turn from the `Scene.ambience` payload and a handful of continuous
  parameters. No content file says "play track 4."
- **Priority is fixed, level is dynamic.** When the mix gets busy, information wins: the
  Dynamic and Player layers duck everything below them (§10.2) so a gunshot, a scream, or a
  heartbeat is never buried under a music swell.

## 4. The adaptive music system

Music is **sparing and reactive**. It is not a loop the game plays over; it is a set of
states the Director moves between, and one of those states is *nothing*.

### 4.1 The six themes

Five carried from the GDD, plus the shelter, because home needs its own color.

| Theme | Fires when | Palette | Notes |
| --- | --- | --- | --- |
| **Survival** (default tension) | outside, ambient threat, nothing acute | low sustained strings/synth, sub pulse, no melody | The baseline drone. Often barely present. |
| **Exploration** | scavenging, a new node, relative safety | sparse guitar/piano motifs, air, space | Curiosity, not comfort. Drops instantly on threat. |
| **Danger** | horde near, combat, detection | rhythmic low percussion, dissonance, rising intensity | Vertical layers stack with proximity (§4.3). |
| **Loss** | a death, desertion, a burned shelter, a hard turn | solo cello/voice, sparse piano, long decay | Rare. It *is* the moment; never wallpaper. |
| **Hope** | a rescue, a cure, a working radio, a child kept safe | warmth, a resolving major motif, breath | The counterweight. Earned, never given. |
| **Home** (shelter) | inside a claimed, standing shelter | soft room tone + a fragile recurring motif | Has a day and a night variant (§5.4); the night variant is a signature sound (§8). |

Themes do not queue. A death mid-scavenge cuts Exploration and lets **Loss** arrive in the
gap. The transition is authored per pair where it matters (§4.4).

### 4.2 The music state machine

The Director (GDD IV; DESIGN §11) already computes a read of the moment. The Audio Director
maps that read to a theme and an **intensity** 0–4. Music does not choose itself; it is told.

```
inputs (per turn, from the sim):
  runPhase        Shock | Survival | Community | Legacy      (GDD XVI)
  tension         0.0–1.0   (Director)
  threatProx      0.0–1.0   nearest horde / hostile proximity (GDD IV)
  fear            0.0–1.0   Fear Meter                        (GDD IX)
  event           null | combat | last_stand | death | rescue | cure | loss | discovery
  place           exterior | interior | shelter
  timeOfDay       dawn…late_night
→ theme  = selectTheme(event, place, threatProx, tension)
→ level  = quantize(max(tension, threatProx, fear), 0..4)
```

**Intensity ladder (vertical remix).** Each theme is authored as stems that enter with level,
so intensity rises without a hard cut:

- **0 — Absent.** No music. Ambience and body only. The most common state outside of set
  pieces. Silence is the level-0 track.
- **1 — Pulse.** A sub and a single sustained element. "Something is wrong somewhere."
- **2 — Bed.** Add harmonic pad / low strings. Committed mood.
- **3 — Motion.** Add rhythmic element / arpeggio. Combat, chase, a story swell.
- **4 — Peak.** Full stack, dissonance, the Last Stand. Held briefly, then released — a peak
  that never resolves is exhausting.

### 4.3 Combat & chase (vertical, not a stinger loop)

Danger intensity tracks **threatProx** and **fear** continuously. Approaching a horde raises
level 1→2→3 as it nears; breaking line of sight and putting distance in drops it back. The
music *is* the threat readout. On a resolved fight the stack decays over a few seconds rather
than cutting — the adrenaline outlives the danger.

### 4.4 Transitions, silence, and the return

- **The drop is a cue.** Cutting music to nothing is one of the loudest things the score can
  do. Use it on a reveal, a held breath, the moment before a night attack.
- **The return is an event.** After a stretch of level-0, music re-entering *means* something
  arrived. Never fade music back in as background; bring it back on a beat that deserves it.
- **Loss and Hope are one-shots, not states.** They play through and hand the mix back to
  silence or Survival. They do not loop.
- **Stingers** are short, authored, and rare: a bad reveal, a Screamer's first shriek, a
  Last Stand trigger. A stinger that plays twice an hour stops meaning anything.

### 4.5 Composer brief (palette)

Instrument the score for a ruined, hand-made world: **detuned/prepared piano, solo cello and
violin, low brass swells, analog synth drones, sub-bass, and found-percussion** (metal, wood,
debris). Avoid a full orchestra and avoid anything that sounds heroic — the player is *barely
surviving, never winning* (Manifesto). Keep a small motif library that can be voiced in each
theme so the score feels like one memory told six ways; the **Home** motif and one **player
motif** should be recognizable enough to return in a dream (§9).

## 5. Ambience beds — the world

The floor of the mix. A bed is built by **stacking sub-layers**, not by picking one file, so
any region × time × weather × interior combination resolves without authoring the product of
all of them.

```
bed = region_base
    + timeOfDay_layer
    + weather_layer
    + (interior_layer | exterior_openness)
    + optional node_environmental one-shots (§6.5)
```

### 5.1 Region base beds

One base per region (Downtown, Residential, and so on — GDD VII). The base carries the
region's identity: Downtown is concrete canyon, distant structure groans, far sirens long
dead; Residential is emptier, birds that shouldn't be calm, a suburb holding its breath.
Region beds also carry **threat coloration** — as a region's threat level rises (GDD IV), its
bed darkens (more low-end, more distant wrongness) without changing track.

### 5.2 Time-of-day layers

Six phases (GDD IV: dawn, morning, afternoon, evening, night, late night). Each is a thin
layer over the region base: morning adds thin light activity; night strips the top end and
adds cold space; **late night** is near-silent and wrong — the horror window, and the level
where the Player layer (heartbeat, breath) is most exposed.

### 5.3 Weather layers

Weather is a mechanic (GDD IV), so its audio is informational, not just texture:

| Weather | Bed | Gameplay tell the mix must sell |
| --- | --- | --- |
| Clear / Cloudy | neutral | baseline; footsteps and world noise carry far |
| **Rain** | steady rain bed | *masks* footsteps and world noise — the mix pulls back detail, threat cues arrive later/closer |
| **Storm** | rain + wind + thunder one-shots | hides player noise but knocks out power (interiors go silent, alarms die) |
| **Fog** | muffled, close, low-pass everything | you hear less *and* farther-wrong; navigation dread |
| **Snow** | hushed, high-frequency stillness | slows movement; footsteps crunch (louder, a cost) |
| **Wind** | gusting bed | rises and falls; can mask an approach in a lull-to-gust |
| Heat wave / Cold snap | cicada shimmer / brittle stillness | environmental stress coloring |

Rule: **weather changes what the player can hear and be heard over**, and the mix must make
that legible — rain that hides a horde until it's close is a feature (§6.1).

### 5.4 Interior vs exterior, and the shelter

Interiors low-pass and enclose the exterior bed and add room tone (HVAC ticking dead, a
fridge that stopped, a specific ward silence). The **shelter** is its own signed space (§8):
a day bed (muffled life, low talk, work) and a **night bed** — the "tone of the shelter at
night," a signature sound the player comes to know, and the canvas a night attack shatters.

## 6. SFX taxonomy

Organized by the system that owns each sound. Every entry has an ID (scheme in §14.1) and a
row in the cue sheet. IDs below are representative, not exhaustive.

### 6.1 The noise system (audio *is* the mechanic)

Noise is the game's most important currency (GDD IV; DESIGN §5 deposits noise at pipeline
stage 6, hordes consume it at stage 9). Audio has to make noise *readable* both directions:

- **Your noise, heard as you make it.** Every action's noise value has a matching loudness so
  the player feels the cost of the "Safety" corner. Anchor the mix to the GDD's values:

  | Action | Noise | Sound treatment |
  | --- | --- | --- |
  | Walk | 2 | soft, surface-dependent |
  | Run | 5 | committed footfalls, breath |
  | Break a door | 8 | sharp, echoing one-shot — a spike the player *hears* travel |
  | Pistol | 12 | loud crack + tail; triggers hearing model (§6.4) |
  | Shotgun | 20 | concussive; heavier hearing hit |
  | Explosion | 40 | overload, ringing, temporary deafness |

- **The world's noise, heard by direction and distance.** A distant shot, a breaking window,
  a horde's collective sound must be **positioned** (bearing) and **attenuated/filtered by
  distance** (far = low-passed, reverberant) so the player can read *where* and *how close*.
  This is diegetic information the player learns to act on.
- **Noise decays; the mix decays with it.** A spike (gunshot) leaves a tail of consequence —
  the mix stays tense while the deposited noise is still drawing things, then settles as it
  fades. Sound mirrors the noise field's lifetime.

### 6.2 Zombies — sound signatures

Zombies are simulated agents with states — **dormant, wandering, investigating, chasing,
feeding, hibernating** (GDD IX). Each type gets a recognizable **signature** the player learns
to fear, plus per-state vocalizations. The design intent: **you should be able to close your
eyes and know what's out there and what it's doing.**

| Type | Signature (the tell) | State vox | Design note |
| --- | --- | --- | --- |
| **Fresh** | fast, wet, ragged breathing; quick scuffing | agitated, frequent | recently turned; the sound of speed |
| **Rotter** | slow drag, low wet moan | sparse, groaning | the common bed of horde sound |
| **Crawler** | low scrape, nails on floor, *close and below* | wet clicking | easy to miss — mixed low and near, ankle height |
| **Bloated** | labored gurgle, gas, a wet swell | bubbling | a rising internal pressure sound = *don't shoot it close*; burst is a signature one-shot |
| **Riot Officer / Soldier** | armor clank, muffled impacts on plate | heavy, resonant | the sound of a thing you can't easily put down |
| **Screamer** | quiet shuffle **until** the shriek | building rasp → **scream** | the scream is a top-tier signature stinger: it *calls the region* — must read as "everything just got worse" (§8) |
| **Stalker** | near-silence; a single displaced sound behind you at night | almost none | hunts the player specifically; its signature is *wrongness in the quiet*, not a loud cue |

- **Horde bed.** A mass is not N individual voices (perf — §12); it's a **collective bed**
  (a churning wall of moan + movement) whose size, distance, and bearing are parameters. It
  swells as the horde nears and is the Danger theme's diegetic partner.
- **State reads.** Investigating = a sound turning *toward* you (filter opens, bearing locks);
  chasing = the bed tightens and speeds; feeding = wet, occupied, ignorable-if-careful.

### 6.3 Combat & weapons

Combat is where injuries are minted (GDD IX); its audio is heavy, consequential, and short.

- **Melee by class** (GDD IX): **Blunt** (bat, crowbar, hammer) — dull, heavy, tiring impacts
  with a little noise; **Blade** — cleaner, quieter, wetter; **Improvised** — one-offs that
  can break (a snap = a bad moment). Impacts vary by target (flesh / armor / bone / miss on
  concrete).
- **Firearms** — the loudest choices in the game and a strategic cost, not a stat (GDD IX).
  Each gun: fire crack + mechanical action + tail (indoor reverb vs outdoor slap) + **the
  hearing hit** (§6.4). Add reload, dry-fire click (out of ammo — a horror beat), and jams.
- **Environment as weapon** (GDD IX): gas leak hiss → ignition, alarms rigged as lures, a car
  used as a chokepoint. These are gameplay one-shots the player deploys, so they must read as
  *cause → effect* (the alarm you trip to pull a horde off your route).
- **Panic** (GDD IX): as the Fear Meter peaks, a lost exchange, a **dropped weapon** (a
  specific, sickening clatter), a scream that draws more. Panic has its own small sound set.

### 6.4 Player body

The intimate layer, mixed close and personal. It scales with **condition**, not the world,
and it is where infection and fear become audible.

- **Heartbeat** — tied to the Fear Meter (GDD IX). Enters low, rises in rate and level with
  fear (dark, surrounded, low health), and is the last thing standing in a level-0 mix. The
  heartbeat is the player's vital sign made audible.
- **Breathing** — rate/depth from stamina and fear; ragged when hurt, held during stealth,
  ragged again on exertion.
- **Footsteps** — by **surface** (concrete, glass, water, snow, debris, carpet) and **pace**;
  they *are* the player's noise output made audible (§6.1). Glass and debris are loud floors —
  a Safety cost the player can hear.
- **Pain & wounds** — winces, a limp's uneven step (a Sprained Ankle you can hear), the scent-
  trail deep cut has no sound but its consequences (drawn zombies) do.
- **Hearing damage** — a real, frightening consequence (GDD XVIII). A close gunshot or blast
  drops the world into **muffled low-pass + tinnitus ring** for a stretch, during which the
  player is *deaf to threat cues*. This is a mechanic, not an effect; it has an accessibility
  toggle (§11) and a visual equivalent.
- **Infection distortion** (GDD VI) — as infection stages advance (Asymptomatic →
  Symptomatic → Advanced → Terminal), the mix becomes **unreliable** (§9.2): Symptomatic adds
  a faint fever shimmer and heartbeat presence; Advanced introduces **hallucinated sounds**
  (a voice, a knock, a horde that isn't there) and drops (memory gaps as audio cuts); Terminal
  strips the world to breath and heart. The player reads their own stage through what they
  hear.

### 6.5 Exploration & interaction

The tactile layer that keeps the world physical (GDD VII; micro-choices).

- **Search** — rummaging by container (desk, cabinet, corpse, car, medicine cabinet), each
  with a length that matches its time cost; a **payoff sound** on a find that scales with
  rarity (a common can vs. a legendary artifact gets a distinct, memorable cue).
- **Doors, windows, barricades** — open/close/force/board; a *specific door* is a signature
  sound (§8). Forcing is loud (§6.1).
- **Crafting & repair** (GDD X) — assembly, sharpening, taping, the click of a thing fixed.
- **Loot & inventory** — pick up, drop, the weight of a full pack, the **Last Can** (GDD X)
  deserves its own quiet, singular sound: the moment you eat your last food.

### 6.6 The radio network

The radio has its own sonic identity and is the game's main deliberate story channel (GDD
XIII). It must sound like a *real evolving system*, not a cutscene player.

- **Tuning & static** — the search across the band; the texture of static, the lock of a
  signal, the specific timbre difference between an official loop, a frightened human voice,
  and a signal that *shouldn't exist*.
- **The four broadcast types** (GDD XIII), each with a distinct sonic grammar:
  - **Emergency broadcasts** — automated, degrading official loops; the sound of the old world
    running down (tape wear, a message repeating past its own relevance).
  - **Military broadcasts** — clipped, procedural, cold; often a trap or already fallen.
  - **Civilian / ham operators** — real, unguarded human voices with room tone; some go
    **silent mid-sentence** (a signature gut-punch).
  - **Automated / unknown signals** — number stations, loops, a tone that unsettles by
    existing (the "signal that shouldn't be transmitting").
- **Broadcasting yourself** (GDD XIII, radio room) — the sound of *your* voice going out;
  calling for help, warning, luring, or lying, each with weight.
- **Signature radio stingers** — a station **going dark** when its region falls; a **new
  signal appearing** after a global event. These are audio landmarks (§8) and hooks for
  Dynamic Audio Memory (§9): the song on the radio the night someone died can return.

### 6.7 Weather & environmental one-shots

Beyond the weather beds (§5.3), specific sources punctuate a node: a **dripping pipe**, a
**flickering ballast/light**, a **gas hiss**, a **distant fire**, a **car alarm**, **thunder**,
a **branch/structure groan**. These are positioned environmental one-shots/short-loops tied to
node discoveries, and several double as gameplay (gas → fire; alarm → lure).

### 6.8 Shelter

Home is the game's exhale (GDD XI). Its sound set is the emotional counterweight to the
outside.

- **The shelter tone** (day/night, §5.4) — the signed room sound of home.
- **Jobs & daily report** (GDD XI) — the low activity of a working community; the daily report
  has a gentle, readable UI voice (§6.9).
- **Night attack** (GDD XI) — the shelter tone **breaking**: the first impact on a barricade,
  the alarm, the shift to Danger. The contrast with the night bed is the whole point.
- **The Quiet Screen** (GDD XVII) — a deliberately near-silent state (a loss, a held breath);
  a primary canvas for Dynamic Audio Memory returns (§9).

### 6.9 UI & system

Restrained, diegetic where possible (GDD XVII: the UI recedes). Choice hover/confirm, turn
advance, notification (soft, never a phone-game chime), the daily report, save (a quiet,
reassuring "the world is safe to stop on" — DESIGN §9), menu, and **death / Last Stand**
(GDD IX) — never a "You Died" sting; the Last Stand is a *scene* with its own heightened,
authored audio and the **final broadcast** device (§8) as its closing sound.

## 7. Signature sounds — the audio landmarks

A handful of sounds are deliberately **fixed and reused** so they become the game's landmarks
— the player learns them and reacts before the text loads. Keep this set small (GDD XVIII: "a
handful"); overuse dilutes them.

- **The Screamer's shriek** — "the region just woke up."
- **A specific door** — the shelter's own door; home, or home breached.
- **The shelter-at-night tone** — safety, and the thing a night attack destroys.
- **A specific alarm** — the lure you rig / the trap that catches you.
- **The final broadcast** — the recurring closing device (GDD XIII): the last thing that goes
  out over the radio about you, or from you, as a run ends.
- **The player motif & Home motif** (§4.5) — melodic landmarks that return in dreams.

## 8. Canonical: Dynamic Audio Memory

*(Canonical per GDD XVIII — core to the intended emotional effect, not decoration.)*

Sound participates in memory the way node memory and Living History do. A cue attached to a
**formative event** can **return** later to reopen that memory.

- **Binding.** When a signature-eligible event fires (a companion's death, a betrayal, the
  first night in the shelter, a rescue), the Audio Director records the **cue that was
  playing** (a radio song, a specific silence, the Loss motif voicing) against that event in
  the run's memory (GDD XIII, Living History).
- **Return.** Later — in a **dream** during sleep (GDD VI) or on a **Quiet Screen** (GDD
  XVII) — the bound cue can resurface, recontextualized, to land the memory. The song on the
  radio the night they died; the particular silence of the shelter after a loss.
- **Rules.** A bound cue returns **rarely and pointedly** (never as ambience), is always
  tied to the specific run's events (so it's personal, not generic), and degrades/recolors on
  return (memory is lossy). Like the Storyteller for narrative, this is how the *soundscape*
  remembers.

## 9. The Fear & infection audio model

Two systems make the mix itself **unreliable as a mechanic** — the player's perception is
part of the simulation (GDD VI, IX).

### 9.1 Fear

The hidden Fear Meter (GDD IX) drives the Player layer: heartbeat rate/level, breath, and a
progressive **narrowing** of the mix (top end rolls off, the world tunnels toward the threat).
At the extreme, panic (§6.3). Fear audio is authored as a continuous parameter, not stages.

### 9.2 Infection (unreliable audio)

As infection advances (GDD VI), audio stops being trustworthy — *by design*, this is scarier
than a bar:

- **Symptomatic** — fever shimmer; heartbeat more present; a few sounds slightly wrong.
- **Advanced** — **hallucinated sounds** (voices, knocks, a horde that isn't there — sounds
  "that may not be real," GDD VI), and **audio memory gaps** (the mix cutting out on turns the
  narrator can't account for).
- **Terminal** — the world recedes to breath and heartbeat; the final turn.

Because this weaponizes audio, it is **gated by accessibility settings** (§11) and always has
a non-audio equivalent so it never *hides* required information unfairly.

## 10. Mixing, buses & loudness

### 10.1 Bus structure

```
Master
├─ MUSIC          (the six themes; the most duckable)
├─ AMBIENCE       (region/time/weather beds; interior/exterior)
├─ SFX
│   ├─ WORLD      (noise system, zombies, weather one-shots, environment)
│   ├─ COMBAT     (weapons, impacts, panic)
│   └─ INTERACT   (search, doors, loot, crafting)
├─ PLAYER         (heartbeat, breath, footsteps, pain, tinnitus, infection)
├─ RADIO          (its own path; can be foregrounded when tuned)
└─ UI             (choices, notifications, save, reports)
```

### 10.2 Priority & ducking (sidechain map)

Information beats mood. Higher-priority buses duck lower ones:

1. **Player** (heartbeat, hearing damage, infection) and **Dynamic threat cues** — top; they
   duck Music and Ambience so a scream/heartbeat/gunshot is never masked.
2. **Radio when tuned** — foregrounds over Music/Ambience (you're *listening*).
3. **Combat** — ducks Music to a bed and Ambience down; the Danger theme rides *with* it, not
   over it.
4. **UI** — light, ducks nothing meaningfully; must never step on a threat cue.
5. **Music** — yields to everything above; its silence is a feature, not a gap.

### 10.3 Loudness targets

- **Integrated loudness:** master around **−16 LUFS** (headphone/mobile-forward), with a
  **wide dynamic range** — silence must be able to be *silent* so a gunshot has somewhere to
  go. Do not master to a loud, flat game-trailer level; this game lives in its quiet.
- **True-peak** ceiling **−1.0 dBTP**.
- **Two mix profiles** (§11): **Headphones/Night** (full dynamic range, positional detail)
  and **Speaker/Compressed** (raised floor, tamed peaks for phone speakers and noisy rooms).

## 11. Accessibility

Non-negotiable and canonical (GDD XVII, XVIII): **audio is never the only channel for
anything the player needs.**

- **Captions/subtitles** for all speech (radio, companions) and **sound captions** for
  meaningful non-speech cues (`[distant gunshot — north]`, `[a scream — close]`, `[horde
  approaching]`). Positional captions carry the bearing the audio does.
- **Visual threat equivalents** — every informational sound has a readable on-screen state
  (threat indicators, a noise readout, symptom text) so a deaf/HoH player has full information
  (GDD XVII).
- **Independent volume sliders** per bus (§10.1) + master, plus a **mono** downmix and the two
  **mix profiles** (§10.3).
- **Hearing-damage / tinnitus toggle** — the muffle+ring effect (§6.4) can be reduced to a
  brief visual-only cue; likewise an **infection-audio-distortion** reduction that keeps the
  narrative but removes disorienting hallucinated audio for players who need it (§9.2).
- **Reduce-sudden-sounds** option — softens stingers and the shotgun/explosion transients for
  startle-sensitive players, without removing the information.
- **Heartbeat/breath** can be surfaced as a visible pulse for players who mute the Player bus.

## 12. Performance budgets (mobile-bounded)

The sim targets instant turns on a mid-range 2022 phone (DESIGN §12); audio must fit inside
that, not fight it.

- **Voices:** target ≤ **24–32 simultaneous voices**; a horde is **one collective bed**, not
  N sources (§6.2). Positional world-noise sources capped and virtualized beyond a distance.
- **Memory:** ambience beds and music stems **stream**; short SFX (impacts, UI, footsteps,
  zombie vox) load **in-memory** in a compact bank. Budget a working set that respects a
  mid-range phone's headroom.
- **Formats:** compressed streaming (Ogg/Vorbis or platform-native AAC) for beds/music/radio;
  short SFX as compact PCM/ADPCM banks for zero-latency one-shots. Author masters at 48 kHz/24-
  bit; deliver platform-appropriate.
- **Turn-bounded work:** the Audio Director resolves the next mix within the turn budget; no
  per-sample DSP that spikes a turn. Reverb/positioning use lightweight sends, not per-source
  convolution on mobile.
- **The mix's sparseness is also a perf feature:** level-0 music and sparse beds cost little.
  The Golden Rule (§2.1) pays for itself.

## 13. Implementation — the engine↔audio contract

Audio lives entirely in the **client** (DESIGN §3, §10). The deterministic core never makes
sound and never depends on it. The core hands the client a `Scene`; the client's Audio
Director turns it into a mix.

### 13.1 The `Scene.ambience` contract

The engine already emits an ambience hint on every Scene (DESIGN §10):

```
type Scene = {
  context:  { where, day, hour, phase, weather },
  status:   { visibleStats },
  text:     string[],
  choices:  Choice[],
  ambience?: { audioCues, tone }        // ← the audio hook
}
```

This bible specifies what flows through `ambience` (and the small set of continuous
parameters the client reads from `context`/`status`) — **hints, not commands**. The engine
says *what is true*; the client decides *what to play*.

```
ambience: {
  tone:      "survival" | "exploration" | "danger" | "loss" | "hope" | "home",
  audioCues: [ AudioCue... ]      // discrete events fired this turn
}
type AudioCue = {
  id:        string,              // e.g. "ZOM_SCREAMER_SHRIEK", "RAD_STATION_GO_DARK"
  intent:    "stinger" | "loop_start" | "loop_stop" | "oneshot" | "memory_bind",
  bearing?:  number,              // degrees, for positional world noise
  distance?: "close" | "mid" | "far",
  priority?: 0..4,
  bindKey?:  string               // for memory_bind: the event to bind the current cue to (§8)
}
```

**Contract rules (mirroring DESIGN §10):** the client renders `Scene` and never sees hidden
state (infection number, director biases, loot rolls). `tone` and continuous parameters are
*derived* readouts, not raw internals — the client gets "danger, high" not the threat float.
A chat-bot client can ignore audio entirely and lose nothing required (accessibility, §11).

### 13.2 The client-side Audio Director

A small client module that mirrors the sim Director (DESIGN §11) for sound:

```
onScene(scene):
  1. resolveBed(context.where, context.phase, context.weather, interior?)   → §5 stack
  2. setMusic(ambience.tone, level = f(tension, threatProx, fear))          → §4.2 ladder
  3. for cue in ambience.audioCues: schedule(cue)   // stingers, loops, oneshots, positional
  4. updatePlayerLayer(status, fear, infectionStage)                        → §6.4 / §9
  5. applyDucking(priority map)                                             → §10.2
  6. handleMemory(cue.intent == "memory_bind" | dream/quiet-screen return)  → §8
```

Continuous parameters (tension, threatProx, fear, timeOfDay) are exposed to the runtime as
game parameters (RTPCs / game syncs) so beds and music stems remix without new events.

### 13.3 Determinism boundary

Audio is **downstream and side-effect-only**. It reads Scene, it never writes GameState, and
it must not influence the seeded RNG or turn resolution (DESIGN §9). Two clients with sound
on and off must produce identical runs. Dynamic Audio Memory (§8) is stored in the *client's*
presentation memory / Living-History read, not in the deterministic core.

### 13.4 Middleware mapping (tool-agnostic → concrete)

Nothing above assumes a runtime (ADR-0001). The abstract model maps cleanly onto all three
likely stacks:

| Abstract concept | Web Audio API (web-first, PRD) | FMOD | Wwise |
| --- | --- | --- | --- |
| Bus tree (§10.1) | `GainNode` graph / `AudioWorklet` submixes | buses / VCAs | Actor-Mixer + bus hierarchy |
| Theme + intensity ladder (§4.2) | crossfaded stem `AudioBufferSourceNode`s on shared clock | parameter-driven layered event | Blend/Switch container + State |
| Continuous params (tension/fear) | plain JS values → `GainNode.gain` ramps | FMOD parameters | RTPCs |
| `tone` / `event` (§13.1) | dispatch to JS Audio Director | events + parameters | Events + States/Switches |
| Ducking (§10.2) | sidechain via `DynamicsCompressor` / scheduled gain | sidechain / ducking | auto-ducking / RTPC sidechain |
| Positional world noise (§6.1) | `PannerNode` (equal-power) + low-pass by distance | 3D events / spatializer | spatial audio + attenuation |
| Streaming beds vs in-memory SFX (§12) | `MediaElementSource` vs decoded buffers | streaming vs sample banks | streaming vs in-memory |

**Recommendation, not decision:** web-first (PRD) argues for a Web Audio implementation of
this model for the vertical slice, with the bus/param abstraction kept clean so a later native
client can swap in FMOD/Wwise without changing the engine contract (§13.1). Deferred to
ADR-0001.

## 14. Asset pipeline & naming

### 14.1 Naming convention

`CATEGORY_SUBJECT_VARIANT_STATE` — uppercase, underscore-delimited, matching the cue-sheet IDs.

```
Category prefixes:
  MUS_  music (theme stems)        AMB_  ambience beds
  ZOM_  zombies                    CBT_  combat / weapons
  PLR_  player body                INT_  interaction / exploration
  RAD_  radio                      WEA_  weather / environment
  SHL_  shelter                    UI_   interface / system
  SIG_  signature sounds
```

Examples: `MUS_DANGER_L3_RHYTHM`, `AMB_DOWNTOWN_NIGHT_RAIN`, `ZOM_SCREAMER_SHRIEK`,
`CBT_SHOTGUN_FIRE_INDOOR`, `PLR_HEARTBEAT_FEAR_HI`, `RAD_STATION_GO_DARK`,
`SHL_NIGHT_TONE_BED`, `SIG_FINAL_BROADCAST`.

### 14.2 Folder structure (under `assets/audio/`)

```
assets/audio/
├── music/      (theme stems, by theme & intensity)
├── ambience/   (region/time/weather beds)
├── sfx/
│   ├── zombies/  combat/  player/  interact/  weather/  shelter/
├── radio/      (broadcast VO, static/tuning, station signatures)
├── ui/
└── Zurvival_Audio_Cue_Sheet.xlsx   (the manifest of record — §14.3)
```

### 14.3 The cue sheet (companion `.xlsx`)

Every asset has one row: **ID · Category · Name · Trigger/Requirement · Layer/Bus ·
Loop/One-shot · Intensity/Priority · Positional? · Accessibility caption · Reference (GDD/§) ·
Status**. It is content-adjacent (GDD XV philosophy) — an audio designer works the sheet like
a content author works an encounter file. The sheet is the source of truth for *what exists*;
this doc is the source of truth for *why and how*.

## 15. Audio production roadmap

Mapped to GDD Part XIX. Audio is a **polish-phase discipline that is scaffolded early**: hooks
and the Audio Director exist from the vertical slice; the asset library grows with content.

1. **Foundation** — define the `Scene.ambience` payload (§13.1) and a stub Audio Director; no
   assets, silent but wired.
2. **Core survival (vertical slice)** — a *minimum expressive set*: one region bed × time ×
   rain, the noise system (§6.1), footsteps, heartbeat/fear, 2–3 zombie signatures (Rotter,
   Fresh, Screamer), one gun + one melee class, Survival/Danger themes at levels 0–3, basic
   UI. Proves audio sells tension on the slice.
3. **World simulation** — weather beds, horde bed, Director-driven music state machine full
   (§4.2), positional world noise.
4. **People & shelter** — shelter tone (day/night), companion vox, the radio network (§6.6),
   Loss/Hope/Home themes, first signature sounds.
5. **Content expansion** — remaining regions/zombies/radio; the full signature set; Dynamic
   Audio Memory (§8) wired to Living History.
6. **Polish & RC** — the full adaptive mix, loudness pass (§10.3), accessibility complete
   (§11), mobile perf pass (§12), mix profiles.

**Vertical-slice audio proof point:** with music off, the SFX + ambience + player layers alone
should make a scavenge feel tense and a Screamer feel like a disaster. If sound only works
*with* music, the informational layer isn't doing its job.

## 16. Design rules for audio

Carried and extended from GDD XVIII. These are the cut filter for every audio decision.

1. **Sound builds the world the text implies.** The prose names it; audio makes it a place.
2. **Audio is information — teach players to listen.** Every threat has a tell; direction and
   distance are readable; the player learns the language.
3. **Silence is a tool — use it on purpose.** Level-0 is a track. The return of sound is an
   event.
4. **Music is sparing, adaptive, and led by the Director.** It never loops over everything; it
   is told what to be by the simulation.
5. **Sound remembers — let key cues return with meaning.** Dynamic Audio Memory is canonical.
6. **Information beats mood in the mix.** When it's busy, the scream, the heartbeat, and the
   gunshot win (§10.2).
7. **Audio is never the only channel.** Everything meaningful has a caption or visual
   equivalent (§11).
8. **The mix is a readout of the simulation, not a playlist.** If it isn't driven by state,
   cut it.
9. **Audio is downstream of the deterministic core.** It reads Scene; it never changes the
   game.

## 17. Glossary

- **Audio Director** — the client module that turns each `Scene` into a mix; mirrors the sim
  Director (DESIGN §11) for sound.
- **Bed** — a looping ambient stack (region × time × weather × interior) that forms the floor
  of the mix.
- **Intensity ladder** — the 0–4 vertical-remix levels a music theme is authored in (§4.2).
- **Signature sound** — a fixed, reused cue that becomes an audio landmark (§7).
- **Dynamic Audio Memory** — the canonical system by which a cue bound to a formative event
  returns later with meaning (§8).
- **Cue sheet** — the companion `.xlsx` asset manifest; the source of truth for what audio
  exists (§14.3).
- **Level-0** — the state where music is silent; a deliberate, common, authored state.
