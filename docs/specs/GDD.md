# Zurvival Reborn — Game Design Document

**Version:** 2.0 (reimagining rewrite) · **Status:** Pre-production · **Owner:** Jharek

> A chat-driven zombie survival roguelite where every decision permanently changes the world.
>
> The zombies are the pressure. The people are the story. Your decisions are the game.

---

## About this rewrite

This document supersedes the earlier Zurvival Reborn GDD drafts (preserved in
`docs/reference/`). It keeps their systemic depth but reorganizes everything around **six
design principles** and promotes the ideas that earlier drafts filed under "Designer's Note"
or "New System — optional" into the **canonical core** of the game.

The mechanical skeleton comes from the original *Zurvival* Kik bot (see
`docs/reference/Zurvival Gameplay Outline.txt`): a turn-based loop of choose action →
resolve → advance time, with health, stamina, ammo, a connected map, and finite loot. That
skeleton is sound. What this rewrite changes is the *philosophy* around it:

> The player never moves "from scene to scene." They move through **a real place that reacts
> to everything they do.** The chat interface is only how that world speaks back.

---

## Contents

- **Part I — Foundation & Vision**
- **Part II — The Six Principles** (the spine of the game)
- **Part III — The Core Loop & Scenes**
- **Part IV — World Simulation Engine**
- **Part V — Player Systems**
- **Part VI — Injuries, Infection, Health & Mind**
- **Part VII — Exploration, Map & Travel**
- **Part VIII — Encounters & Events**
- **Part IX — Combat, Stealth & Zombie AI**
- **Part X — Inventory, Crafting, Loot & Economy**
- **Part XI — Shelter & Community**
- **Part XII — Survivors, NPCs & Factions**
- **Part XIII — Story, Radio & Endings**
- **Part XIV — Technical Architecture**
- **Part XV — Content Bible**
- **Part XVI — Balancing, Progression & Difficulty**
- **Part XVII — UI, UX & Presentation**
- **Part XVIII — Audio & Atmosphere**
- **Part XIX — Production Roadmap**
- **The Zurvival Manifesto**

---

# Part I — Foundation & Vision

## Elevator pitch

Civilization has collapsed. You are not a hero, a chosen one, or a soldier — just one more
person trying to live another hour. You play entirely through a messaging interface, making
one decision at a time as an evolving simulation of survivors, zombies, weather, infection,
and a dying city reacts to every move. The story is not written in advance. It emerges from
the systems. Every run is a different survival novel, authored by your choices.

Some runs end in rescue. Some end in sacrifice. Most end in a choice you'll remember.

## Genre

- **Primary:** Chat-driven survival roguelite.
- **Secondary:** Systemic interactive fiction · survival RPG · resource management ·
  narrative simulation · procedural adventure.

## Platform

- **Primary:** Web browser (mobile-first responsive).
- **Secondary / later:** installable mobile app, desktop, Steam, and a Discord/Telegram bot.

The engine is a headless simulation; a platform is just a client that renders text and sends
choices. That keeps the door open to a chat-bot version without redesigning the game.

## Session and run length

- **Play session:** 10–30 minutes. It must be safe to stop after almost any turn.
- **Full run:** 2–6 hours; a successful run averages ~4 hours.

## Target audience

Players who love *A Dark Room*, *Reigns*, *Lifeline*, *NEO Scavenger*, *Project Zomboid*,
*60 Seconds!*, *This War of Mine*, *The Walking Dead* (Telltale), and choice-driven RPGs and
survival sims generally.

## Core fantasy

The player should always feel **"I'm barely surviving"** — never **"I'm winning."** The
game is about surviving another hour, not becoming a superhero. Strength comes from better
decisions, better equipment, better planning, and better allies, not from grinding stats.

## Emotional goals

Every decision should produce at least one of: tension, hope, regret, relief, curiosity,
panic, loss, attachment, dread, triumph. **If a decision creates no emotion, it probably
shouldn't exist.**

### The Golden Rule

**Every decision must matter.** No choice exists purely for flavor. Every option changes at
least one thing — resources, relationships, infection, time, story, location, noise,
shelter, or reputation. The player should never feel like they clicked "Continue." They
should feel like they made a decision.

## What Zurvival is NOT

It is not a visual novel, a dialogue simulator, a branching-novel CYOA, a puzzle game, an
exposition-heavy RPG, a linear campaign, or a zombie shooter. It is **a simulation presented
through conversation.**

## Success criteria

The design succeeds when players finish a run and tell a story like this:

> "I broke into the police station because I needed ammo. The gunfire pulled a horde that
> wiped out the grocery district two days later. I barely escaped with a mechanic I'd
> rescued earlier. We survived long enough to build a safehouse — but he died defending it
> while I was out looking for antibiotics."

The design **fails** when players instead say: *"I picked option 2 and got ending B."*

---

# Part II — The Six Principles

Everything in this document serves six principles. They are the difference between a
nostalgic bot remake and a survival game people remember for years. Every system, every
piece of content, and every UI decision should be traceable to at least one of them.

## Principle 1 — A systemic core loop

The original bot ran a scripted loop: choose an action, a writer's pre-authored result
plays, time advances, repeat. Zurvival Reborn replaces the writer with a simulation.

The game never asks *"what scene comes next?"* It asks *"given everything that has happened,
what would this person realistically experience now?"* The World Simulation Engine reads the
current state — noise, infection, weather, time of day, zombie density, who else is nearby,
what's already been looted — and produces a **systemic snapshot**: the scene the player
walks into. The same action in the same place can produce twenty different outcomes.

The loop is also shaped emotionally. Instead of *action → result → next action*, each beat
follows a **cycle of tension**:

> **Tension → Success → Relief → New Problem**

A successful scavenge is not the end of the turn. Finding a case of canned food is a relief
that immediately becomes a new problem: now a hungry companion knows you have it, the weight
slows your travel, and the noise you made getting it is drawing something closer. Success
always plants the next tension. (See Part III.)

## Principle 2 — Injuries are stories

Damage is never a generic "−10 HP." Every wound is a specific, narrative condition that
changes how the player lives, and that the world remembers.

- A zombie lunge doesn't cost health; it gives you a **sprained ankle** (you travel slower,
  cost more stamina) or a **deep cut** (you bleed, and the scent trail draws zombies toward
  your route for hours).
- **Infection is identity, not a death timer.** It advances through stages — asymptomatic,
  symptomatic, and beyond — quietly changing the player's perception, the dialogue options
  available to them, and the symptoms other survivors can see.
- **The mind is a wound too.** Stress and morale govern how the player and companions react
  to darkness, isolation, and the death of a friend.

Every scar is remembered. An NPC who watched you take a bite for them will bring it up days
later. Your body becomes a record of the run. (See Part VI.)

## Principle 3 — Nodes with memory

The map is not a set of interchangeable rooms. It is a **living world** made of places that
remember.

- **Local area memory.** If you smash a pharmacy window on Day 2, the glass is still on the
  floor on Day 5, the shelves are still empty, the noise still marked the block, and a
  scavenger may have moved into the building you left open.
- **Regional evolution.** The city is divided into regions (Residential, Downtown,
  Industrial, Hospital District, and so on), each with its own independent **threat level**
  that rises and falls with the player's noise and with zombie migration — whether or not
  the player is there.
- **The map is a journal.** Players leave their own handwritten notes on nodes — "safehouse
  here," "lost Marcus to a horde," "gun store, came back empty." The map becomes an archive
  of a personal journey, not just a navigation tool. (See Part VII.)

## Principle 4 — The Survival Triangle

Every meaningful choice is a trade between three corners:

> **Safety · Resources · Time**

You cannot optimize all three. Rushing a search (buying **Time** and **Resources**) spikes
**Noise** and sacrifices **Safety**. Moving carefully and quietly (buying **Safety**) costs
**Time** you may not have while an infection advances or night falls. The triangle is the
lens every system is balanced through, and it is what keeps decisions honest. (See Part XVI.)

Between the big trades, the game constantly offers small, low-cost **micro-choices** —
"leave the flashlight on?", "close the door behind you?", "call out, or stay silent?" — that
cost almost nothing but keep the world tactile and the player present in it. (See Part III.)

## Principle 5 — Handcrafted social simulation

The original was a *chatbot*. Its heart was people. Zurvival Reborn keeps that heart by
rejecting generic, procedurally-named spawns in favor of a **handcrafted cast**.

- A curated pool of roughly **60–100 named survivors** — Sarah the paramedic, Marcus the
  reluctant mechanic — each with a specific background, personality, and a secret.
- **Survivors tell, they don't quest-give.** Instead of "fetch me five bandages," a survivor
  shares a memory: *"My dad always kept spare batteries in the freezer."* That's not flavor
  — it's a real hint toward loot the player can act on.
- **Social reactivity.** NPCs build relationships with each other, not only with the player.
  Friendships and rivalries form inside the shelter and change its morale, independent of
  what the player does. (See Part XII.)

## Principle 6 — Artifacts over XP

There are no experience points and no character levels. Progression comes from
**infrastructure and preparation**.

- Finding a firefighter's axe, repairing a radio, or fortifying a door is a more meaningful
  "level up" than "+1 Strength."
- **Items carry their history.** A flashlight isn't a stat block — it's *"Sarah's
  flashlight," found in the hospital, repaired twice.* Loot becomes personal artifacts with
  provenance, and losing one hurts. (See Part V.)

### How to use these principles

When evaluating any feature, location, item, or line of writing, ask: *which principle does
this serve, and how?* If the honest answer is "none," cut it. If a proposed system fights a
principle — for example, an XP bar, or a random unnamed NPC, or a scene that ignores the
world state — it does not belong in Zurvival Reborn.

---

# Part III — The Core Loop & Scenes

## The loop

Every turn runs the same structure. Note what is missing: there is no `choice → next scene`
edge. Choices modify the simulation; the simulation produces the next scene.

```
World simulation advances
        ↓
Generate the situation (a systemic snapshot of the current state)
        ↓
Present the scene
        ↓
Player makes a decision
        ↓
Resolve against the systems
        ↓
Apply consequences (permanently)
        ↓
Update the world
        ↓
Generate the next situation
```

At a higher level the player cycles between two modes that form the heartbeat of the game —
**explore, recover, prepare, repeat**:

- **Exploration:** travel → scavenge → fight → meet survivors → discover story → collect
  resources → risk infection → return home.
- **Shelter:** heal → craft → repair → talk → upgrade → assign jobs → sleep → begin the next
  day.

## The cycle of tension

Within that loop, pacing follows **Tension → Success → Relief → New Problem**. Design each
beat so that resolving one pressure opens the next, without the player feeling railroaded:

| Beat | Example |
| --- | --- |
| Tension | The pharmacy is picked clean except for the locked controlled-substances cabinet. |
| Success | You pry it open — antibiotics, three doses. |
| Relief | Enough to treat an infection. For a moment you're ahead. |
| New Problem | The pry bar's noise woke the block, and back home two people need those three doses. |

## The Four Questions

Every scene must answer four questions, or it isn't finished:

1. **Where am I?** — a concrete place (apartment, hospital, subway, bridge, farm).
2. **What is happening?** — something specific and present (a knock, a fire upstairs, a radio
   crackle, rain starting, a zombie at the door).
3. **What can I do?** — meaningful choices only; never a fake choice that leads to the same
   result.
4. **What changed?** — every action updates the world, visibly or invisibly, but always
   something.

## The Rule of Consequences

Every player action permanently affects at least one system. A few worked examples:

- **Fire a gun** → noise spikes → a nearby horde shifts toward you → future encounters in
  this region get harder.
- **Save a stranger** → their trust rises → your food drops feeding them → a future companion
  unlocks.
- **Burn a building** → its loot is gone for good → a zombie nest is destroyed → the smoke
  draws a military patrol.

The world remembers. Always.

## Anatomy of a scene

Internally, every scene is built from seven parts. The player sees only the middle three.

1. **Context** — the state that produced it (location, time, weather, threats, actors).
2. **Description** — the prose the player reads.
3. **Choices** — the actions offered, each with real costs.
4. **Hidden evaluation** — the systemic roll behind the choice (loot, detection, injury).
5. **Consequences** — what changes as a result.
6. **World updates** — those changes written back into the simulation.
7. **Memory** — anything worth remembering recorded to local/world history.

## Scene categories

Exploration, Combat, Social, Shelter, Story, and Dynamic (director-injected). Scenes are
generated from the world state and tagged (e.g. `night`, `rain`, `low-supplies`,
`infected`, `companion-present`) so the engine can weight, filter, and avoid repeating them.

## Micro-choices

Between consequential decisions, sprinkle small, cheap choices that cost little but keep the
world tactile: *leave the flashlight on? close the door behind you? answer the radio? take
the long way?* They rarely swing a run on their own, but they compound — the open door you
didn't close is how the scavenger got in — and they keep the player inhabiting the space
rather than clicking through it.

## The narrator

The narrator is close, second-person, and sparing. It describes what the player senses and
never editorializes an emotion the player should feel on their own. It never says "this is a
sad moment." It shows the empty crib and lets the player supply the feeling. Prose is lean:
most scenes are two to five short paragraphs, front-loading the concrete detail that matters
for the decision.

## The Golden Scene Test

A scene is good if, described to a friend, it sounds like something that *happened* rather
than something you *read*. "The shelves were bare, so I checked the manager's office and
found a handgun taped under the desk — then heard the front door" passes. "I clicked search
and got a handgun" fails.

---

# Part IV — World Simulation Engine

The World Simulation Engine is the heart of the game. Combat, scavenging, NPCs, story, and
encounters are all just windows into it. The player never sees the simulation directly; they
experience it as scenes. The simulation is always running — even while the player is reading.

## Six layers of simulation

The world is modeled as six interconnected layers. Any turn can modify one or more.

```
Player  →  Companions  →  Local Area  →  Region  →  Global Apocalypse  →  Story
```

**Layer 1 — Player state.** The player is part of the world, not above it: health, hunger,
thirst, fatigue, infection, stress, morale, inventory, equipment, skills, traits, location,
shelter, reputation, active quests.

**Layer 2 — Companion state.** Every companion is fully simulated — health, injuries,
infection, needs, morale, trust, loyalty, fear, gear, job, personality, relationships,
location, alive/dead — and keeps existing when they're not with the player.

**Layer 3 — Local area state.** Every location remembers: loot remaining, doors/windows
broken, alarms tripped, fire damage, zombie population, corpses, blood, barricades, traps,
who's present, last visit, story discoveries, and search percentage. Nothing resets during a
run.

**Layer 4 — Regional state.** Each region tracks zombie density, loot availability, survivor
activity, noise, threat level, power, water, fire, weather effects, military presence, road
conditions, and story events — and evolves independently. Downtown can sit at 95% zombie
density while a Residential block nobody has touched holds 80% of its medical supplies.

**Layer 5 — Global apocalypse.** The world-wide state moves on its own: day, hour, weather,
season, power grid, military status, broadcast network, infection spread, global threat,
known safe zones, bridge failures, supply availability, refugee population, zombie evolution.
When the grid collapses on Day 18, every electricity-dependent location changes at once —
electronic locks fail, hospitals go dark, food spoils faster, nights get darker.

**Layer 6 — Story state.** The narrative is simulated too. Instead of chapters, story
advances through world conditions: main-story progress, discovered lore, radio messages
heard, major characters met, faction reputation, critical decisions, ending flags, and world
mysteries.

## Time

Time advances every turn, and every action has a time cost — search a desk (5 min), search a
house (25 min), fight (8 min), travel across downtown (40 min), sleep (8 hr). Time changes
zombie movement, NPC schedules, weather, darkness, loot competition, broadcasts, story
triggers, safe routes, noise decay, and fuel.

**Day and night** runs in phases — dawn, morning, afternoon, evening, night, late night —
each shifting the odds. Afternoon is the best time to scavenge and travel; night is the most
dangerous but the most rewarding and the most atmospheric; late night is nearly suicidal
outside and carries the highest infection risk and the best horror.

## Weather

Weather is a mechanic, not a backdrop. Clear, cloudy, rain, storm, fog, snow, heat wave,
cold snap, and wind each touch multiple systems. Rain quiets footsteps, cuts visibility,
hides tracks, and threatens electronics; fog helps stealth but hurts navigation; storms hide
noise but block roads and knock out power; snow slows movement, shows tracks, and brings cold
injuries.

## Noise

Noise is one of the most important currencies in the game. Every action makes sound —
walking (2), running (5), breaking a door (8), pistol (12), shotgun (20), explosion (40) —
and noise reaches nearby zombies, survivors, and rival groups, opening some encounters and
closing others. Noise fades over time unless something refreshes it. Noise is the single
biggest way the player spends the "Safety" corner of the Survival Triangle.

## Zombies, hordes, and migration

Zombies are not random spawns; they are a **population** that lives in regions and tracks
aggression, movement, special types, migration routes, and awareness. Kill fifty in Downtown
and those fifty are gone until migration replaces them. **Hordes** are moving entities with a
size, direction, speed, destination, awareness, and noise-attraction; when a gunshot goes
off, nearby hordes *evaluate* whether to investigate — sometimes they redirect, sometimes
they ignore it.

## Loot economy

Loot is finite. Taking food removes it from the world. If another survivor reaches a place
first, you may find nothing. Resources grow scarcer as the run goes on, which raises tension
without the designer touching a dial. (Detailed in Part X.)

## Infrastructure decay

Civilization dies slowly and visibly: gas stations empty, water pressure drops, hospitals
lose power, roads block, generators fail, cell towers collapse, bridges turn unsafe. Each
change unlocks some encounters and removes others.

## Survivor simulation

The player is not the only group in the city. Other survivor groups each track a leader,
population, food, weapons, morale, shelter, health, goals, region, and relationships — and
they move, fight, trade, collapse, recruit, raid, and disappear, sometimes because of the
player and sometimes despite them. (Detailed in Part XII.)

## World memory

Nothing important is forgotten. Burned buildings, NPC deaths, destroyed bridges, opened
safes, killed bosses, saved children, military rescues, and major broadcasts all become
permanent world history the game can reference later. (See "Living History," Part XIII.)

## The simulation pipeline

Every turn resolves in the same fixed internal order. This never changes — it guarantees
consistent, predictable behavior while still allowing emergent outcomes:

```
Player action → Advance time → Update player → Update companions →
Update current location → Update region → Update global world →
Move hordes → Move survivor groups → Update director →
Resolve random events → Evaluate story triggers → Generate next scene
```

## The Apocalypse Director

Sitting above the simulation is a **director** — an invisible pacing system that watches the
run and gently shapes it toward good drama without breaking the world's logic. It tracks
recent tension, time since the last real threat, resource desperation, emotional highs and
lows, and repetition, then biases (never forces) what the simulation offers next: a quiet
stretch after a brutal fight, a lucky find when the player is one bad turn from collapse, a
callback to a character they'd written off. The director tunes probabilities; the world still
decides. (Its balancing role is detailed in Part XVI.)

## Design rules for the engine

1. **The world never pauses.** Time always advances.
2. **The world remembers.** Permanent actions have permanent consequences.
3. **Resources are finite.** Scarcity drives decisions.
4. **Nothing happens because it's "the next chapter."** Major events fire when world
   conditions allow them.
5. **Systems create stories.** Writers supply ingredients; the simulation creates the
   memorable moments.

## Future expansion hooks

The engine is built so content can be added without rewriting the core: multi-year seasonal
cycles, animal ecosystems, cross-community epidemics, vehicles and modification, faction
territory wars, procedural outlying towns, wider radio networks, merchant caravans, and
region-reshaping disasters. If the simulation is strong, these are additions, not rewrites.

---

# Part V — Player Systems

The player is not a hero, a chosen one, or a super-soldier. They are one more person trying
to survive, who grows stronger through better decisions, equipment, planning, and allies —
**not** by leveling into a zombie-killing machine. Power comes from preparation, not
experience points. This is one of the load-bearing philosophies of the game (Principle 6).

## The player state

Each run maintains a living character sheet: identity, physical condition, mental condition,
equipment, inventory, skills, relationships, story progress, and world reputation.

## Identity is earned, not selected

The player starts as an ordinary survivor — no backstory, no class, no special ability. Their
identity is written by what they do. By Day 20 a player thinks *"I'm the one who always helps
strangers"* or *"I'm the one who burns every infected building,"* because that's how they've
played, not because they picked it at a menu.

### Optional starting backgrounds (unlockable)

Backgrounds are small starting *stories*, never mandatory classes, unlocked through play:

| Background | Edge |
| --- | --- |
| EMT | +1 bandage, faster healing, better medical checks |
| Police Officer | starts with a baton, better firearm handling, recognizes police locations |
| Mechanic | repairs more efficiently, vehicle knowledge, extra scrap at start |
| Hunter | better stealth and tracking, improved food gathering |
| Teacher | improves companion morale, better communication events, faster trust |
| Construction Worker | better barricades, cheaper building stamina, strong melee |

## Core stats

The UI stays clean — the player should never manage twenty bars. Only a handful of critical
stats are ever on screen.

- **Health** — physical survival; 0 = death. Lost to attacks, falls, gunshots, and untreated
  wounds. It does not silently regenerate; it is *treated* (Part VI).
- **Hunger** and **Thirst** — climb constantly; ignore them and they bleed into health,
  stamina, and morale.
- **Fatigue** — rises with exertion and time awake; high fatigue hurts awareness, accuracy,
  and stress.

Three more stats are tracked constantly but shown only through their symptoms, never as a
bar:

- **Infection** — the defining hidden stat; revealed through symptoms, not a number
  (Part VI).
- **Stress** and **Morale** — the mind; surfaced through dialogue, dreams, and behavior
  (Part VI).

### Derived stats

Carry weight, stealth, awareness, and noise output are computed from gear, condition, and
action — the player influences them through choices rather than editing them directly.

## Skills and traits

**Skills** improve narrowly through use — a player who searches a lot gets better at
searching — but never turn the player into a combat god. **Traits** are qualitative flavor
earned or acquired in play (Steady Hands, Light Sleeper, Weak Stomach, Haunted), each opening
or closing specific options rather than adding numbers.

## Inventory, equipment, and artifacts

Inventory is limited by weight and slots and organized by category (weapons, ammo, medical,
food, water, materials, components, story items). Equipment defines what the player can
actually do — the firefighter's axe, the repaired radio, the good backpack — and this is
where growth lives (Principle 6).

Crucially, **items carry history**. An item is not just a stat block; it can be an
**artifact** with provenance: *"Sarah's flashlight — found in the hospital, repaired twice."*
The engine attaches metadata (where found, who owned it, what it's survived) to significant
items, so loot becomes personal and losing it lands emotionally. A dead companion's weapon,
picked up off the floor, is not the same as an identical one from a shop.

## Durability

Weapons and tools wear out and can break, jam, or degrade. Repair depends on materials,
skill, and the right shelter room. Durability is a quiet, constant pressure that keeps even a
great weapon from being a permanent solution.

## Injuries and death

Injuries are specific narrative conditions, not chip damage — this is important enough to get
its own section (Part VI). **Death** ends the run and produces a run summary: days survived,
people saved and lost, distance traveled, the story of how it ended. Death should feel earned
and legible — the player should be able to name the decision that killed them.

## Progression

- **Run progression** comes from artifacts, shelter upgrades, relationships, and map
  knowledge — the things you build and prepare within a single run.
- **Legacy progression** persists between runs in a restrained way: unlocked backgrounds, new
  starting locations, cosmetic/lore unlocks, and codex entries. Legacy never makes the player
  mechanically stronger at survival; it broadens *how* they can start, not how powerful they
  are.

### Canonical: no traditional XP levels

There is no XP bar and no character level, ever. Attempts to add one should be rejected. An
XP curve trains players to grind and to feel powerful; both fight the core fantasy. Growth is
a better axe, a repaired truck, a fortified door, and a friend who trusts you — measured in
preparation, not points.

---

# Part VI — Injuries, Infection, Health & Mind

This section makes Principle 2 concrete: **injuries are stories.** The goal is for the
player's body and mind to become a record of the run — a set of conditions with names,
causes, consequences, and witnesses.

## Wounds are specific conditions

A hit never reads as "−10 HP." It produces a named wound with its own gameplay tail:

| Wound | What it does to the run |
| --- | --- |
| Sprained ankle | Slower travel, higher stamina cost, some routes become bad ideas. |
| Deep cut | Bleeding; leaves a **scent trail** that draws zombies along your path for hours. |
| Fracture | A limb becomes near-useless — no two-handed weapons, or no running — until set and healed. |
| Burn | Ongoing pain (stress, fatigue) and infection risk; slow to heal. |
| Concussion | Unreliable awareness and blurred, degraded scene information. |
| Illness | Fever, weakness, contagion risk to companions in the shelter. |

Each wound has a **severity** (minor, serious, critical) that scales its effects and its
treatment. **Bleeding** ticks over time and must be stopped with bandages or a tourniquet
before it drains health or paints a trail. Wounds can worsen if ignored — an untreated cut
becomes an infection risk of the ordinary kind, and any of it can compound with the bite
infection below.

**Scars are remembered.** A serious wound can leave a permanent mark, and NPCs reference it:
the survivor you shielded from a bite remembers the scar on your arm; a rival reads your limp
as weakness. The body is social.

## The infection system

Infection is the spine of the health model and the clearest expression of Principle 2:
**infection is identity, not a countdown.**

**Sources.** Bites are the obvious one, but not the only one — deep wounds in filth, exposure
to infected blood, tainted water, and eating spoiled food all carry risk. A bite is
dangerous and frightening but not automatically a death sentence; it's the start of a story.

**Staged progression.** Infection advances through stages the player learns to read:

1. **Asymptomatic** — no visible sign; the clock is hidden and running.
2. **Symptomatic** — fever, sweats, tremor; perception starts to distort and some dialogue
   options change.
3. **Advanced** — hallucinations, memory gaps, and a body that's failing; companions grow
   afraid.
4. **Terminal** — the final turn, and a choice about how it ends.

**Hidden progression.** There is no infection bar. Stage is revealed only through symptoms.
The player pieces together how bad it is from how the world looks and how they feel, which is
far more frightening than a number.

**How infection changes the player.** As it advances it alters *perception* (scene text grows
unreliable; threats and sounds may not be real), opens or closes *dialogue* (feverish,
desperate, or cruel options appear; calm ones vanish), and produces visible *symptoms* others
react to. Late stages bring **hallucinations** (scenes that didn't happen, people who aren't
there) and **memory gaps** (turns the narrator can't fully account for).

**Diagnosis, treatment, and quarantine.** A player with medical skill, a companion EMT, or
the right supplies can *diagnose* a stage and act on it. Treatment (antibiotics, rest, clean
conditions, amputation as a last resort for a fresh bite) can halt or reverse early stages;
the deeper it goes, the costlier and less certain the cure. Shelters can **quarantine** the
infected, which protects the community but isolates the sufferer and strains trust.

**No "Game Over" for infection.** Reaching a bad stage is not an instant loss screen. It's a
new and harder way to keep playing — a race for a cure, a set of failing senses to survive
in spite of, and a set of relationships that now treat you differently. Infection should
generate some of the run's best stories precisely because it doesn't just end them.

## Psychological survival

The mind is a survival system with the same weight as the body.

- **Stress** rises with danger, gore, sleeplessness, and loss, and degrades accuracy,
  awareness, and decision options.
- **Fear** is acute and situational — the dark, a horde, a scream nearby — and can tip into
  **panic** in combat (Part IX).
- **Hope** and **Morale** are the counterweights: a rescue, a warm meal, a working radio, a
  child kept safe. Without them, stress wins.
- **Depression** and **Trauma** are longer shadows cast by specific events (watching a friend
  die, abandoning someone), surfacing in behavior and dialogue rather than as a debuff bar.
- **Dreams** during sleep replay the run's memories — comfort or nightmare depending on what
  the player has done and lost — and are a primary channel for the game's quiet horror.

### The Humanity system

A hidden **humanity** value tracks the moral shape of the run — not good vs. evil, but how
much of themselves the player is keeping. Killing survivors for their supplies, abandoning
the desperate, and lying to companions erode it; protecting people, keeping promises, and
burying the dead preserve it. Humanity gates certain endings, certain companions' willingness
to stay, and how the world's story remembers the player. It is never shown as a bar; it is
felt.

## Recovery, and dying anyway

Health is restored by treatment and rest, not by walking it off. The mind recovers with
safety, routine, and connection. Some runs still end in **death by infection** — and when
they do, the game gives it weight: a final lucid scene, a chance to say something, a mark left
on the world and on the survivors who outlive the player.

## Design rules for health and mind

1. Damage is never abstract; it is a condition with a name and a consequence.
2. Infection is a story engine, not a timer — hide the number, show the symptoms.
3. The mind can break as surely as the body, and must be tended.
4. Every serious injury should be something the player can point to and explain.
5. Nothing here should feel like a lose-screen; it should feel like a harder way to live.

---

# Part VII — Exploration, Map & Travel

This section makes Principle 3 concrete: the map is a **living world of nodes with memory,**
not a set of interchangeable rooms.

## The map

The world is a graph of **locations (nodes)** grouped into **regions**, connected by
**routes**. The player sees it through **fog of war** — you know what you've visited and what
you've been told about; everything else is rumor and blank space. Discovery is a reward in
itself.

**Regions** are the large zones — Residential, Downtown, Industrial, Hospital District,
University, Military Zone, Riverfront, Farmland, Forest, Highway — each with its own
character, loot profile, danger, and story. **Locations** are the specific places inside them:
a named pharmacy, a fire station, a school, a subway platform.

## Node-based travel

Travel happens node to node along routes, not by free-roaming a coordinate map. Nodes make
the world legible on a phone screen, make each place a deliberate destination, and let every
location carry rich state cheaply. Moving costs **time**, **stamina**, and **noise**, and can
trigger a **travel event** on the way (an ambush, a stranger, a blocked road, a lucky find).

**Routes have conditions.** A road can be clear, congested with wrecks, flooded, on fire,
horde-occupied, or collapsed, and those conditions change with weather, infrastructure decay,
and the player's own actions. Blowing a bridge removes a route for everyone, permanently.
**Dynamic route discovery** lets players find shortcuts, service tunnels, and back alleys
that reshape how a region is traversed.

**Landmarks** anchor navigation and memory — the hospital tower, the stadium, the overpass —
and double as story beacons visible from far off.

## Local area memory (canonical)

Every node remembers what the player did to it, for the whole run. Smash a window on Day 2
and on Day 5 the glass is still there, the shelves you emptied are still empty, the alarm you
tripped still marked the block, and the door you left open let something — a scavenger, a
nest of zombies, weather damage — move in. Search percentage, corpses, blood, barricades, and
traps all persist. Returning to a place you've been is never a fresh scene; it's a reunion
with the consequences you left behind.

## Regional evolution and threat levels (canonical)

Each region carries an independent **threat level** that rises and falls on its own. Player
noise raises it; a horde migrating through raises it; time and dispersal lower it. Regions
evolve whether or not the player is present — a quiet suburb can become a death trap over
three days because a horde you stirred up downtown drifted into it. The player learns to read
the city as a set of pressures, not a static board.

## The map as a journal (canonical)

The map is the player's **journal**. They can pin their own handwritten notes to nodes —
*"safehouse,"* *"gun store, came back empty,"* *"lost Marcus here,"* *"good water"* — and the
game auto-annotates significant history (a boss killed, a survivor met, a bridge dropped).
Over a run the map fills with a personal archive of where the player has been and what it cost
them. By the end, the map *is* the story.

## Safehouses and claiming

Certain defensible nodes can be **claimed** as safehouses and, eventually, developed into the
home shelter (Part XI). Claiming costs effort and materials and marks the node on the map as
yours; it can also be lost — overrun, burned, or taken by another group while you're away.

## Vehicles and fast travel

**Vehicles** (a bicycle, a repaired truck, a fuel-hungry van) change the travel economy —
faster routes, more carry weight, more noise, and the need for fuel and repair. **Fast
travel** exists only between known, safe nodes and still costs time and can still be
interrupted; it is a convenience, never an escape from the simulation.

## The living map

Taken together, exploration is not "pick the next location." It's reading a city that is
changing under you — deciding whether the antibiotics across town are worth the two hours,
the noise, and the region that's been getting worse since you were last there.

## Design rules for the map

1. Every node remembers; nothing resets during a run.
2. Regions live on their own clock, independent of the player.
3. Travel always costs something and can always be interrupted.
4. Discovery is a reward; fog of war is protected.
5. The map records the player's story, in their own words where possible.

---

# Part VIII — Encounters & Events

An **encounter** is a situation the simulation surfaces for the player to respond to. Where
Part IV decides *what the world is doing*, the encounter system decides *which slice of it
becomes this turn's scene*. Encounters are the content layer through which the simulation
speaks.

## Philosophy

Encounters are selected by fit, not by script. The engine looks at the full state — location,
time, weather, threat, infection, companions, recent history — and chooses an encounter whose
conditions match, then lets the systems resolve it. The same encounter template produces
different outcomes because the state feeding it differs every time.

## The pipeline

```
Read world state → Filter the encounter pool by conditions & tags →
Weight the survivors by fit, novelty (cooldowns), and director bias →
Select → Resolve against systems → Apply consequences → Record to memory
```

Encounters are drawn from a large tagged **pool**. **Weighting** favors encounters that fit
the moment and haven't been seen recently; a **cooldown** system suppresses anything used
lately so the world doesn't repeat itself. **Chains** let one encounter set flags that make a
follow-up encounter possible later (the stranger you helped resurfaces), and **multi-stage**
encounters run as short sequences (a negotiation that turns into a fight that turns into a
chase).

## Categories

Exploration, Combat, Social, Environmental, Story, Psychological, and Shelter. A healthy turn
mix keeps any one category from dominating; the director watches for fatigue.

- **Survivor encounters** — the game's soul (Part XII): strangers to help, rob, recruit,
  fear, or bury.
- **Zombie encounters** — pressure in many shapes (Part IX), from a single wanderer to a
  wall of the dead.
- **Moral encounters** — no clean answer; the interesting cost is always on the table (the
  Survival Triangle made personal). These feed the Humanity system.
- **False encounters** — the knock that's just the wind, the "survivor" who's already dead.
  Tension without payoff is a legitimate and necessary tool.
- **Environmental storytelling** — a locked nursery, a barricaded door with scratch marks
  inside, a note half-burned in a grate. The world tells stories without a narrator.

## Reactive event types

Layered on top are events driven directly by state: **companion events** (a friend's need,
grief, or breaking point), **infection events** (symptoms, a companion's diagnosis, a
quarantine decision), **time-based events** (dawn dispersal, a scheduled broadcast),
**weather events** (a storm floods your route home), and **region-evolution events** (a
region tips into a new threat tier and announces itself).

## Rare and legendary encounters

**Rare** encounters reward exploration and risk with something unusual. **Legendary**
encounters are the once-a-run, talked-about-later set pieces — a downed helicopter, a
survivor broadcasting a cure, a horde the size of a district — gated behind world conditions
so they land as events, not as scheduled content. **Dynamic event injection** lets the
director place a needed beat (relief, threat, a callback) when the run's pacing calls for it.

## Encounter evolution

The same place yields different encounters as the run changes it — the clearest proof that
the world reacts:

- **Before:** a quiet fire station, engines still in the bay, a few wanderers outside.
- **During:** you're inside when the noise you made draws a pack; now it's a running fight.
- **After:** days later it's a picked-over, blood-marked shell with a scavenger squatting in
  the loft — and a note you didn't leave.

## The Golden Encounter Formula

A strong encounter delivers: a clear situation, at least one real decision, a Survival
Triangle trade, a consequence that persists, and something the player could remember and
retell. If an encounter has no decision or leaves no trace, it's filler — cut it.

## Density and content goals

Aim for a steady rhythm rather than constant intensity: meaningful decisions most turns,
genuine danger in a minority of them, and quiet on purpose sometimes. The launch target is a
deep enough pool that a full run rarely repeats an encounter verbatim, with the tag/condition
system stretching that pool much further through recombination with state.

---

# Part IX — Combat, Stealth & Zombie AI

## Goals and philosophy

Combat is a **last resort**, not a core verb. It should feel dangerous, costly, and loud —
something the player usually tries to *avoid*. Winning a fight is rarely "free": it spends
stamina, durability, ammo, noise, and often blood. The best players fight least. This keeps
the core fantasy ("barely surviving") intact and makes stealth and avoidance genuinely
attractive rather than a lesser option.

## Types of combat

- **Planned** — you choose the fight on your terms (clearing a known nest with prep).
- **Defensive** — something comes to you (a night attack on the shelter, Part XI).
- **Desperation** — cornered, low, improvising; the scariest and most memorable.
- **Companion** — allies fight alongside you with their own AI, morale, and fear (Part XII).
- **Horde** — you cannot win by trading blows; you win by routing, funneling, or fleeing.

## Combat resolution and player actions

Combat resolves per exchange against the systems (weapon, skill, condition, position, noise),
not as a twitch minigame. On a given exchange the player can **attack**, **heavy attack**
(more damage, more stamina and noise, higher miss risk), **aim carefully** (spend time for a
better shot), **push** (create space), **retreat**, or **hide**. **Improvised actions** —
kick the shelf onto them, slam the car door, lure them past the gas leak — are always
encouraged and often better than a straight fight.

## Weapons

Weapons are tools with trade-offs, not power tiers:

- **Improvised** (pipe, brick, chair leg) — everywhere, fragile, weak, silent-ish.
- **Bladed** (knife, machete, axe) — reliable, silent, wears and needs stamina.
- **Blunt** (bat, crowbar, hammer) — forgiving, durable, tiring, some noise.
- **Firearms** (pistol, shotgun, rifle) — powerful and safe-feeling, but **loud** — every
  shot is a broadcast to the region and a bill the Survival Triangle collects later.
- **Explosives** — rare, decisive, indiscriminate, extremely loud.

Each weapon defines damage, accuracy, resource cost (stamina or **ammunition**), and
**durability** (weapons wear, jam, and break; Part V). Ammo is a scarce, caliber-specific
resource, not a bar.

## Stealth and detection

Stealth is the preferred path and a full system. Zombies (and people) detect the player
through **sound**, **light**, and **line of sight**, modulated by weather, darkness, and the
player's noise output. Moving slow, staying dark, breaking line of sight, and using rain or
fog to mask movement are all viable strategies. Getting *out* of a fight cleanly is often the
real win.

## Zombie behavior

Zombies are simulated agents with **states** — dormant, wandering, investigating, chasing,
feeding, hibernating — that they transition between based on **senses** (hearing, sight,
smell — including the scent trail from a bleeding player, Part VI). They are individually
simple and collectively dangerous.

### Zombie types

- **Fresh** — fast, recently turned.
- **Rotter** — slow, common, decaying.
- **Crawler** — dragged themselves along; low, easy to miss, grabs ankles.
- **Bloated** — bursts into an infectious cloud; a bad thing to shoot up close.
- **Riot Officer / Soldier** — armored, hard to put down without the right approach.
- **Screamer** — harmless alone, but its shriek calls the region down on you.
- **Stalker** — smarter, patient, hunts the player specifically at night.

**Hordes** are emergent masses (Part IV) that move, migrate, and respond to noise. Facing one
head-on is a mistake; the design intent is to make the player route around or funnel it.

## Companions, panic, and injury in combat

Companions fight with their own competence, gear, morale, and **fear** — a scared companion
can freeze, flee, or fire wildly and hit the wrong thing. The player themselves has a hidden
**Fear Meter**: as it climbs (darkness, being surrounded, low health), scene text degrades,
options narrow, and at the extreme the player can **panic** — a lost exchange, a dropped
weapon, a scream that draws more. Combat is where injuries (Part VI) are minted: the bite,
the fracture, the deep cut with its scent trail.

## Escape, environment, and rewards

**Escape** is always a first-class option, with a cost (dropped loot, a wound, lost ground).
The **environment** is a weapon — gas leaks, fire, height, chokepoints, vehicles, alarms to
lure with. Combat **rewards** are mostly negative-space: you survived, you kept your gear,
you didn't get bitten. Loot from the dead is a bonus, not the point.

## Canonical: the Last Stand

When a run reaches its end in combat — surrounded, out of options — it does not simply cut to
a death screen. It triggers a **Last Stand**: a final, heightened sequence where the player
spends whatever they have left on one last set of choices (hold the door so a companion gets
out, take as many with you as you can, say the thing you never said). Last Stands turn deaths
into the run's most memorable scenes and are canonical, not optional.

## Combat design rules

1. The best fight is the one avoided; make avoidance real.
2. Every fight spends something scarce.
3. Loudness is a strategic cost, not a stat.
4. Fear is a mechanic; panic is a consequence.
5. Death in combat is a scene (the Last Stand), not a screen.

---

# Part X — Inventory, Crafting, Loot & Economy

## Goals

Resources are the pulse the player takes every day. The economy should always feel slightly
short — never comfortable, rarely empty — so that every can of food is a small decision and
hoarding is a real temptation with a real cost.

## The four resource loops

Four intertwined loops run constantly, each draining and needing replenishment:

1. **Body** — food and water in, hunger and thirst out.
2. **Safety** — ammo, materials, and durability spent staying alive.
3. **Health** — medicine and clean conditions against wounds and infection.
4. **Power** — fuel and components keeping light, heat, and tools running.

## Resource categories

Food, water, medicine, ammunition, fuel, building materials, components (the scrap crafting
runs on), and special/story items. **Item quality** matters (a rusty knife vs. a sharp one),
**food spoils** over time and faster once power fails, and **water** must often be found
dirty and purified before it's safe.

## Inventory capacity

Carry is limited by weight and slots, and **backpack progression** is a real form of growth
(Principle 6) — a better bag is a better run. Capacity forces the recurring, honest question
the Survival Triangle loves: *what do I leave behind?*

## The loot economy

Loot is **finite and contested** (Part IV). It's distributed by plausibility — pharmacies
hold medicine, police stations hold weapons and ammo, homes hold food and odds and ends — in
rough **tiers** from common junk to rare finds. **Searching** costs time, stamina, and noise
and returns partial results (search percentage persists on the node), so a thorough search is
a Survival Triangle trade every time. **Hidden loot** rewards curiosity and NPC hints
(Principle 5) — the handgun taped under the desk, the batteries in the freezer a survivor
mentioned.

## Crafting and repairs

Crafting is practical, not a tech tree to a win button: medical (bandages, purified water,
crude antibiotics), weapon (repairs, ammo reloading, traps), shelter (barricades,
reinforcements, alarms), and survival (fire, tools, warm clothing). Recipes are gated by
**blueprints** the player finds or is taught, by **components**, and by having the right
**shelter room** (Part XI). **Repairs** keep artifacts alive — the reason to protect a good
weapon rather than discard it.

## The scarcity curve

Scarcity tightens across a run by design (Part XVI): early days are about finding your feet,
mid-run is the squeeze as easy loot runs out and needs multiply, late-run is about managing a
community on what preparation you banked. The curve is a pressure, not a wall — comeback paths
always exist.

## Trading, companions, and sinks

**Trade** with other survivor groups turns surplus into what you lack, at prices set by
scarcity and reputation (Part XII). **Companions consume** — every mouth you save is a mouth
you feed, the central tension of growing a community. Deliberate **resource sinks** (fuel
burn, spoilage, durability, medicine) keep the economy from ever fully stabilizing.

## Canonical: The Last Can

The economy is tuned so that most runs, at least once, come down to **the last can** — the
single unit of food or dose of medicine that must be given to exactly one of several people
who need it. This is not a scripted event; it's an emergent pressure the balance is designed
to produce, and it's where the resource economy becomes a moral one. Protect this moment in
balancing; it's a feature, not a failure state.

## Legendary items

A small number of **legendary items** exist — the firefighter's axe, a hand-crank radio that
still reaches the outside world, a vehicle worth keeping alive. They're powerful mostly
because of what they *enable* and the history they accrue (Principle 6), and they're always at
risk of being lost, worn out, or left behind in a bad moment.

## Resource design rules

1. The player should always be a little short.
2. Every resource has a sink; nothing stabilizes forever.
3. Searching and carrying are Survival Triangle trades, not free actions.
4. Loot is finite and contested; the world can beat you to it.
5. Preserve "the last can" — the economy's job is to eventually make food a moral choice.

---

# Part XI — Shelter & Community

## Outside vs. home

The game breathes between two states. **Outside** is tension, scarcity, and noise. **Home**
is the one place that can feel safe — and the thing you most fear losing. The shelter is the
emotional anchor of a run: the reason to come back, the stakes of every fight, and the store
of everything you've prepared.

## The shelter loop

Home time is its own loop (Part III): heal, craft, repair, talk, upgrade, assign jobs, sleep,
begin the next day. It's where preparation is banked and where relationships are tended.

## One shelter, evolving

The player maintains **one** home shelter at a time (claimed from a node, Part VII), which
**evolves** from a barricaded room into a defensible community as it's built up. It's tracked
by **integrity** (physical soundness under attack and decay), **population**, **morale**,
**storage**, and its installed **rooms**. It can be lost — overrun, burned, or abandoned under
pressure — and losing it is one of the run's heaviest blows.

## People: population, morale, and hope

Every resident is a simulated survivor (Part XII) with needs and a personality. **Shelter
morale** is the aggregate mood, fed by safety, food, comfort, wins, and losses. The deep
tension is **hope vs. survival**: the cold-optimal choice (turn away the strangers, ration
hard, quarantine the sick without ceremony) keeps people alive but bleeds hope, and a shelter
without hope falls apart from the inside even if it never loses a wall.

## Jobs and daily reports

Residents are assigned **jobs** — guard, forage, cook, medic, build, tend the garden — that
run while the player is away, turning the community into an economy that produces and consumes
on its own. Each in-game day yields a **daily report**: what was gathered, what broke, who
argued, who's sick, what happened at the walls last night. The report is how the simulation
tells the player what their absence cost or earned.

## Storage and rooms

Storage splits into the player's **private inventory** and **community storage** (shared,
and a source of trust or friction — who takes what?). **Crafting rooms** unlock capabilities
and jobs:

- **Kitchen** — turns raw food and water into meals and morale.
- **Medical bay** — treats wounds, diagnoses and fights infection, enables quarantine.
- **Workshop** — repairs and advanced crafting; keeps artifacts alive.
- **Radio room** — listens to and eventually broadcasts on the radio network (Part XIII).
- **Watchtower** — early warning and defensive advantage against night attacks.
- **Garden** — a slow, precious renewable food source that reduces reliance on scavenging.

A **generator** powers the rooms that need it, on scarce **fuel** — a constant Power-loop
sink and a target during attacks.

## Defense and night attacks

The shelter is attacked, usually at **night**, by zombies drawn by accumulated noise or by
hostile survivor groups. Defense is preparation made physical: barricades, traps, the
watchtower, armed and brave residents, and the player's own presence. **Attack resolution**
plays out as a defensive scene with real losses — walls breached, people hurt or killed,
supplies destroyed — and its outcome leans heavily on the days of preparation that preceded
it. A night attack is the Survival Triangle's bill for a run of loud, fast play.

## Memory, relationships, and the human details

The shelter accrues its own history. A **memorial wall** remembers the dead by name and cause
— a permanent, in-world record that weighs on morale and the player alike. Residents form
**relationships** with each other (Part XII), and the community holds room for the fragile,
non-combat stakes that make survival matter: **children** to protect and keep hopeful,
**pets** that cost food and give comfort, small routines and arguments and reconciliations.

## Canonical: community identity

Over time a shelter develops a **community identity** — an emergent character born of who
lives there and how the player has led. A haven that takes everyone in and buries its dead
with care becomes known (to survivors, to the world's story) as a refuge; a hard, closed
group that turns people away and hoards becomes known as something colder. This identity is
read by NPCs deciding whether to join, by groups deciding whether to trade or raid, and by
the endings. The shelter is, in the fullest sense, **a character** — the game's second
protagonist — and should be written and simulated as one.

## Design rules for shelter

1. Home must feel safe enough to fear losing.
2. The community lives while the player is away; the daily report proves it.
3. Every resident is a mouth, a personality, and a potential story — never a stat.
4. Hope is a resource as real as food.
5. The shelter has an identity and a memory; treat it as a character.

---

# Part XII — Survivors, NPCs & Factions

This is the game's soul, and the fullest expression of Principle 5. The original Zurvival was
a chatbot; its center of gravity was people. Zurvival Reborn honors that by making survivors
**handcrafted, remembered, and socially alive** — never generic spawns.

## The core rule

Survivors are authored, not generated. The game ships with a curated pool of roughly
**60–100 named characters** — Sarah the paramedic, Marcus the reluctant mechanic, Dana who
won't say what she did before — each with a specific background, personality, a handful of
skills, and at least one **secret**. Encounters draw from this pool and place characters into
the world state; the same Sarah met in two different runs is recognizably the same person.

## Survivor identity

Each survivor carries a **background** (which shapes skills, dialogue, and useful knowledge),
a set of **skills** (medical, mechanical, combat, cooking, leadership, and so on), a
**personality** built from traits (brave/timid, warm/cold, honest/deceptive, loyal/self-
interested), ongoing **needs** (food, safety, purpose, connection), and **dynamic goals** that
change with circumstance (find a lost sibling, avenge a death, simply not be alone).

## Memory, trust, and respect

Every survivor runs a **memory** of what the player and others have done — promises kept and
broken, dangers shared, cruelties witnessed, gifts given. From that memory grow **trust**
(will they rely on you?), **respect** (do they defer to you?), and **fear**. These aren't a
single "reputation bar"; they're per-character and per-relationship, and they drive behavior:
who follows an order, who argues, who slips away in the night.

## Companion AI

A recruited survivor becomes a **companion** with real autonomy. They act on their own
competence, morale, and fear in exploration and combat (Part IX); they can be given **orders**
(hold, follow, scavenge, guard) that they follow according to their trust and personality —
a low-trust companion may refuse the dangerous one. They form **relationships** with other
companions and residents, and those bonds create **conflict** (jealousy, blame, old history)
that the player has to manage.

## The hard turns: death, desertion, betrayal

Companions can **die** — permanently, and heavily, often in a Last Stand or defending the
shelter — and the community remembers them (the memorial wall, Part XI). A mistreated,
terrified, or disillusioned survivor may **desert**, and in the worst cases a low-trust or
malicious character may **betray** the group (steal supplies, open a gate, sell you out).
**Recruitment** is therefore a real judgment: every person is help, a mouth, and a risk.

## Canonical: dynamic conversations that hint

Survivors don't hand out fetch quests. They **talk**, and their talk is a mechanic. In
conversation they surface memories, fears, and offhand knowledge — *"my dad always kept spare
batteries in the freezer,"* *"the clinic on 4th had a safe in the back"* — that function as
real, actionable **hints** toward loot, locations, and story (Principle 5). Listening pays.
Personal quests grow out of these conversations rather than a quest board.

## Personal quests and romance

Deepening a relationship can open a **personal quest** — helping a survivor reach a goal that
matters to them (recover a keepsake, find a person, settle a debt) — with meaningful stakes
and rewards that are usually emotional and narrative before they're material. **Romance** is
possible, understated, and earned through shared survival, and like everything else it can be
lost.

## Survivor groups, factions, and diplomacy

Beyond individuals, other **groups** and **factions** hold territory and pursue goals
(Part IV). Each has an **identity** (raiders, a militia, a trading collective, a cult of the
new order) and a stance toward the player driven by **reputation** and by the player's own
community identity (Part XI). **Diplomacy** spans trade, alliance, tribute, avoidance, and
war; groups also have **dynamic leadership**, so killing or turning a leader can reshape or
shatter a faction.

## Canonical: the Storyteller system

A dedicated **Storyteller** system gives the social simulation narrative teeth. It watches
relationships, deaths, secrets, and history, and periodically weaves them into surfaced
moments: a companion finally telling you what they did before, two survivors reconciling at a
funeral, a betrayal foreshadowed by weeks of small slights, a secret revealed at the worst
possible time. The Storyteller doesn't script outcomes; it notices the threads the simulation
is already spinning and makes sure the player *sees* them. This is what turns a relationship
graph into a story, and it is core, not optional.

## Survivor legacy

When survivors die or a run ends, their story doesn't fully vanish — the **legacy** system
lets names, deeds, and consequences echo forward (into the run's history, the endings, and
restrained cross-run remembrance), so the people the player knew leave a mark on the world.

## Design rules for survivors

1. Every named survivor is authored and recognizable across runs.
2. Trust and respect are per-relationship and earned, not a global bar.
3. Conversation is a mechanic; listening yields real advantage.
4. Recruiting is help, cost, and risk at once.
5. The Storyteller ensures the social threads become visible stories.

---

# Part XIII — Story, Radio & Endings

## Story philosophy

The story is discovered, not delivered. It exists in three layers the player peels back at
their own pace:

1. **Your story** — the emergent, personal narrative of this run: who you saved, what you
   lost, the shelter you built. Always the primary layer.
2. **The city's story** — how this place fell, told through environmental storytelling,
   survivors' memories, and the radio. Optional, ambient, cumulative.
3. **The truth** — the deeper mystery of the outbreak, seeded in fragments across many runs
   and never fully spelled out.

**Never explain everything.** Ambiguity is a feature. The most powerful lore is the note that
trails off, the broadcast that cuts out, the survivor who dies before finishing the sentence.
The game trusts players to hold unanswered questions.

## The radio network

The radio is the game's window onto the wider world and its main deliberate story channel.
It's a real, evolving system, not a cutscene dispenser:

- **Emergency broadcasts** — automated, decaying official messages; the sound of the old
  world running down.
- **Military broadcasts** — evacuation points, checkpoints, warnings; often a trap, a moving
  target, or already fallen by the time you arrive.
- **Civilian and ham operators** — real people out there, with needs, information, and lies;
  some become quests, some become friends, some go silent mid-sentence.
- **Automated and unknown signals** — a number station, a looping recording, something that
  shouldn't still be transmitting.

Broadcasts **evolve** with the world state (a station goes dark when its region falls; a new
signal appears after a global event), and with a radio room (Part XI) the player can **listen
across regions** and eventually **broadcast** themselves — calling for help, warning others,
luring, or lying, each with consequences. A **rumor system** turns radio, survivors, and
notes into leads of varying reliability, and **lore collection** quietly assembles the
fragments the player finds into a codex.

## Narrative pace

Story pressure ebbs and flows with the run rather than ticking to a chapter clock. Major
story events fire when world conditions are met (Part IV) — the player heard the broadcast,
the bridge is down, the medic is alive, infection reached a stage — so the narrative always
fits the specific run it's happening in.

## Endings philosophy

**There is no single "true ending."** Endings are outcomes of the simulation and the player's
choices, not a canon the player is graded against. An ending is assembled from **components**
— did you survive or die and how, who lived, what became of the shelter, your community
identity and humanity, which mysteries you touched, what you did to the world — so two
"survivals" can feel completely different.

- **Rescue / escape** endings, **entrenchment** endings (you become a fixture of the ruined
  city), **sacrifice** endings, and quiet **fade** endings.
- **Epilogues** follow the survivors you leave behind — a short account of what your choices
  meant for them.
- **Failure endings** are endings too, with the same care: a Last Stand (Part IX), a shelter
  overrun, a slow loss to infection (Part VI) — each gets a real close, not a "You Died"
  card.
- **Hidden endings** reward rare conditions and deep engagement with the truth layer.
- **The final broadcast** — a recurring closing device: the last thing that goes out over the
  radio about you, or from you, as the run ends.

## Canonical: Living History

Every run writes to a persistent **Living History** — a record of what happened in this
version of the city: who died and how, what was burned or saved, which bridges fell, which
bosses were put down, which children made it out. Elements of this history can surface in
later runs as rumor, ruins, memorials, and legend, so the world accumulates a sense of having
been lived in. Living History is core: it's how the game remembers, across the fog-of-war of
a single run and across many.

## Design rules for story

1. Your story comes first; the deeper layers are optional and ambient.
2. Never explain everything; protect ambiguity.
3. Story events fire on world conditions, not a chapter clock.
4. There is no true ending — endings are assembled from what actually happened.
5. Every ending, including failure, gets a real close.

---

# Part XIV — Technical Architecture

This part describes the shape of the software, deliberately **language-agnostic**. No runtime
or stack is committed yet (see PRD → Open Questions and `design/decisions/`). The architecture
is chosen so it can be implemented in whatever language is picked and reused across a web
client and a chat-bot client alike.

## Core philosophy

- **A pure, deterministic simulation core.** Given the same state and the same random seed,
  a turn always produces the same result. Determinism makes the game testable, debuggable,
  replayable, and safe to save and resume.
- **Content is data, not code.** Regions, locations, items, weapons, survivors, zombies,
  encounters, and radio scripts live as data files (the Content Bible, Part XV / `content/`),
  loaded and validated at runtime. A designer can add a location or a survivor without
  touching the engine.
- **The engine is headless.** It takes a state and an action and returns a new state and a
  scene to render. The UI is just a renderer; the same core can drive a browser, a native
  app, or a Discord/Telegram bot.

## The state model

A single serializable **GameState** is the source of truth, mirroring the six simulation
layers (Part IV):

- **Player** — condition, inventory, equipment, skills, traits, location, reputation, quests.
- **World** — global clock, weather, season, infrastructure, threat, broadcast network,
  known safe zones, and the world flags.
- **Region** — per-region density, loot, threat, power/water/fire, road conditions, story.
- **Location (node)** — per-node memory: loot remaining, damage, corpses, blood, barricades,
  occupants, search %, discoveries.
- **Companion / Survivor** — full per-character state and relationships (Part XII).
- **Item** — including artifact **metadata** (provenance, history) for significant items
  (Principle 6).
- **Scene** and **Choice** — the current situation and the options presented.
- **Event** — queued or triggered situations.

## Flags, requirements, and effects

Two small, general systems keep content declarative:

- A **Requirements engine** — content declares the conditions it needs (state predicates:
  `infection >= symptomatic`, `region.downtown.threat > 0.8`, `flag.met_sarah`), and the
  engine filters by them. This is how encounters, story events, and dialogue gate themselves
  without hard-coded branching.
- An **Effect system** — content declares what it changes (adjust a stat, set a flag, spawn a
  horde, damage a node), applied uniformly and logged. Requirements + effects mean most
  content is data, and the "flag philosophy" is: prefer meaningful world state over a sprawl
  of ad-hoc boolean flags.

## The turn: simulation tick and director

Each turn runs the fixed pipeline from Part IV as a **simulation tick**, with the
**Director** (Part IV/XVI) invoked as one stage to bias pacing. The order is invariant to
guarantee reproducible behavior.

## Determinism support systems

- **Random seed** — every run carries a seed; all randomness derives from it, so runs are
  reproducible and shareable for debugging.
- **Event queue** — future/scheduled events live in a queue processed each tick.
- **History log / Living History** — an append-only record of significant events (Part XIII),
  used for callbacks, the run summary, and cross-run memory.
- **Query system** — a read-only way for content and UI to ask questions of the state
  ("nearest known water source," "companions who fear me") without mutating it.

## Saving

Because the whole game is one serializable GameState plus a seed, **saving is snapshotting**
that state. Saves carry **metadata** (day, location, playtime, a one-line "where you are")
and a **version**; a documented migration path keeps old saves loadable as the schema evolves.

## Tooling, mods, performance

- **Mod support** falls out of content-as-data: if the base game is authored as external data
  against published schemas, players and designers can add or replace content the same way.
- **Debug tools** — a state inspector, a seed setter, an event/flag console, and a way to
  fast-forward the simulation are first-class, not afterthoughts.
- **Logging** captures the decision trail behind each generated scene for balancing and
  bug-hunting.
- **Performance philosophy** — the simulation is lightweight (it's bookkeeping, not physics);
  the target is instant response on a mid-range phone, so heavy work (large horde/region
  updates) is bounded and, where needed, amortized across ticks.

## Content pipeline, validation, versioning

Content is authored as data, **validated against schemas** in CI (a malformed encounter fails
the build, not the player's run), and **versioned** alongside the save schema. This is the
backbone that lets the game grow to thousands of content entries without the engine rotting.

## Design rules for architecture

1. The core is pure and deterministic; the same seed and state reproduce the same turn.
2. Content is data; the engine reads it, and never the reverse.
3. The engine is headless and renderer-agnostic.
4. Prefer meaningful world state to ad-hoc flags.
5. Everything significant is logged to a history the game can query.

---

# Part XV — Content Bible

The Content Bible is the catalog of everything authored as data. This part is the overview
and the rules; the data itself lives in `content/`, one entity per file, validated against
schemas in `content/schemas/`.

## Content hierarchy

```
Region → Location (node) → its loot, encounters, story, and occupants
Survivors, Zombies, Items, Weapons, Encounters, Radio → referenced into the world by state
```

## What gets authored

- **Regions** — the city's zones, each with identity, danger, loot profile, and story hooks
  (Residential, Downtown, Industrial, Hospital District, University, Military Zone,
  Riverfront, Farmland, Forest, Highway).
- **Locations** — the named nodes inside regions, each with description, plausible loot,
  zombie profile, connections, and memory fields.
- **Items** — food, water, medical, ammunition, fuel, materials, electronics, utility, and
  story items, with quality and (for significant items) artifact metadata.
- **Weapons** — improvised, civilian, police, military, across the categories in Part IX,
  with stats, durability, and noise.
- **Zombies** — the types and behaviors of Part IX, with senses and state data.
- **Survivors** — the ~60–100 handcrafted characters (Part XII): background, skills,
  personality, secret, and starting relationships.
- **Encounters** — templates with conditions, tags, weights, cooldowns, chains, and effects
  (Part VIII).
- **Radio stations & broadcasts** — the network of Part XIII, including evolving and unknown
  signals.
- Supporting sets: **weather types, encounter tags, story-artifact types, shelter rooms,
  world events, collectibles, animals, vehicles, difficulty modes.**

### Example region (sketch)

> **Downtown** — dense, vertical, loud. High zombie density and high-tier loot (pharmacy,
> police station, offices) behind serious risk. Landmark: the hospital tower. Threat level
> starts high and spikes fast with gunfire. Story hooks: the fallen evacuation point, the
> pharmacy safe, a trapped survivor broadcasting from an office high-rise.

### Example location (sketch)

> **Riverside Pharmacy** — a looted-looking storefront that still hides a locked
> controlled-substances cabinet. Common shelves picked over (search % persists); rare
> medicine behind the cabinet; a bloated zombie in the stockroom. Memory: window state, alarm
> state, who's been here. Hint target for a survivor's "the clinic kept its good stuff locked
> in back."

## Content creation rules

Every entry must pass the **five-question test** before it ships:

1. **Why does it exist?**
2. **What decision does it create?**
3. **Which systems does it affect?**
4. **Does it tell a story?**
5. **Can the player remember it?**

If a thing creates no decision and leaves no memory, it is filler. Cut it.

## The Rule of Three

Every significant location should support at least **three distinct approaches or outcomes**,
so it plays differently across runs and playstyles. A fire station, for example, should reward
the loud fast raider, the patient stealth scavenger, and the diplomat who finds the survivors
holed up inside — three different stories from one node.

## Content ratios

Author toward variety, not volume: a spread across categories (exploration, combat, social,
environmental, story, psychological, shelter), a majority of low/medium-intensity content
with rarer high-intensity peaks, and enough breadth per region that a full run rarely repeats
itself. Balance targets are set in Part XVI; the ratios there govern what to author most.

---

# Part XVI — Balancing, Progression & Difficulty

## The survival curve

The run should feel like a slow, uneven decline that the player fights to slow down — never a
smooth power climb. Comfort is temporary; the ground keeps tilting. The design goal is that
the player is always managing a shortfall, and that "winning" means delaying failure well.

## The four phases of a run

1. **Shock (early)** — disoriented and under-equipped; easy loot exists; the main threat is
   inexperience. Teach through pressure, not tutorials.
2. **Survival (mid)** — the squeeze: easy loot is gone, wounds and infection accumulate, and
   every trip costs more than it returns. The hardest phase by design.
3. **Community (late-mid)** — the shelter and companions come online; the player shifts from
   surviving alone to sustaining others, trading personal risk for collective stakes.
4. **Legacy (end)** — the run resolves toward its ending: hold, escape, sacrifice, or fall.
   The stakes are everything the player has built.

## The Survival Triangle as the balancing lens

Every system is tuned so that its choices sit somewhere on **Safety · Resources · Time**
(Principle 4). Balancing means making sure no corner is free and no strategy dodges the trade:
loud/fast play buys Resources and Time by spending Safety (noise, threat, night attacks);
careful/quiet play buys Safety by spending Time (infection advances, loot is contested, needs
climb). If a tactic ever lets the player have all three, it's a balance bug.

## Curves and anti-spiral systems

- **Resource curve** — availability tightens across the phases above (Part X); scarcity is
  the primary difficulty driver, not enemy stat inflation.
- **Snowball prevention** — success plants new cost (Principle 1): a bigger community eats
  more, better gear wears out, a cleared region draws migration. Getting ahead creates new
  pressure rather than runaway safety.
- **Failure-spiral prevention & comeback mechanics** — a bad turn must not silently doom the
  run. The director (below) and comeback paths (a lucky find when desperate, a survivor who
  offers help, a quiet stretch to recover) keep a struggling player in the game with agency,
  without erasing consequences.

## The Apocalypse Director as difficulty

The **Director** (Part IV) is the adaptive-difficulty system. It reads tension, desperation,
repetition, and the emotional curve, then *biases probabilities* toward better drama — easing
off after a brutal fight, tightening when the player is coasting, offering a rope when they're
drowning. It never fakes outcomes or breaks world logic; it shapes odds. This gives a hand-
tuned feel across wildly different runs without a difficulty slider doing the work.

## Difficulty modes

Explicit modes sit on top of the adaptive layer for players who want to set the floor:

- **Story** — softer scarcity and consequences; for players here to experience the world.
- **Survivor** — the intended baseline.
- **Hardcore** — tighter resources, harsher consequences, a smarter director.
- **Nightmare** — punishing scarcity and danger; for veterans.
- **Ironman** — one save, no take-backs; death is final. Can layer on any mode.

## The "One More Day" test

The core health metric is subjective and non-negotiable: at the end of a session, does the
player want **one more day**? If runs routinely end in relief-to-stop rather than
reluctance-to-stop, the pacing is wrong regardless of what the numbers say.

## Balancing method

Balance by playtest and telemetry against explicit targets — run length, phase durations,
death causes and timing, resource margins, encounter-category mix, and how often "the last
can" moment (Part X) actually occurs — iterating in passes rather than tuning to intuition
alone. **Accessibility** is a balancing concern too: difficulty should come from meaningful
scarcity and decisions, never from opaque text, fiddly input, or missable information.

## Design rules for balance

1. The player is always a little short; scarcity is the main difficulty driver.
2. No strategy escapes the Survival Triangle; every corner has a price.
3. Success creates new problems; it never creates safety.
4. A bad turn is survivable with agency; the director throws ropes, not lifelines.
5. Tune to "one more day," and to preserving the moral pressure moments.

---

# Part XVII — UI, UX & Presentation

## Core principles

1. **Story first.** The words are the game. The interface serves the text and then gets out
   of the way.
2. **One decision at a time.** The screen centers on the current situation and its choices —
   never a dashboard of competing demands.
3. **Information on demand.** Depth (inventory, map, companions, journal) is one tap away, not
   crowding the main view.
4. **Mobile first.** Designed for a phone in one hand, then scaled up — this also keeps a
   chat-bot client viable.
5. **Minimalism.** The player should never manage twenty visible bars; only critical stats
   are ever on screen (Part V).

## The primary screen

A simple vertical stack: a slim **header** (day, time, place, weather), a restrained
**status** row (only the critical stats; infection shown as symptoms, not a bar — Part VI), a
**story window** (the scene text — the star), a **choice panel** (a few clear options with
their costs legible), and a quiet **footer** for access to menus. Everything else is a
drill-down.

## Look and feel

- **Typography** carries the mood; text is large, readable, and well-spaced, treated as the
  primary art.
- **Color** is muted and meaningful — desaturated survival palette, with color reserved to
  communicate (danger, infection, night) rather than to decorate.
- **Animation** is minimal and diegetic: text that arrives with weight, a flicker for a
  failing light, stillness held on purpose. No bouncy game-feel that undercuts dread.

## Choice presentation

Choices show their **costs and risks** up front where they're known (time, noise, a resource)
and hide what the player couldn't know (the outcome). Micro-choices (Part III) appear inline
and lightweight. The interface never fakes a choice; if two options do the same thing, one of
them shouldn't exist.

## Secondary screens

Clean, purpose-built views for **inventory** (weight, categories, artifact histories),
**companions** (condition, mood, relationships, orders), the **shelter** (rooms, jobs, the
daily report), the **world map** (the journal of Part VII — fog of war, player notes,
auto-annotated history), and the **journal/codex** (discovered lore, rumors, memorials).

## Emotional UI and the Quiet Screen

The interface is an instrument of tone. In heavy moments it **restrains itself** — fewer
options, more whitespace, a slower cadence. The **Quiet Screen** is a deliberate device: after
a death or a loss, the game strips the UI back to bare text and a single way forward, giving
the moment room to land. The UI should tell the story too — going dark when the power fails,
degrading when the player is feverish (Part VI).

## Accessibility

First-class, not a checkbox: scalable text, high-contrast and colorblind-safe options
(color never the sole carrier of meaning), full screen-reader support (the game is mostly
text — this should be excellent), reduced-motion and reduced-flicker modes, and
keyboard/controller parity with touch. Difficulty should never come from the interface.

## Design rules for UI/UX

1. The text is the game; the UI serves it.
2. One decision at a time; depth on demand.
3. Show real costs; never fake a choice.
4. Restraint is a tool — let quiet moments be quiet.
5. Accessibility is core; a text game should be exceptionally accessible.

---

# Part XVIII — Audio & Atmosphere

In a text-forward game, audio does the heavy lifting of atmosphere. It carries mood, delivers
information, and burns moments into memory — and it knows when to disappear.

## Pillars

1. **Atmosphere** — sound builds the world the text describes.
2. **Information** — audio is a gameplay signal (a distant shot, a nearing horde, a change in
   the wind).
3. **Emotion** — music and tone shape how a scene feels without narrating it.
4. **Memory** — signature sounds tie themselves to specific events so they resurface with
   meaning.
5. **Silence** — the most powerful tool; used deliberately, quiet is terrifying.

## Layers

The mix is built from ambient (the room, the weather, the city), environmental (specific
sources — a dripping pipe, a flickering light), dynamic (threat- and state-driven cues),
player (heartbeat, breathing, footsteps), and a restrained music layer. These are mixed
**adaptively** by the simulation state, not triggered by script.

## Music

Music is sparing and reactive. A small set of themes — survival, exploration, danger, loss,
hope — fade in and out with the run's tension rather than looping over everything. **Adaptive
music** follows the director's read of the moment: it can drop out entirely to let a scene
breathe, and its return is an event.

## Sound as gameplay

Audio is diegetic information the player learns to read: the **direction and distance of
noise** (their own and the world's), the **heartbeat** system that rises with the Fear Meter
(Part IX), the specific sound-signatures of zombie types (the Screamer you *hear* before you
see), companion voices under stress, and weather that changes what you can hear and be heard
over. Hearing is a survival sense; temporary **hearing damage** from a nearby gunshot or blast
is a real, frightening consequence.

## Radio and signature sounds

The **radio** (Part XIII) has its own sonic identity — static, tuning, the timbre of an
official loop vs. a frightened human voice vs. a signal that shouldn't exist. A handful of
**signature sounds** (a specific door, a specific alarm, the tone of the shelter at night)
become the game's audio landmarks.

## Canonical: dynamic audio memory

Sound participates in memory. A cue attached to a formative event — the song on the radio the
night a companion died, the particular silence of the shelter after a loss — can **return**
later, in a dream (Part VI) or a quiet screen (Part XVII), to reopen that memory. Like the
Storyteller for narrative and Living History for the world, dynamic audio memory is how the
soundscape remembers. It's core to the intended emotional effect, not decoration.

## Accessibility and mixing

Everything meaningful in audio has a non-audio equivalent (captions, visual threat cues,
readable state), and the mix is dynamically managed so critical information is never buried.
Audio must never be the *only* channel for anything the player needs.

## Design rules for audio

1. Sound builds the world the text implies.
2. Audio is information; teach players to listen.
3. Silence is a tool — use it on purpose.
4. Music is sparing, adaptive, and led by the director.
5. Sound remembers; let key cues return with meaning.

---

# Part XIX — Production Roadmap

## The golden rule of production

**A small, complete, stable, fun game beats a huge, broken one.** Build depth before breadth:
prove the core loop is compelling with a little content before authoring a lot. Every
milestone should be *complete* (no dead ends), *stable* (it doesn't break), and *fun* (worth
playing) at its own scope.

## Phases

1. **Foundation** — the deterministic core, GameState, the turn pipeline, and content-loading
   against schemas. No game yet, but the skeleton runs.
2. **Core survival** — the vertical slice: one region, a handful of locations, and the real
   loop (choose action → resolve → advance time → world reacts), with stats, wounds, noise,
   and finite loot.
3. **World simulation** — the six layers alive at small scale: regional threat, hordes,
   weather, the director, local-area memory across a few nodes.
4. **People & shelter** — companions, a first slice of the handcrafted survivor pool, the
   shelter loop, and the Storyteller.
5. **Content expansion** — grow regions, survivors, encounters, items, and radio toward the
   full Content Bible; author for the Rule of Three.
6. **Polish & release candidate** — balance passes, audio, UI restraint, accessibility,
   localization, save migration, and hardening.

## The MVP / vertical slice (first playable)

The first thing that must be *fun* is a narrow slice, not a broad shell:

- **World:** one region, ~5–8 locations with real memory.
- **Loop:** move, search, fight/avoid, rest — with time, noise, wounds, and finite loot.
- **Story/people:** 3–5 handcrafted survivors, basic trust, one recruitable companion.
- **Shelter:** a single claimable node with minimal upgrades and a daily report.
- **Proof point:** a full slice run should already generate an emergent, retellable story and
  pass the "one more day" test. If the slice isn't gripping, more content won't save it.

## Milestones (indicative)

1. Core loop playable in a terminal against one region.
2. Simulation layers + director produce visibly reactive turns.
3. Companions + shelter + Storyteller produce an emergent story end-to-end.
4. Content-complete for the launch city; all systems integrated.
5. Balanced, accessible, localized release candidate.

## Testing and balancing

- **Unit tests** on the deterministic core (same seed + state → same result) and on effects/
  requirements.
- **Integration tests** on full turns and save/load round-trips.
- **Playtesting** as the primary balance instrument, against the explicit targets in
  Part XVI, in staged **balance passes** (survivability, scarcity, pacing/director,
  difficulty modes, accessibility).
- **Performance** target: instant-feeling turns on a mid-range phone.

## Team, risk, and scope

- **Roles:** game director, engine programmer, narrative designer, content designer, artist
  (UI/atmosphere), audio designer, QA. The content-as-data pipeline lets narrative/content
  work proceed in parallel with engine work.
- **Biggest risks:** content volume (mitigate with the tag/condition recombination system and
  the Rule of Three), scope creep (mitigate with the six principles as a cut filter), and
  "systemic but not fun" (mitigate by proving the vertical slice early).
- **Scope control:** the six principles are also a *no* machine. If a feature doesn't serve
  one, it waits or dies.

## Release and beyond

A staged rollout — closed testing, open beta, then 1.0 — with post-launch support focused on
new Content Bible entries (regions, survivors, encounters) that need no engine rewrite, per
the expansion hooks in Part IV. Longer-term vision: additional cities, deeper factions,
seasonal cycles, and the chat-bot client that returns the game to its messaging roots.

---

# The Zurvival Manifesto

- The world reacts. Not the story.
- Every decision matters, or it doesn't exist.
- The player is barely surviving — never winning.
- Injuries are stories. Infection is identity.
- The map remembers. The world remembers. So do the people.
- Every choice trades Safety, Resources, or Time.
- The survivors are handcrafted, and they are the heart.
- Progress is a better axe and a friend who trusts you — never a number.
- Systems create the story. We only supply the ingredients.
- If players say *"I picked option 2 and got ending B,"* we failed.
- If they say *"let me tell you what happened on my run,"* we succeeded.
