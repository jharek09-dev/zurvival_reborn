# Zurvival Reborn

> A chat-driven zombie survival roguelite where every decision permanently changes the world.
>
> The zombies are the pressure. The people are the story. Your decisions are the game.

Zurvival Reborn reimagines the original *Zurvival* Kik chatbot as a modern, definitive
survival experience. The player does not move from scene to scene through a scripted
story — they move through a **real place that reacts to every action**. A living World
Simulation Engine evaluates noise, infection, weather, and zombie density to generate what
the player realistically experiences next, so every run writes a different survival novel
authored by the player's choices.

This repository is the **design and content home** for the project. It currently holds the
design documentation and a language-agnostic content scaffold. No engine code is committed
yet — the technology stack is intentionally left open until the design is locked (see
[docs/PRD.md](docs/PRD.md), Open Questions).

## Start here

| Document | What it is |
| --- | --- |
| [docs/GDD.md](docs/GDD.md) | **Game Design Document** — the creative and systemic vision (what & why). |
| [docs/PRD.md](docs/PRD.md) | **Product Requirements Document** — vision turned into prioritized, testable requirements (what to build & when). |
| [DESIGN.md](DESIGN.md) | **Technical Design** — system architecture bridging the vision and future code (how). |
| [docs/PRODUCTION.md](docs/PRODUCTION.md) | **Production Plan** — the milestone ladder, fun gates, and scope-control machinery (how it ships). |
| [docs/reference/](docs/reference/) | Source material the rewrite is built on (original outline + prior GDD drafts). |

The production plan ships with a living [scope-control tracker](docs/scope-control-tracker.xlsx)
(milestone backlog, content budgets, risk burn-down) and a one-page visual
[roadmap](design/diagrams/roadmap.svg).

Each design doc also has a shareable `.docx` export alongside the Markdown in `docs/`.

## The six design principles

Everything in the GDD serves these six ideas. They are the spine of the reimagining.

1. **A systemic core loop.** The world is simulated, not scripted. Each turn runs
   *Tension → Success → Relief → New Problem*. A successful scavenge doesn't just end the
   turn; it creates the next responsibility.
2. **Injuries are stories.** No generic damage. A bite becomes a Sprained Ankle or a Deep
   Cut that leaves a scent trail; infection advances through stages and changes who you are.
3. **Nodes with memory.** Every location remembers what you did to it. Regions evolve their
   own threat levels. The map is a journal you annotate as you survive.
4. **The Survival Triangle.** Every meaningful choice sacrifices one corner of
   *Safety · Resources · Time*. Small micro-choices keep the world tactile.
5. **Handcrafted social simulation.** A pool of ~60–100 named survivors with histories and
   secrets, who build relationships with each other, not just the player.
6. **Artifacts over XP.** Progression comes from equipment and preparation, not levels.
   Items carry their own history and become personal artifacts.

## Repository layout

```
Zurvival Reborn/
├── docs/            Design documentation (GDD, PRD) + source reference material
├── content/         The Content Bible — game data, organized by type
│   ├── regions/       Region definitions (Downtown, Residential, ...)
│   ├── locations/     Individual node/location definitions
│   ├── items/         Consumables, materials, story items
│   ├── weapons/       Melee, firearms, improvised, explosives
│   ├── npcs/          The ~60–100 handcrafted survivors
│   ├── zombies/       Zombie types and behaviors
│   ├── encounters/    Encounter and event definitions
│   ├── radio/         Radio stations and broadcast scripts
│   └── schemas/       Data schemas / validation for the above
├── design/          Supporting design notes
│   ├── diagrams/       Flowcharts, system maps
│   └── decisions/      Architecture Decision Records (ADRs)
├── assets/          Placeholder for audio and art references
└── prototype/       Reserved for future engine code (no stack chosen yet)
```

## Project status

**Pre-production — design phase.** The design documentation is the deliverable; the content
folders are scaffolded but not yet populated. The first build target is a narrow **vertical
slice** (one region, a handful of locations, the core turn loop) described in the PRD.

## License

See [LICENSE](LICENSE). All rights reserved pending a final licensing decision.
