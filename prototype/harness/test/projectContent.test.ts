import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOOT_TABLES,
  lootTableFor,
  ITEM_WEIGHTS,
  startRun,
  availableActions,
  projectsActive,
  projectPool,
  projectChoices,
  nextStage,
  projectStageFlag,
  PROJECT_ALARM_CAP,
  PROJECT_ALARM_PER_STAGE,
  STORY_ARCS,
  type ProjectDef,
  type ProjectStageDef,
  type NodeDef,
  type RegionDef,
  type NPCDef,
  type EncounterDef,
  type SignalDef,
  type RecipeDef,
  type JobDef,
  type FactionDef,
  type WeaponDef,
  type GameState,
} from "../../engine/src/index.js";

/**
 * T87 — the SHIPPED terminal projects, and the one guard this task exists because of.
 *
 * The brief asked for a sink for "the resources the economy over-produces and never spends" and named
 * four items. Measured (`measure/t87.ts --ledger-immortal`, 40 immortal runs of 36 days each), three of
 * the four are not surpluses at all: `item.tools` and `item.blanket` are found **0.00 times**, and
 * `item.fuel` 0.03. Their problem is SUPPLY, not sink. A stage priced in one of them would be the T85
 * cistern defect exactly — a fix priced out of reach of the thing it fixes.
 *
 * So the rule this file enforces is not "no rare items". It is the sharper one the measurement
 * produced:
 *
 *   **Every payment a shipped stage accepts must be an item the loot tables can actually produce, and
 *   every stage must have at least one payment in the SPINE — `item.scrap`, the only thing the economy
 *   makes in quantity (6.28 an immortal run, 100% of runs) and the thing a T85 claim hands you 4 of on
 *   the day you take a base.**
 *
 * A rare item on a menu is then free to exist: it is an ALTERNATE, so it gates nothing and is finally
 * worth picking up. That is the whole shape of the fix, held here rather than asserted in prose.
 */

const CONTENT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(CONTENT, sub)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(CONTENT, sub, f), "utf8")) as T);

const PROJECTS = load<ProjectDef>("projects");
const SPINE = "item.scrap";

/** Every item id any loot table can produce, with the radio + economy pools registered (the shipped run). */
const FINDABLE: ReadonlySet<string> = new Set(
  Object.keys(LOOT_TABLES).flatMap((kind) => [...lootTableFor(kind, true, true)]),
);

const everyStage = (): { p: ProjectDef; s: ProjectStageDef }[] => PROJECTS.flatMap((p) => p.stages.map((s) => ({ p, s })));

describe("the shipped projects exist and are a FORK", () => {
  it("ships one escape and one holdout, so the choice is a fork rather than a checklist", () => {
    expect(PROJECTS.length).toBeGreaterThanOrEqual(2);
    expect(PROJECTS.filter((p) => p.kind === "escape").length).toBeGreaterThanOrEqual(1);
    expect(PROJECTS.filter((p) => p.kind === "holdout").length).toBeGreaterThanOrEqual(1);
  });

  it("gives each project 3–4 ordered, uniquely-named stages (the brief's ask)", () => {
    for (const p of PROJECTS) {
      expect(p.stages.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.stages.length, p.id).toBeLessThanOrEqual(4);
      expect(new Set(p.stages.map((s) => s.id)).size, p.id).toBe(p.stages.length);
    }
  });

  it("gives every project an ending in words, and no two the same", () => {
    const endings = PROJECTS.map((p) => p.ending);
    for (const e of endings) expect(e.trim().length).toBeGreaterThan(40);
    expect(new Set(endings).size).toBe(endings.length);
  });
});

describe("REACHABILITY — the guard this task exists because of", () => {
  it("accepts only items the loot tables can actually produce", () => {
    for (const { p, s } of everyStage()) {
      for (const io of s.accepts) {
        expect(FINDABLE.has(io.item), `${p.id}/${s.id} accepts ${io.item}, which NO loot table can produce`).toBe(true);
      }
    }
  });

  it("gives every stage a payment in the SPINE, so no stage can be gated by a rare find", () => {
    for (const { p, s } of everyStage()) {
      const spine = s.accepts.find((io) => io.item === SPINE);
      expect(spine, `${p.id}/${s.id} has no ${SPINE} payment — a rare item is its only way through`).toBeDefined();
      // and the spine price stays inside what a T85 claim plus a run's searching can plausibly cover
      expect(spine!.qty, `${p.id}/${s.id}`).toBeLessThanOrEqual(4);
    }
  });

  it("offers at least two ways to pay for every stage, because the ledger is thin and wide", () => {
    for (const { p, s } of everyStage()) expect(s.accepts.length, `${p.id}/${s.id}`).toBeGreaterThanOrEqual(2);
  });

  it("never prices a stage in a SURVIVAL CONSUMABLE", () => {
    // Measured the hard way: a first cut let the holdout accept food, water or a bandage and a mortal bot
    // won 45% of runs by day 2.3 — because the starting kit IS food and water, so those stages cost
    // nothing. The things that keep you alive are not currency; the player is required to carry them.
    const CONSUMABLE = new Set(["item.canned-food", "item.water", "item.bandage", "item.antibiotics", "item.antiseptic", "item.painkillers", "item.food-fresh"]);
    for (const { p, s } of everyStage()) {
      for (const io of s.accepts) {
        expect(CONSUMABLE.has(io.item), `${p.id}/${s.id} accepts ${io.item} — a survival consumable is free currency`).toBe(false);
      }
    }
  });

  it("finally gives the items nothing ever wanted somewhere to go", () => {
    // The brief's four dead items, plus the two the T85 economy left over. Each must appear on at least
    // one menu somewhere — that is the "sink" half of the task, delivered as an alternate rather than a gate.
    const paid = new Set(everyStage().flatMap(({ s }) => s.accepts.map((io) => io.item)));
    for (const dead of ["item.batteries", "item.lighter", "item.blanket", "item.charcoal", "item.tools", "item.fuel"]) {
      expect(paid.has(dead), `${dead} still has nowhere to go`).toBe(true);
    }
  });

  it("names only items the carry system knows how to weigh", () => {
    for (const { p, s } of everyStage()) {
      for (const io of s.accepts) expect(ITEM_WEIGHTS[io.item], `${p.id}/${s.id} ${io.item}`).toBeTypeOf("number");
    }
  });
});

describe("ESCALATION — every stage raises something, and the total stays inside the cap", () => {
  it("gives every stage either an escalation or a real price in hours", () => {
    for (const { p, s } of everyStage()) {
      const esc = s.escalation;
      const raises = esc !== undefined && ((esc.threat ?? 0) + (esc.survivorActivity ?? 0) + (esc.zombieDensity ?? 0)) > 0;
      expect(raises || s.timeCost >= 4, `${p.id}/${s.id} neither raises anything nor costs real time`).toBe(true);
      expect(s.timeCost, `${p.id}/${s.id}`).toBeGreaterThan(0);
    }
  });

  it("ends every project louder than it starts", () => {
    for (const p of PROJECTS) {
      const weight = (s: ProjectStageDef): number =>
        (s.escalation?.threat ?? 0) + (s.escalation?.survivorActivity ?? 0) + (s.escalation?.zombieDensity ?? 0) + s.timeCost;
      expect(weight(p.stages[p.stages.length - 1]!), p.id).toBeGreaterThan(weight(p.stages[0]!));
    }
  });

  it("the standing alarm a finished project is worth actually reaches the cap", () => {
    // Otherwise PROJECT_ALARM_CAP is dead code, and a dead bound is a bound nobody has tested.
    const most = Math.max(...PROJECTS.map((p) => p.stages.length));
    expect(most * PROJECT_ALARM_PER_STAGE).toBeGreaterThanOrEqual(PROJECT_ALARM_CAP);
  });
});

describe("the shipped pool reaches a real run", () => {
  const boot = (withProjects: boolean): { state: GameState; graph: ReturnType<typeof startRun>["graph"] } =>
    startRun(
      { seed: "t87-content", createdAt: "2026-09-14T00:00:00.000Z" },
      load<RegionDef>("regions"), load<NodeDef>("nodes"), load<NPCDef>("npcs"),
      STORY_ARCS.map((a) => a.id),
      load<EncounterDef>("encounters"), load<SignalDef>("radio"), load<RecipeDef>("recipes"),
      load<JobDef>("jobs"), load<FactionDef>("factions"), load<WeaponDef>("weapons"),
      withProjects ? PROJECTS : [],
    );

  it("is active on the shipped content and dark without it", () => {
    expect(projectsActive(boot(true).graph)).toBe(true);
    expect(projectPool(boot(true).graph).length).toBe(PROJECTS.length);
    expect(projectsActive(boot(false).graph)).toBe(false);
  });

  it("offers every shipped project the moment the player is standing in a base, and only then", () => {
    const { state, graph } = boot(true);
    const here = state.player.location;
    const homeless = { ...state, player: { ...state.player, condition: { ...state.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } } };
    expect(projectChoices(homeless, graph)).toEqual([]);
    const based = { ...homeless, player: { ...homeless.player, shelterId: here } };
    const offered = projectChoices(based, graph).map((c) => c.id);
    expect(offered).toEqual(PROJECTS.map((p) => `project-commit:${p.id}`).sort());
    // the commit rows reach the real Scene, not just the helper
    expect(availableActions(based, graph).map((c) => c.id)).toEqual(expect.arrayContaining(offered));
  });

  it("every first stage is payable out of a T85 claim salvage alone", () => {
    // The claim hands 4 scrap at an ordinary building. If the opening stage cost more than that, the
    // project would begin where the run ends — measured, 95% of settler runs finish stage one on day 2.
    for (const p of PROJECTS) {
      const first = p.stages[0]!;
      const spine = first.accepts.find((io) => io.item === SPINE)!;
      expect(spine.qty, `${p.id} opens at ${spine.qty} scrap`).toBeLessThanOrEqual(4);
    }
  });

  it("nextStage walks each shipped project from its first stage to null", () => {
    const { state, graph } = boot(true);
    for (const p of projectPool(graph)) {
      let s: GameState = state;
      expect(nextStage(s, p)?.id).toBe(p.stages[0]!.id);
      for (const stage of p.stages) {
        expect(nextStage(s, p)?.id).toBe(stage.id);
        s = { ...s, story: { ...s.story, endingFlags: { ...s.story.endingFlags, [projectStageFlag(p.id, stage.id)]: true } } };
      }
      expect(nextStage(s, p)).toBeNull();
    }
  });
});
