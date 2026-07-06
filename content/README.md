# Content Bible

Game data lives here, separated from whatever engine eventually reads it. This mirrors the
GDD's Content Bible (Part XIV) and its core principle: **content is data, not code.** A
designer should be able to add a location or a survivor without touching the engine.

## Folders

| Folder | Holds |
| --- | --- |
| `regions/` | Region definitions — the large zones of the city (Downtown, Residential, Industrial, Hospital District, ...) with their independent threat/loot/density state. |
| `locations/` | Individual nodes within regions — the pharmacy, the fire station, the school — each able to *remember* what happened to it. |
| `items/` | Consumables, resources, materials, and story items. Items can carry history (an artifact remembers where it was found). |
| `weapons/` | Melee, blunt, bladed, firearms, improvised, explosives, with their stats and durability. |
| `npcs/` | The ~60–100 handcrafted, named survivors — backgrounds, personalities, secrets, relationships. |
| `zombies/` | Zombie types, senses, states, and behaviors. |
| `encounters/` | Encounter and event definitions, tags, weights, cooldowns, and chains. |
| `radio/` | Radio stations and broadcast scripts, including evolving/emergency signals. |
| `schemas/` | Machine-readable schemas that validate everything above. |

## Rules

- **One entity per file.** One region, one survivor, one weapon per file keeps diffs clean.
- **Schema first.** Before populating a type at scale, define its schema in `schemas/` so
  data can be validated in CI.
- **Every entry passes the five-question test** (see `CONTRIBUTING.md`). No filler.

Format: **JSON, validated by JSON Schema** (one schema per type in `schemas/`, `$schema`
reference in each file) — decided in ADR-0002 (`design/decisions/0002-content-data-format.md`).
Use a `"notes"` field where you'd want a comment.
