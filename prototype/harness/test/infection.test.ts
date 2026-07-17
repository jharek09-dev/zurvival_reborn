import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  sceneOf,
  startRun,
  stageInfo,
  infectionLine,
  resolveInfectionAction,
  INFECTION_STAGES,
  CURE_BY_STAGE,
  QUARANTINE_BY_STAGE,
  ANTIBIOTICS_ITEM,
  DIAGNOSED_FLAG,
  type GameState,
  type Infection,
  type InfectionStage,
  type NodeDef,
  type RegionDef,
  type Wound,
} from "../../engine/src/index.js";
import { describeStatus, renderScene } from "../src/index.js";

/**
 * T49 — the comprehension gate (retires the "infection-as-identity is confusing" tripwire, PRD §10):
 * a player must be able to act on the infection from *symptoms alone*, with the hidden number never
 * shown. Plus a drift-guard binding the shipped `content/infections/` to the engine dials, and a
 * shipped-content play beat proving symptoms and the cure surface through the client.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "infect-harness", createdAt: "2026-07-17T06:00:00.000Z" };
const run = (): { state: GameState; graph: ReturnType<typeof startRun>["graph"] } => startRun(opts, regions, nodes);

const withInf = (s: GameState, infection: Infection): GameState => ({
  ...s,
  player: { ...s.player, condition: { ...s.player.condition, infection } },
});
const withInv = (s: GameState, inv: [string, number][]): GameState => ({
  ...s,
  player: { ...s.player, inventory: inv.map(([type, quantity]) => ({ type, quantity })) },
});
const at = (s: GameState, stage: InfectionStage, progression: number): GameState => withInf(s, { stage, progression });
const statusText = (s: GameState): string => describeStatus(s).join(" ");

// --- the comprehension gate --------------------------------------------------------------------

describe("infection is legible from symptoms alone — no hidden number (T49 · comprehension gate)", () => {
  it("each stage reads with a distinct, recognisable symptom; asymptomatic shows nothing", () => {
    const base = run().state;
    expect(statusText(at(base, "incubating", 12))).not.toMatch(/fever|senses|failing|giving out/i);
    expect(statusText(at(base, "symptomatic", 50))).toMatch(/fever/i);
    expect(statusText(at(base, "advanced", 80))).toMatch(/senses|trust/i);
    expect(statusText(at(base, "terminal", 120))).toMatch(/failing|tell what is real/i);
  });

  it("the three showing stages read DISTINCTLY and ESCALATE (no two alike, terminal ≠ milder)", () => {
    const base = run().state;
    const sym = statusText(at(base, "symptomatic", 50));
    const adv = statusText(at(base, "advanced", 80));
    const ter = statusText(at(base, "terminal", 120));
    expect(new Set([sym, adv, ter]).size).toBe(3); // all three distinct
    // cross-exclusion on each stage's signature phrase — the reads can't be confused for one another.
    expect(sym).toMatch(/fever/i); expect(sym).not.toMatch(/trust your own senses|tell what is real/i);
    expect(adv).toMatch(/senses/i); expect(adv).not.toMatch(/giving out|tell what is real/i);
    expect(ter).toMatch(/failing|giving out|tell what is real/i);
    // the two most-distorted stages BOTH carry the honest "can't trust your senses/what is real" frame,
    // so distrusting the hallucination channel stays legible right through terminal (fairness).
    expect(adv).toMatch(/trust|real/i);
    expect(ter).toMatch(/trust|real/i);
  });

  it("never leaks the hidden number — not in status, not in the scene, not in the diagnosis line", () => {
    const { state, graph } = run();
    const cases: [InfectionStage, number][] = [
      ["incubating", 13],
      ["symptomatic", 57],
      ["advanced", 83],
      ["terminal", 137],
    ];
    for (const [stage, prog] of cases) {
      const s = at(state, stage, prog);
      const status = statusText(s).toLowerCase();
      const scene = sceneOf(s, graph).narration.toLowerCase();
      // a diagnosed read (the opt-in clarity valve) names the stage WORD but still no number.
      const diagnosed = { ...s, player: { ...s.player, flags: { ...s.player.flags, [DIAGNOSED_FLAG]: true } } };
      const diag = (infectionLine(diagnosed) ?? "").toLowerCase();
      for (const text of [status, scene, diag]) {
        expect(text).not.toContain(String(prog));
        expect(text).not.toContain("progression");
        expect(text).not.toMatch(/\binfection\b\s*[:=]/);
      }
    }
  });

  it("offers an actionable response the moment symptoms show, so no decision needs the number", () => {
    const { state, graph } = run();
    // symptomatic + antibiotics ⇒ the cure is on the menu; the player acts on the fever, not a number.
    const sick = withInv(at(state, "symptomatic", 50), [[ANTIBIOTICS_ITEM, 1]]);
    expect(availableActions(sick, graph).map((c) => c.id)).toContain("treat-infection");
  });

  it("a cure at symptomatic drops the stage and removes the fever line — 'the cure pulls you back' is felt", () => {
    const { state, graph } = run();
    const sick = withInv(at(state, "symptomatic", 45), [[ANTIBIOTICS_ITEM, 1]]);
    expect(statusText(sick)).toMatch(/fever/i);
    const cured = resolveInfectionAction(sick, { type: "treat-infection", choiceId: "treat-infection" });
    expect(cured.player.condition.infection.stage).not.toBe("symptomatic"); // reversed
    expect(statusText(cured)).not.toMatch(/fever/i); // the symptom read is gone — legible relief
    // and the scene tells you it worked, in words, no number.
    const scene = renderScene(sceneOf(cured, graph), cured).join(" ");
    expect(scene.toLowerCase()).toMatch(/fever (breaks|loosens)/i);
  });

  it("keeps the whole infection channel out of a healthy run's status", () => {
    expect(statusText(run().state)).not.toMatch(/fever|infection|senses|failing/i);
  });
});

// --- the content ↔ engine drift guard ----------------------------------------------------------

describe("shipped content/infections mirrors the engine dials (T49 · drift guard)", () => {
  interface StageDef {
    readonly key: InfectionStage;
    readonly symptom?: string;
    readonly sign?: string;
    readonly cure: { readonly amount: number; readonly partial: number; readonly certaintyPercent: number };
    readonly quarantine: number;
  }
  const def = JSON.parse(
    readFileSync(join(contentDir, "infections", "infection.bite.json"), "utf8"),
  ) as { readonly stages: readonly StageDef[] };

  it("stage keys and order match INFECTION_STAGES", () => {
    expect(def.stages.map((s) => s.key)).toEqual(INFECTION_STAGES.map((s) => s.key));
  });

  it("symptom + sign prose match the engine per stage (asymptomatic carries neither)", () => {
    for (const cs of def.stages) {
      const es = stageInfo(cs.key)!;
      expect(cs.symptom ?? null).toBe(es.symptom);
      expect(cs.sign ?? null).toBe(es.sign);
    }
  });

  it("cure (amount/partial/certainty) + quarantine dials match the engine per stage", () => {
    for (const cs of def.stages) {
      const cure = CURE_BY_STAGE[cs.key];
      expect(cs.cure.amount).toBe(cure.amount);
      expect(cs.cure.partial).toBe(cure.partial);
      expect(cs.cure.certaintyPercent).toBe(Math.round(cure.certainty * 100));
      expect(cs.quarantine).toBe(QUARANTINE_BY_STAGE[cs.key]);
    }
  });
});

// --- a shipped-content play beat ---------------------------------------------------------------

describe("a bite-driven run surfaces staged symptoms + the cure through the client (T49)", () => {
  it("symptoms appear in the rendered status and the cure is offered once they show", () => {
    const boot = run();
    const bite: Wound = { type: "wound.bite", site: "forearm", severity: 40, treated: 0, inflictedDay: 1 };
    let cur: GameState = {
      ...boot.state,
      player: {
        ...boot.state.player,
        condition: { ...boot.state.player.condition, wounds: [bite] },
        inventory: [
          { type: "item.water", quantity: 40 },
          { type: ANTIBIOTICS_ITEM, quantity: 2 },
        ],
      },
    };
    let sawSymptom = false;
    let sawCureOffer = false;
    for (let i = 0; i < 40 && !(sawSymptom && sawCureOffer); i++) {
      const choices = availableActions(cur, boot.graph);
      if (choices.some((c) => c.id === "treat-infection")) sawCureOffer = true;
      if (/fever|senses|failing|giving out/i.test(statusText(cur))) sawSymptom = true;
      const c = choices.find((x) => x.id === "drink") ?? choices.find((x) => x.id === "rest");
      if (!c) break;
      cur = applyAction(cur, c.action, boot.graph).state;
    }
    expect(sawSymptom).toBe(true);
    expect(sawCureOffer).toBe(true);
  });
});
