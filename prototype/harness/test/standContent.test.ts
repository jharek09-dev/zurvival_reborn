import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAction,
  availableActions,
  startRun,
  runEndReason,
  sceneOf,
  standIsOpen,
  standReason,
  standChoices,
  standsActive,
  standPool,
  standTaken,
  standActLine,
  endingShape,
  assembleEnding,
  opensStand,
  ENDING_SHAPES,
  RUN_END_REASONS,
  STAND_REQUIREMENT_KEYS,
  STAND_ACT_LIMIT,
  STAND_CHOICE_PREFIX,
  STAND_FLOOR_ID,
  STORY_ARCS,
  type GameState,
  type RegionGraph,
  type StandDef,
  type NodeDef,
  type RegionDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type WeaponDef,
  type ProjectDef,
  type EndingDef,
} from "../../engine/src/index.js";

/**
 * T62 — the SHIPPED stand content, and the three-way drift guard over it.
 *
 * The engine's own suite proves the mechanism against fixtures. This file proves the thing fixtures
 * cannot: that `content/stands/`, `content/schemas/stand.schema.json` and the engine's
 * `STAND_REQUIREMENT_KEYS` are the same vocabulary, and that the shipped set actually behaves in a real
 * city. It is the T81 content drift-guard idiom, and it exists because **neither shipping client runs
 * the schema at boot** — `playCli.ts` and `web/build-html.mjs` are bare `JSON.parse`.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CONTENT = join(ROOT, "content");
const load = <T>(sub: string): T[] => {
  let files: string[];
  try { files = readdirSync(join(CONTENT, sub)); } catch { return []; }
  return files.filter((f) => f.endsWith(".json")).sort()
    .map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);
};

const STANDS = load<StandDef>("stands");
const ENDINGS = load<EndingDef>("endings");
const SCHEMA = JSON.parse(readFileSync(join(CONTENT, "schemas", "stand.schema.json"), "utf8")) as {
  properties: { reasons: { items: { enum: string[] } }; acts: { items: { properties: Record<string, unknown> } } };
  $defs: { requirement: { properties: Record<string, unknown> } };
};

function city(seed: string): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-14T00:00:00.000Z" },
    load<RegionDef>("regions"), load<NodeDef>("nodes"), load<NPCDef>("npcs"),
    STORY_ARCS.map((a) => a.id),
    load<EncounterDef>("encounters"), load<SignalDef>("radio"), load<RecipeDef>("recipes"),
    load<JobDef>("jobs"), load<FactionDef>("factions"), load<WeaponDef>("weapons"),
    load<ProjectDef>("projects"), ENDINGS, STANDS,
  );
}

// --- 1. the three-way vocabulary guard ------------------------------------------------------------

describe("the schema, the engine and the content are one vocabulary", () => {
  it("the schema's requirement keys and the engine's canonical list are the SAME set, both ways", () => {
    expect([...Object.keys(SCHEMA.$defs.requirement.properties)].sort())
      .toEqual([...STAND_REQUIREMENT_KEYS].sort());
  });

  it("every `when` key in shipped content is one the engine reads", () => {
    for (const def of STANDS) {
      for (const act of def.acts) {
        for (const key of Object.keys(act.when ?? {})) {
          expect(STAND_REQUIREMENT_KEYS, `${def.id}/${act.id} tests "${key}"`).toContain(key);
        }
      }
    }
  });

  it("the schema permits exactly the four DEATHS as reasons — never a win", () => {
    const permitted = SCHEMA.properties.reasons.items.enum;
    expect([...permitted].sort()).toEqual([...RUN_END_REASONS].filter(opensStand).sort());
    for (const r of permitted) expect(opensStand(r as never)).toBe(true);
  });

  it("the schema's `shape` enum is the engine's shape list", () => {
    const shape = SCHEMA.properties.acts.items.properties["shape"] as { enum: string[] };
    expect([...shape.enum].sort()).toEqual([...ENDING_SHAPES].sort());
  });
});

// --- 2. the shipped set ---------------------------------------------------------------------------

describe("the shipped content/stands/ set", () => {
  it("covers every death a run can have, and each exactly once", () => {
    const covered = STANDS.flatMap((d) => d.reasons);
    const deaths = RUN_END_REASONS.filter(opensStand);
    expect([...covered].sort()).toEqual([...deaths].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });

  it("every def authors an opening and more acts than the cap, so the cap can bind", () => {
    for (const def of STANDS) {
      expect(def.opening.trim().length, def.id).toBeGreaterThan(8);
      expect(def.acts.length, `${def.id} authors ${def.acts.length} acts against a cap of ${STAND_ACT_LIMIT}`)
        .toBeGreaterThan(STAND_ACT_LIMIT);
    }
  });

  it("no act shadows the engine's floor act, and ids are unique within a def", () => {
    for (const def of STANDS) {
      const ids = def.acts.map((a) => a.id);
      expect(new Set(ids).size, def.id).toBe(ids.length);
      expect(ids).not.toContain(STAND_FLOOR_ID);
    }
  });

  it("every act has a label, prose and a finite weight", () => {
    for (const def of STANDS) {
      for (const act of def.acts) {
        expect(act.label.trim(), `${def.id}/${act.id}`).not.toBe("");
        expect(act.text.trim(), `${def.id}/${act.id}`).not.toBe("");
        expect(Number.isFinite(act.weight), `${def.id}/${act.id} weight`).toBe(true);
      }
    }
  });

  it("an act with effect `kill` always requires a fight, so it can never fire in a quiet death", () => {
    for (const def of STANDS) {
      for (const act of def.acts) {
        if ((act as { effect?: string }).effect !== "kill") continue;
        expect(act.when?.requiresCombat, `${def.id}/${act.id} kills without requiring combat`).toBe(true);
      }
    }
  });

  it("every declared shape is one the ENDING pool actually authors", () => {
    const authored = new Set(ENDINGS.map((e) => e.shape));
    for (const def of STANDS) {
      for (const act of def.acts) {
        const shape = (act as { shape?: string }).shape;
        if (shape === undefined) continue;
        expect(ENDING_SHAPES, `${def.id}/${act.id}`).toContain(shape);
        expect(authored, `${def.id}/${act.id} claims "${shape}", which content/endings/ does not author`).toContain(shape);
      }
    }
  });

  it("a gate measured at zero is authored deliberately — and there are only the two the task declared", () => {
    // PL-M5-71's shape: acts waiting on a person. `minCompanions` measured 0.00 in 102 stands and
    // `minMet` 0.00, so these light up the day T59/T60 move the mortality curve and not before. The
    // test pins the COUNT, so a third dead gate cannot be added without someone deciding to.
    const dead = STANDS.flatMap((d) => d.acts.filter((a) => a.when?.minCompanions !== undefined || a.when?.minMet !== undefined));
    expect(dead.map((a) => a.id).sort()).toEqual(["hold-the-door", "say-it", "say-it", "say-it", "say-it"]);
  });
});

// --- 3. the shipped set in a real city ------------------------------------------------------------

describe("the shipped set, driven through real runs", () => {
  /** Play until the run stops, answering any stand with the first act offered. */
  function play(seed: string, actions = 400): { state: GameState; graph: RegionGraph; menus: string[][] } {
    let { state, graph } = city(seed);
    let rng = 17;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng % n; };
    const menus: string[][] = [];
    for (let k = 0; k < actions; k += 1) {
      if (runEndReason(state) !== null) break;
      const choices = availableActions(state, graph);
      if (choices.length === 0) break;
      if (standIsOpen(state)) menus.push(choices.map((c) => c.id));
      const pick = choices.find((c) => c.id.startsWith("break")) ?? choices.find((c) => c.id.startsWith("strike"))
        ?? choices.find((c) => c.id.startsWith("drink")) ?? choices[rand(choices.length)]!;
      const before = state;
      state = applyAction(state, pick.action, graph).state;
      if (state === before) break;
    }
    return { state, graph, menus };
  }

  const RUNS = Array.from({ length: 12 }, (_, i) => play(`stand-content-${i}`));

  it("the pool is registered and the run is armed", () => {
    const { state, graph } = city("armed");
    expect(standsActive(graph)).toBe(true);
    expect(standPool(graph)).toHaveLength(STANDS.length);
    expect(state.story.endingFlags["stand.armed"]).toBe(true);
  });

  it("every run that ended, ended in a DEATH the player answered — none on a card", () => {
    const finished = RUNS.filter((r) => runEndReason(r.state) !== null);
    expect(finished.length).toBeGreaterThan(6);
    for (const r of finished) {
      expect(r.menus.length, `run offered ${r.menus.length} stands`).toBe(1);
      expect(standTaken(r.state.history), "a finished run took an act").not.toBeNull();
    }
  });

  it("every menu offered the floor act, and never more than the cap plus it", () => {
    for (const r of RUNS) {
      for (const menu of r.menus) {
        expect(menu).toContain(`${STAND_CHOICE_PREFIX}${STAND_FLOOR_ID}`);
        expect(menu.length).toBeGreaterThan(0);
        expect(menu.length).toBeLessThanOrEqual(STAND_ACT_LIMIT + 1);
        expect(menu.every((id) => id.startsWith(STAND_CHOICE_PREFIX))).toBe(true);
      }
    }
  });

  it("a finished run offers nothing further, and closes on words", () => {
    for (const r of RUNS.filter((x) => runEndReason(x.state) !== null)) {
      expect(availableActions(r.state, r.graph)).toEqual([]);
      const scene = sceneOf(r.state, r.graph);
      expect(scene.choices).toEqual([]);
      expect(scene.narration.trim()).not.toBe("");
    }
  });

  it("the act taken is printed in the closing text, verbatim — in THIS death's words", () => {
    for (const r of RUNS.filter((x) => runEndReason(x.state) !== null)) {
      const taken = standTaken(r.state.history)!;
      expect(taken.reason, "the beat records which death it was taken against").toBe(runEndReason(r.state));
      const line = standActLine(r.graph, taken.act, taken.reason);
      expect(line, `no prose for act "${taken.act}"`).not.toBeNull();
      expect(sceneOf(r.state, r.graph).narration).toContain(line!);
    }
  });

  it("the four files' shared act ids each carry their OWN prose, and the lookup finds it", () => {
    // Three ids are authored in every file — `leave-what-you-carry`, `leave-the-mark`, `say-it` — with
    // different words, because leaving your pack reads differently when you are bleeding out than when
    // you have been out of water for a day. Before the audit the lookup scanned the pool and took the
    // first hit, so ten of the eighteen authored texts could never print.
    const byId = new Map<string, Set<string>>();
    for (const def of STANDS) for (const act of def.acts) {
      if (!byId.has(act.id)) byId.set(act.id, new Set());
      byId.get(act.id)!.add(act.text);
    }
    const shared = [...byId].filter(([, texts]) => texts.size > 1);
    expect(shared.length, "the shipped set authors per-death prose for at least three acts").toBeGreaterThanOrEqual(3);
    const { graph } = city("shared-ids");
    for (const def of STANDS) {
      for (const act of def.acts) {
        for (const reason of def.reasons) {
          expect(standActLine(graph, act.id, reason), `${def.id}/${act.id} under ${reason}`).toBe(act.text);
        }
      }
    }
  });

  it("the shipped set reaches the `sacrifice` shape T61 could not reach at all", () => {
    const shapes = new Set(RUNS.filter((r) => runEndReason(r.state) !== null).map((r) => endingShape(r.state, r.graph)));
    expect(shapes.size, `only saw ${[...shapes].join(", ")}`).toBeGreaterThan(1);
  });

  it("no closing text contains a double space or a stray leading space", () => {
    for (const r of RUNS.filter((x) => runEndReason(x.state) !== null)) {
      const n = sceneOf(r.state, r.graph).narration;
      expect(n, "double space in the closing text").not.toMatch(/ {2}/);
      expect(n).toBe(n.trim());
    }
  });
});
