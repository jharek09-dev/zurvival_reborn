# Zurvival Reborn — Public Beta (MVP)

A chat-driven zombie survival roguelite. You don't move through a scripted story — you move through a **real
place that reacts to every action**. The zombies are the pressure; the people are the story; your decisions
are the game. This is the **M4 content-complete city** beta: one full city (6 regions, 60 nodes), the survivor
pool, the full encounter categories, staged infection, the radio network, a crafting/rooms/jobs economy,
factions, difficulty modes, and an adaptive text soundscape — all playable in the terminal.

## Run it

Requires **Node ≥ 22**. From a fresh clone:

```
cd prototype/harness
npm install
npm run play
```

| Command | What it does |
|---------|--------------|
| `npm run play` | A new run of the full city (fixed demo seed). |
| `npm run play -- <seed>` | A new run on a chosen seed (share a seed to share a run — it's deterministic). |
| `npm run play -- --difficulty <mode>` | Set the floor: `story`, `survivor` (default), `hardcore`, `nightmare`. |
| `npm run play -- --ironman` | One save, no take-backs. |
| `npm run play -- --resume <file>` | Resume a saved run. |
| `npm run play:slice` | A short, guided version of the authored **Ruth** arc on its own (the M3 slice). |

## Playing

Every turn is one Scene and a short list of numbered choices. There is **no timer and no pointer** — type a
number and press enter. Time and the world advance only when you resolve a turn.

```
[choice number · screens: I inventory · C companions · B shelter · M map & journal · L codex · S save · Q quit]
```

- **A number** — take that choice.
- **I / C / B / M / L** — open a depth screen (inventory, companions, shelter, map & journal, codex). These
  are **free**: opening one spends no time and changes nothing — it's just a closer look.
- **S** — save and quit. Resume later with `--resume <file>` (default file: `zurvival-save.json`). Save/resume
  is lossless at **any** turn boundary.
- **Q** — quit without saving.

## What to expect

- **The Survival Triangle.** Every real choice sacrifices one of *Safety · Resources · Time*. There is no free
  move; scavenging costs time and noise, resting costs daylight, a fortified base costs upkeep.
- **Nodes with memory.** Every location remembers what you did to it; regions drift on their own while you're
  away. The map is a journal you annotate by surviving.
- **Infection is identity, not a bar.** A bite advances through hidden stages you learn to read from
  **symptoms** — fever, senses you can't trust, burning up but still moving. There is **no infection number**
  and **no instant game-over**: reaching the worst stage opens a **cure race**, a harder way to keep going.
- **People are the story.** Named survivors remember how you treat them; trust is per-person and only earned.
  Some can be recruited; companions can die, and the run remembers. An **authored arc** (a desperate shopkeeper,
  Ruth) can find you as you play — the systems set it up, your choice resolves it, and the world repays or punishes.
- **Sound, in words.** An adaptive soundscape renders as always-on **captions** (`[a few of the dead, shifting
  and moaning — close, toward the Fish Market]`), so the game is fully playable with sound off.

## Accessibility

Built to be accessible from the first screen, not retrofitted (NFR-ACC): **keyboard-only**, turn-based (no
reaction-time barrier), save-anywhere, and **no information carried by colour or audio alone** — every fact is
in the text, and the soundscape has a text equivalent for every meaningful cue (see
[`reference/AUDIO_CUE_MATRIX.md`](reference/AUDIO_CUE_MATRIX.md)). Full status and the M5 runtime items:
[`specs/ACCESSIBILITY.md`](specs/ACCESSIBILITY.md).

## Known scope (this is a beta)

- **Volume is the defined beta subset**, not the launch maximum — one city, 18 survivors, the demonstrator +
  launch encounter set. The systems and the city are content-complete; the deep pours and a second city are
  post-M4.
- **Balance is not yet tuned.** Numeric balance (survivability, scarcity, pacing, per-difficulty dials) is the
  M5 staged pass — a greedy player will still die quickly; that's the pressure, not the calibration.
- **Terminal client only.** The web/native/chat clients come after v1.0.

Found something? The run is deterministic — **note the seed** (and the save file if you have one) so it can be
reproduced exactly.
