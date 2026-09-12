import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  phaseOf,
  buildRegionGraph,
  saveGame,
  loadGame,
  encounterFires,
  summarizeRepetition,
  activeEncounter,
  VERBATIM_REPEAT_TARGET,
  ENCOUNTER_CATEGORIES,
  INFECTION_STAGES,
  STAGE_ORDER,
  isRunOver,
  isIronman,
  DIFFICULTY_MODES,
  parseDifficulty,
  PARTY_CAP,
  ANTIBIOTICS_ITEM,
  FOOD_ITEM,
  WATER_ITEM,
  STORY_ARCS,
  activeArcs,
  ZOMBIE_BEHAVIOUR,
  ENEMY_FOR_ZOMBIE,
  ENEMIES,
  type GameState,
  type RegionGraph,
  type RegionDef,
  type NodeDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type InfectionStage,
} from "../../engine/src/index.js";
import { describeStatus, playSession, resumeSession, transcript, DEPTH_SCREENS, SCREEN_KEYS, CUE_MATRIX } from "../src/index.js";

/**
 * T57 — the M4 EXIT GATE (the milestone Definition of Done, PRODUCTION §M4). This is the machine-provable
 * half of the exit: it consolidates and RE-PROVES the four DoD criteria at the CONTENT-COMPLETE, FULL-CITY
 * tier, in one place the gate can't silently lose:
 *
 *   1. the first city is content-complete and schema-valid (FR-CNT-02) — a machine-checked MANIFEST that
 *      enumerates every M4 in-scope Content-Bible pool (plus the client-side depth-screen / audio systems)
 *      and cross-checks its references resolve;
 *   2. verbatim encounter repetition sits under the PRD §4 target across a full run — re-measured here over
 *      the ALL-POOLS content-complete run (T48 proves it over the encounter pool alone);
 *   3. infection-as-identity is "a harder way to keep going" (FR-INJ-08) and legible without the hidden
 *      number — the mechanical half (the T49 comprehension gate proves the symptom-reading half);
 *   4. the beta is stable enough to hand out — a long content-complete playthrough stays coherent, its
 *      shipped-format save round-trips, resume is lossless at every boundary, and the run is byte-identical
 *      from seed (repro-from-seed, the property every beta bug report leans on).
 *
 * The HUMAN half of criteria 3 & 4 (does infection READ as identity to a player; does the beta feel handable)
 * is the owner playtest — docs/qa/M4_EXIT_GATE.md — exactly as the M3 Slice Fun Gate (T42) was rendered by
 * an owner playtest, not asserted by code. This file never claims that half.
 *
 * HARNESS-ONLY: it reads shipped content + the engine's public API and adds no engine/content, so byte-identity
 * holds by construction (the T54/T55/T56 shape).
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const npcs = load<NPCDef & { homeNode?: string }>("npcs");
const encounters = load<EncounterDef>("encounters");
const signals = load<SignalDef & { signalType?: string }>("radio");
const recipes = load<RecipeDef>("recipes");
const jobs = load<JobDef & { room?: string }>("jobs");
const factions = load<FactionDef & { members?: string[] }>("factions");
const arcs = load<{ id: string; subject: string }>("arcs");
const zombies = load<{ id: string }>("zombies");
const enemies = load<{ id: string }>("enemies");
const wounds = load<{ id: string }>("wounds");

const nodeIds = new Set(nodes.map((n) => n.id));
const npcIds = new Set(npcs.map((n) => n.id));

/** Stand up the FULL content-complete run: every shipped pool registered (the real beta boot path, playCli.ts). */
function bootFullCity(seed: string, extra: Record<string, unknown> = {}): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-07-18T06:00:00.000Z", ...extra },
    regions,
    nodes,
    npcs,
    STORY_ARCS.map((a) => a.id), // register the authored arc(s) — the real beta boot path (playCli.ts)
    encounters,
    signals,
    recipes,
    jobs,
    factions,
  ) as { state: GameState; graph: RegionGraph };
}

// ==============================================================================================
// 1. CONTENT-COMPLETENESS MANIFEST (FR-CNT-02) — every M4 in-scope system present + cross-referenced
// ==============================================================================================

describe("M4 exit — content-completeness manifest (T57 · FR-CNT-02 · PRODUCTION §M4)", () => {
  it("the city is ONE connected graph: 6 regions, ~60 nodes in the M4 budget, single known start", () => {
    // buildRegionGraph throws on any asymmetry / dangling edge / disconnection / missing-or-multiple start,
    // so a clean build with EVERY pool registered already proves whole-city referential integrity.
    const g = buildRegionGraph(regions, nodes, encounters, signals, recipes, jobs, factions, npcs);
    expect(Object.keys(g.regions).length).toBe(6);
    const n = Object.keys(g.nodes).length;
    expect(n).toBeGreaterThanOrEqual(40); // PRODUCTION §6.4 city budget (~40–60); actual 60
    expect(n).toBeLessThanOrEqual(65);
    expect(g.startNodeId).toBe("node.rivermouth.transit-plaza");
    // every region carries at least one node
    for (const rid of Object.keys(g.regions)) expect(Object.values(g.nodes).some((x) => x.regionId === rid)).toBe(true);
  });

  it("exposes several claimable safehouses across the city (FR-MAP-06)", () => {
    expect(nodes.filter((x) => x.claimable === true).length).toBeGreaterThanOrEqual(5); // actual 14
  });

  it("ships the defined-beta survivor pool with room for several companions (T45 · PRODUCTION §7 subset)", () => {
    // PRODUCTION §7 explicitly permits a *defined beta subset* of the survivor cap; this is that subset (18),
    // NOT the theoretical 100-cap — the gate asserts the subset, the packet records the deferral honestly.
    expect(npcs.length).toBeGreaterThanOrEqual(15);
    expect(PARTY_CAP).toBeGreaterThanOrEqual(2); // "several companions" — actual party cap 3
  });

  it("covers all SEVEN encounter categories (FR-ENC-05, Must) with the engine's own category set", () => {
    const present = new Set(encounters.map((e) => e.category));
    for (const c of ["exploration", "combat", "social", "environmental", "story", "psychological", "shelter"]) {
      expect(present.has(c as EncounterCategoryLike), `no encounter in category "${c}"`).toBe(true);
      expect(ENCOUNTER_CATEGORIES).toContain(c);
    }
  });

  it("ships the higher encounter forms: multi-stage (04), evolution (08), chains (03), moral/Humanity (06)", () => {
    // FR-ENC-04 multi-stage (negotiation → fight → chase)
    expect(encounters.some((e) => e.stages.length > 1)).toBe(true);
    // FR-ENC-08 evolution: the same node yields before/during/after variants
    for (const phase of ["before", "during", "after"])
      expect(encounters.some((e) => e.id === `encounter.the-terraces.garden-center-${phase}`), `missing garden-center-${phase}`).toBe(true);
    // FR-ENC-03 chains: at least one encounter SETS a flag, and at least one is GATED by flags
    const setsFlag = (e: EncounterDef) => e.stages.some((s) => s.choices.some((c) => (c.effects ?? []).some((ef) => (ef as { kind?: string }).kind === "setFlag")));
    const flagGated = (e: EncounterDef) => {
      const r = (e.requirements ?? {}) as { requiresFlags?: unknown[]; forbidsFlags?: unknown[] };
      return (r.requiresFlags?.length ?? 0) > 0 || (r.forbidsFlags?.length ?? 0) > 0;
    };
    expect(encounters.some(setsFlag)).toBe(true);
    expect(encounters.some(flagGated)).toBe(true);
    // FR-ENC-06 moral encounters feed Humanity
    const affectsHumanity = (e: EncounterDef) =>
      JSON.stringify(e).toLowerCase().includes("humanity");
    expect(encounters.filter(affectsHumanity).length).toBeGreaterThanOrEqual(3);
  });

  it("infection ships as FOUR staged identity — no bar, terminal within the ladder (T49 · FR-INJ-05)", () => {
    expect(INFECTION_STAGES.map((s) => s.key)).toEqual(["incubating", "symptomatic", "advanced", "terminal"]);
    expect(STAGE_ORDER).toEqual(["none", "incubating", "symptomatic", "advanced", "terminal"]);
    // the shipped infection def carries exactly those stages (the full drift-guard lives in infection.test.ts)
    const def = JSON.parse(readFileSync(join(contentDir, "infections", "infection.bite.json"), "utf8")) as { stages: { key: string }[] };
    expect(def.stages.map((s) => s.key)).toEqual(["incubating", "symptomatic", "advanced", "terminal"]);
  });

  it("the radio network spans all five FR-STY-03 signal families", () => {
    const types = new Set(signals.map((s) => (s as { signalType?: string }).signalType));
    for (const t of ["emergency", "military", "civilian", "ham", "unknown"]) expect(types.has(t), `no ${t} signal`).toBe(true);
    expect(signals.length).toBeGreaterThanOrEqual(5); // actual 7
  });

  it("the crafting economy covers every recipe family and the base runs every job room (T51/T52)", () => {
    const cats = new Set(recipes.map((r) => (r as { category?: string }).category));
    for (const c of ["medical", "weapon", "shelter", "survival", "repair", "purify"]) expect(cats.has(c), `no ${c} recipe`).toBe(true);
    const rooms = new Set(jobs.map((j) => (j as { room?: string }).room));
    expect(jobs.length).toBeGreaterThanOrEqual(5); // actual 6
    expect(rooms.size).toBeGreaterThanOrEqual(5); // one job per distinct room capability
  });

  it("factions & the authored arc reference only real, shipped survivors (cross-ref integrity)", () => {
    // membership integrity here; the FR-NPC-02/05/06/07 relationship SUBSTANCE (trust/rivalry/morale) is social.test.ts.
    expect(factions.length).toBeGreaterThanOrEqual(2); // actual 3
    for (const f of factions) for (const m of (f as { members?: string[] }).members ?? [])
      expect(npcIds.has(m), `faction ${f.id} member ${m} is not a shipped npc`).toBe(true);
    expect(arcs.length).toBeGreaterThanOrEqual(1);
    for (const a of arcs) expect(npcIds.has(a.subject), `arc ${a.id} subject ${a.subject} is not a shipped npc`).toBe(true);
  });

  it("every content-side node reference resolves (npc homes, encounter anchors) — no dangling ids", () => {
    for (const n of npcs) if (n.homeNode) expect(nodeIds.has(n.homeNode), `npc ${n.id} homeNode ${n.homeNode} missing`).toBe(true);
    for (const e of encounters) for (const nid of (e.requirements?.nodeIds ?? []))
      expect(nodeIds.has(nid), `encounter ${e.id} requires missing node ${nid}`).toBe(true);
  });

  it("ships the full zombie roster + its combat enemies and named wounds (T46/T16 · FR-CBT-06/07)", () => {
    expect(zombies.length).toBeGreaterThanOrEqual(7); // walker/screamer/stalker/fresh/crawler/bloated/riot
    expect(enemies.length).toBeGreaterThanOrEqual(4);
    expect(wounds.length).toBeGreaterThanOrEqual(4); // bite/fracture/laceration/sprain
    expect(Object.keys(ZOMBIE_BEHAVIOUR).length).toBeGreaterThanOrEqual(7); // the seven distinct behaviours
    const enemyIds = new Set(Object.keys(ENEMIES));
    for (const [zid, eid] of Object.entries(ENEMY_FOR_ZOMBIE))
      expect(enemyIds.has(eid), `zombie ${zid} maps to missing combat enemy ${eid}`).toBe(true);
  });

  it("the client-side M4 systems are present: depth screens (FR-UI-04) + the audio→text cue matrix (FR-AUD-06)", () => {
    // the content manifest can't see these (they are harness systems), but the exit gate should still refuse to
    // pass with them gone; their behaviour is proven by screens/soundscape/cueMatrix/accessibility.test.ts.
    expect(DEPTH_SCREENS.length).toBeGreaterThanOrEqual(5); // inventory/companions/shelter/map/codex
    expect(SCREEN_KEYS.length).toBe(DEPTH_SCREENS.length);
    expect(CUE_MATRIX.length).toBeGreaterThanOrEqual(20); // every meaningful sound cue → its text equivalent
  });

  it("ships a full-run encounter pool, and the beta boot actually REGISTERS the authored arc (not just data)", () => {
    expect(encounters.length).toBeGreaterThanOrEqual(20); // actual 26 — the demonstrator + launch set
    // beyond the static subject cross-ref above, the REAL beta boot registers + can fire the authored arc.
    expect(activeArcs(bootFullCity("t57-arc").state)).toContain("arc.rivermouth.the-last-customer");
  });

  it("the four difficulty floors + Ironman are all reachable (T56 · GDD XVI)", () => {
    const modes = new Set(DIFFICULTY_MODES.map((m) => m.mode));
    for (const m of ["story", "survivor", "hardcore", "nightmare"]) {
      expect(modes.has(m as (typeof DIFFICULTY_MODES)[number]["mode"]), `no ${m} mode`).toBe(true);
      expect(parseDifficulty(m)).toBe(m);
    }
    // Ironman is a layerable, persisted intent, honoured at boot
    expect(isIronman(bootFullCity("iron", { ironman: true }).state)).toBe(true);
  });
});

// a tiny local alias so the category strings type-check against the engine's union without a cast leak
type EncounterCategoryLike = (typeof ENCOUNTER_CATEGORIES)[number];

// ==============================================================================================
// 2. THE CONTENT-COMPLETE RUN — a long full-city playthrough stays coherent + §4 holds over IT
// ==============================================================================================

/**
 * A deterministic full-run-length sweep of the whole city with EVERY pool registered — the T48 selection
 * probe, re-pointed at the content-complete boot. It tours every node in id order across advancing days,
 * keeping the survivor alive so quiet-node opportunities keep coming; the thing under test is the real
 * engine selection path over a full run's worth of the content-complete world.
 */
function sweepFullCity(steps: number): { state: GameState; regionsVisited: number } {
  const { state: s0, graph } = bootFullCity("t57-exit-sweep");
  const tour = Object.keys(graph.nodes).sort();
  const regionsVisited = new Set<string>();
  let s = s0;
  let absH = 6;
  for (let step = 0; step < steps; step++) {
    absH += 4;
    const nodeId = tour[step % tour.length]!;
    regionsVisited.add(graph.nodes[nodeId]!.regionId);
    const node = s.nodes[nodeId]!;
    s = {
      ...s,
      meta: { ...s.meta, day: 1 + Math.floor(absH / 24), hour: absH % 24, phase: phaseOf(absH % 24), turn: s.meta.turn + 1 },
      combat: null,
      player: {
        ...s.player,
        location: nodeId,
        condition: { ...s.player.condition, needs: { hunger: 8, thirst: 8, fatigue: 8 }, mind: { stress: 55, morale: 60 } },
        inventory: [{ type: "item.canned-food", quantity: 5 }, { type: "item.scrap", quantity: 5 }],
        quests: s.player.quests.filter((q) => q.id !== "quest.active-encounter"),
      },
      nodes: { ...s.nodes, [nodeId]: { ...node, walkers: 0 } },
    };
    s = applyAction(s, { type: "wait" }, graph).state;
    if (activeEncounter(s)) {
      const ev = availableActions(s, graph).find((a) => a.id.startsWith("event:"));
      if (ev) s = applyAction(s, ev.action, graph).state;
    }
  }
  return { state: s, regionsVisited: regionsVisited.size };
}

describe("M4 exit — the content-complete city is one coherent, low-repeat run (T57 · criterion 2 & 4)", () => {
  const { state: swept, regionsVisited } = sweepFullCity(320);
  const summary = summarizeRepetition(encounterFires(swept));

  it("the sweep tours the whole city (every region reachable + exercised)", () => {
    expect(regionsVisited).toBe(6);
  });

  it("fires a full run's worth of encounters from the content-complete pool", () => {
    expect(summary.fires).toBeGreaterThanOrEqual(40);
  });

  it("verbatim repeats stay under the PRD §4 target (< 5%) over the ALL-POOLS run", () => {
    expect(summary.verbatimRepeatRate).toBeLessThan(VERBATIM_REPEAT_TARGET);
    expect(summary.immediateRepeats).toBe(0);
    expect(summary.distinct).toBeGreaterThanOrEqual(12);
    expect(summary.maxSingleShare).toBeLessThanOrEqual(0.25);
  });
});

// ==============================================================================================
// 3 & 4. HARDENING — repro-from-seed, lossless save/resume, shipped-format round-trip at the beta tier
// ==============================================================================================

/** Stock a run like a supplied beta tester's, so a long content-complete playthrough is sustainable. */
function stocked(state: GameState): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      inventory: [
        { type: FOOD_ITEM, quantity: 80 },
        { type: WATER_ITEM, quantity: 80 },
        { type: ANTIBIOTICS_ITEM, quantity: 6 },
        { type: "item.scrap", quantity: 40 },
        { type: "item.bandage", quantity: 8 },
      ],
    },
  };
}

/**
 * A greedy natural-choice script from a state: real offered choices only (so it is save/resume-able),
 * topping up needs whenever the engine offers eat/drink so a stocked run sustains. Deterministic.
 */
function greedyScript(state: GameState, graph: RegionGraph, n: number): string[] {
  const ids: string[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    if (isRunOver(s)) break;
    const cs = availableActions(s, graph);
    const c =
      cs.find((x) => x.id === "treat-infection") ??
      cs.find((x) => x.id === "drink") ??
      cs.find((x) => x.id === "eat") ??
      cs.find((x) => x.id.startsWith("event:")) ??
      cs.find((x) => x.id === "search") ??
      cs.find((x) => x.id.startsWith("move:")) ??
      cs.find((x) => x.id === "rest") ??
      cs.find((x) => x.id === "wait") ??
      cs[0];
    if (!c) break;
    ids.push(c.id);
    s = applyAction(s, c.action, graph).state;
  }
  return ids;
}

describe("M4 exit — beta hardening: repro-from-seed & lossless persistence (T57 · criterion 4)", () => {
  it("a full content-complete playthrough is byte-identical from the same seed (repro-from-seed)", () => {
    const a = bootFullCity("t57-determinism");
    const b = bootFullCity("t57-determinism");
    const sA = stocked(a.state);
    const sB = stocked(b.state);
    const script = greedyScript(sA, a.graph, 80);
    expect(script.length).toBeGreaterThanOrEqual(40); // a real playthrough, not a two-turn stub
    const runA = playSession(sA, a.graph, script);
    const runB = playSession(sB, b.graph, script);
    expect(runB.final).toStrictEqual(runA.final); // identical final state
    expect(transcript(runB, b.graph)).toEqual(transcript(runA, a.graph)); // identical transcript
  });

  it("the shipped save FORMAT round-trips losslessly at a rich content-complete state", () => {
    const { state, graph } = bootFullCity("t57-save");
    const script = greedyScript(stocked(state), graph, 45);
    const mid = playSession(stocked(state), graph, script).final;
    // loadGame(saveGame(state)) reconstructs the whole content-complete state, deep-equal.
    expect(loadGame(saveGame(mid))).toStrictEqual(mid);
  });

  it("quit/resume is lossless at EVERY boundary of a content-complete run (T21 held at the exit tier)", () => {
    const { state, graph } = bootFullCity("t57-resume");
    const s0 = stocked(state);
    const script = greedyScript(s0, graph, 36);
    const straight = playSession(s0, graph, script).final;
    for (let k = 0; k <= script.length; k++) {
      const atK = playSession(s0, graph, script.slice(0, k)).final;
      const resumed = resumeSession(saveGame(atK), graph, script.slice(k)).final; // rebuilt from the save string alone
      expect(resumed).toStrictEqual(straight);
    }
  });

  it("no long content-complete run SOFT-LOCKS — a legal action is always offered until a clean end", () => {
    // The anti-dead-end hardening INVARIANT, sampled across seeds. (Long-run soak + survival balance are M5/T66;
    // this proves the beta never wedges, not that a greedy bot survives indefinitely.)
    for (const seed of ["t57-live-a", "t57-live-b", "t57-live-c"]) {
      const { state, graph } = bootFullCity(seed);
      let s = stocked(state);
      let resolved = 0;
      let softLocked = false;
      for (let i = 0; i < 400; i++) {
        if (isRunOver(s)) break;
        const cs = availableActions(s, graph);
        if (cs.length === 0) { softLocked = true; break; } // the real invariant: never a dead end
        const c =
          cs.find((x) => x.id === "treat-infection") ??
          cs.find((x) => x.id === "drink") ??
          cs.find((x) => x.id === "eat") ??
          cs.find((x) => x.id.startsWith("event:")) ??
          cs.find((x) => x.id === "search") ??
          cs.find((x) => x.id.startsWith("move:")) ??
          cs.find((x) => x.id === "rest") ??
          cs[0]!;
        s = applyAction(s, c.action, graph).state;
        resolved++;
      }
      expect(softLocked, `soft-locked on seed ${seed}`).toBe(false);
      expect(resolved, `seed ${seed} made no real progress`).toBeGreaterThan(20); // a real run, not a 2-turn stub
      expect(isRunOver(s) || resolved >= 400, `seed ${seed} neither ended cleanly nor reached the cap`).toBe(true);
    }
  });

});

// ==============================================================================================
// 3. INFECTION IS A HARDER WAY TO KEEP GOING — the mechanical half (FR-INJ-08); reading half is T49
// ==============================================================================================

describe("M4 exit — infection is a harder way to keep going, not a loss screen (T57 · FR-INJ-08)", () => {
  const at = (s: GameState, stage: InfectionStage, progression: number): GameState => ({
    ...s,
    player: { ...s.player, condition: { ...s.player.condition, infection: { stage, progression } } },
  });
  const statusText = (s: GameState): string => describeStatus(s).join(" ");

  it("reaching terminal does NOT end the run — the survivor is still standing (a cure race opens)", () => {
    const { state } = bootFullCity("t57-infect");
    const terminal = at(state, "terminal", 120); // past terminal onset, before the delayed succumb
    expect(isRunOver(terminal)).toBe(false); // FR-INJ-08: no instant Game Over
    // and it READS as terminal, from symptoms, with no number leaked (the T49 gate, re-touched at the exit)
    const status = statusText(terminal).toLowerCase();
    expect(status).toMatch(/failing|tell what is real/);
    expect(status).not.toContain("120");
    expect(status).not.toContain("progression");
  });

  it("the cure stays on the menu at the worst stage, so the fight is always actionable (no number needed)", () => {
    const { state, graph } = bootFullCity("t57-cure");
    const dying: GameState = {
      ...at(state, "terminal", 120),
      player: { ...state.player, condition: { ...state.player.condition, infection: { stage: "terminal", progression: 120 } }, inventory: [{ type: ANTIBIOTICS_ITEM, quantity: 1 }] },
    };
    expect(availableActions(dying, graph).map((c) => c.id)).toContain("treat-infection");
  });
});
