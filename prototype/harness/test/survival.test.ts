import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  isRunOver,
  runEndReason,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";
import { playSession, renderScene, runEnded, transcript } from "../src/index.js";

/**
 * Integration (T22): survival pressure over *shipped* Rivermouth through the client. Needs become
 * pressing, the pack's water/food are the counterplay, and a heedless run actually ends — the loop
 * has stakes turn to turn.
 */
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "surv-rivermouth", createdAt: "2026-07-05T06:00:00.000Z" };

describe("survival loop over Rivermouth (T22)", () => {
  it("a heedless run (never drink/eat) ends — neglect is fatal", () => {
    let { state, graph } = startRun(opts, regions, nodes);
    let ended = false;
    for (let i = 0; i < 100; i++) {
      const choices = availableActions(state, graph);
      if (choices.length === 0) { ended = true; break; }
      // deliberately careless: search/move/rest, never drink or eat.
      const c = choices.find((x) => x.id === "search") ?? choices.find((x) => x.id.startsWith("move:")) ?? choices.find((x) => x.id === "rest") ?? choices[0]!;
      state = applyAction(state, c.action, graph).state;
    }
    expect(ended).toBe(true);
    expect(isRunOver(state)).toBe(true);
    expect(runEndReason(state)).not.toBeNull();
    // the client renders the death as a scene with a narration and no choices.
    const scene = playSession(state, graph, []).opening;
    expect(scene.choices).toEqual([]);
    expect(renderScene(scene, state).join("\n")).toMatch(/city keeps|thirst won|fever/i);
  });

  it("managing needs (drink/eat when offered) outlasts neglecting them", () => {
    const playUntilOver = (smart: boolean): number => {
      let { state, graph } = startRun(opts, regions, nodes);
      let turns = 0;
      for (let i = 0; i < 120; i++) {
        const c = availableActions(state, graph);
        if (c.length === 0) break;
        const pick = smart
          ? c.find((x) => x.id === "drink") ?? c.find((x) => x.id === "eat") ?? c.find((x) => x.id === "search") ?? c.find((x) => x.id.startsWith("move:")) ?? c.find((x) => x.id === "rest") ?? c[0]!
          : c.find((x) => x.id === "search") ?? c.find((x) => x.id.startsWith("move:")) ?? c.find((x) => x.id === "rest") ?? c[0]!;
        state = applyAction(state, pick.action, graph).state;
        turns++;
      }
      return turns;
    };
    expect(playUntilOver(true)).toBeGreaterThan(playUntilOver(false)); // care buys survival
  });

  it("the status line shows needs in words and offers water once thirsty", () => {
    let { state, graph } = startRun(opts, regions, nodes);
    // play until thirst is pressing.
    for (let i = 0; i < 10 && state.player.condition.needs.thirst < 34; i++) {
      const c = availableActions(state, graph).find((x) => x.id === "search") ?? availableActions(state, graph)[0]!;
      state = applyAction(state, c.action, graph).state;
    }
    const session = playSession(state, graph, []);
    const status = renderScene(session.opening, state).join("\n");
    expect(status.toLowerCase()).toMatch(/thirsty|parched|dehydrated/); // in words, not a bar
    expect(availableActions(state, graph).some((x) => x.id === "drink")).toBe(true); // water is the counterplay
    expect(runEnded(session)).toBe(false);
  });
});
