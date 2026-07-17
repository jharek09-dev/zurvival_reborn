import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  applyAction,
  availableActions,
  activeEncounter,
  phaseOf,
  encounterFires,
  summarizeRepetition,
  RECENCY_WINDOW_HOURS,
  VERBATIM_REPEAT_TARGET,
  ENCOUNTER_CATEGORIES,
  type EncounterDef,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";

/**
 * T48 — the PRD §4 encounter-variety HARD GATE (FR-ENC-01/02 · FR-CNT-04). Registers the full shipped
 * pool and drives a deterministic full-run-length sweep of the city over ~50 days, then asserts verbatim
 * encounter repetition sits under the §4 target (< 5%) — the "measured, not guessed" gate. Also proves the
 * Rule of Three at significant locations and guards the T48 content dials (cooldown ≥ window, valid tags).
 *
 * The sweep is synthetic navigation (it places the survivor on each node in turn across advancing days,
 * keeping the run alive) so the thing under test is the real engine SELECTION path — stage-13
 * chooseEncounter, its cooldowns-from-history and weighted `encounter`-stream pick — over a full run's
 * worth of quiet-node opportunities, isolated from combat/attrition. Fully deterministic from the seed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const loadDefs = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = loadDefs<RegionDef>("regions");
const nodes = loadDefs<NodeDef>("nodes");
const npcs = loadDefs<NPCDef & { homeNode?: string }>("npcs");
const encounters = loadDefs<EncounterDef>("encounters");

/** A deterministic full-run-length sweep: every node, in id order, over ~4h steps for `steps` visits. */
function sweepCity(steps: number): GameState {
  const { state: s0, graph } = startRun({ seed: "t48-repeat-gate", createdAt: "2026-07-17T00:00:00Z" }, regions, nodes, npcs, [], encounters) as { state: GameState; graph: RegionGraph };
  const tour = Object.keys(graph.nodes).sort();
  let s = s0;
  let absH = 6;
  for (let step = 0; step < steps; step++) {
    absH += 4;
    const nodeId = tour[step % tour.length]!;
    const node = s.nodes[nodeId]!;
    s = {
      ...s,
      meta: { ...s.meta, day: 1 + Math.floor(absH / 24), hour: absH % 24, phase: phaseOf(absH % 24), turn: s.meta.turn + 1 },
      combat: null,
      player: {
        ...s.player,
        location: nodeId,
        // keep the run alive + stress up so the night beat can fit; this is a selection probe, not survival
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
  return s;
}

describe("§4 encounter-variety gate — verbatim repeats stay under target across a full run (T48)", () => {
  const final = sweepCity(320);
  const summary = summarizeRepetition(encounterFires(final));

  it("fires enough encounters for the gate to be meaningful (a full run's worth)", () => {
    expect(summary.fires).toBeGreaterThanOrEqual(40);
  });

  it("verbatim repeat rate is under the PRD §4 target (< 5%)", () => {
    expect(summary.verbatimRepeatRate).toBeLessThan(VERBATIM_REPEAT_TARGET);
  });

  it("no encounter repeats back-to-back", () => {
    expect(summary.immediateRepeats).toBe(0);
  });

  it("the weighting spreads load — many distinct encounters, none dominating", () => {
    expect(summary.distinct).toBeGreaterThanOrEqual(12);
    expect(summary.maxSingleShare).toBeLessThanOrEqual(0.25);
  });

  it("the mix spans several categories (a healthy FR-ENC-05 spread)", () => {
    expect(Object.keys(summary.byCategory).length).toBeGreaterThanOrEqual(4);
  });
});

describe("Rule of Three — significant locations support ≥3 approaches/outcomes (T48 · FR-CNT-04)", () => {
  it("every encounter-anchored location offers ≥3 approaches across its encounters", () => {
    const choicesAt: Record<string, number> = {};
    const encsAt: Record<string, string[]> = {};
    for (const e of encounters) {
      const choices = e.stages.reduce((a, s) => a + s.choices.length, 0);
      for (const n of e.requirements?.nodeIds ?? []) {
        choicesAt[n] = (choicesAt[n] ?? 0) + choices;
        (encsAt[n] ??= []).push(e.id);
      }
    }
    const anchors = Object.keys(choicesAt);
    expect(anchors.length).toBeGreaterThan(0);
    for (const n of anchors) expect(choicesAt[n], `${n} offers only ${choicesAt[n]} approaches [${encsAt[n]!.join(", ")}]`).toBeGreaterThanOrEqual(3);
  });

  it("the base (any claimed safehouse) offers ≥3 approaches via the shelter-gated encounters", () => {
    const shelterChoices = encounters
      .filter((e) => e.requirements?.requiresShelter === true)
      .reduce((a, e) => a + e.stages.reduce((b, s) => b + s.choices.length, 0), 0);
    expect(shelterChoices).toBeGreaterThanOrEqual(3);
  });
});

describe("T48 content dials — the anti-repeat contract holds for every ambient encounter", () => {
  const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const repeatables = encounters.filter((e) => e.repeatable === true);

  it("ships a demonstrator ambient pool (≥10 repeatable encounters)", () => {
    expect(repeatables.length).toBeGreaterThanOrEqual(10);
  });

  it("every repeatable has a cooldown ≥ the recency window and at least one kebab-case tag", () => {
    for (const e of repeatables) {
      expect(typeof e.cooldownHours, `${e.id} missing cooldownHours`).toBe("number");
      expect(e.cooldownHours!, `${e.id} cooldown ${e.cooldownHours} < window ${RECENCY_WINDOW_HOURS}`).toBeGreaterThanOrEqual(RECENCY_WINDOW_HOURS);
      expect(Array.isArray(e.tags) && e.tags!.length > 0, `${e.id} needs ≥1 tag`).toBe(true);
      for (const t of e.tags ?? []) expect(KEBAB.test(t), `${e.id} tag "${t}" not kebab-case`).toBe(true);
      if (e.weight !== undefined) {
        expect(Number.isInteger(e.weight)).toBe(true);
        expect(e.weight).toBeGreaterThanOrEqual(1);
        expect(e.weight).toBeLessThanOrEqual(1000);
      }
      expect(ENCOUNTER_CATEGORIES).toContain(e.category);
    }
  });

  it("tags cluster (recombination): at least one tag is shared by ≥2 encounters", () => {
    const perTag: Record<string, number> = {};
    for (const e of repeatables) for (const t of e.tags ?? []) perTag[t] = (perTag[t] ?? 0) + 1;
    expect(Object.values(perTag).some((n) => n >= 2)).toBe(true);
  });
});
