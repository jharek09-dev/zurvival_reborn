import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
  type Wound,
} from "../../engine/src/index.js";
import {
  SCREEN_REGION_ORDER,
  FOOTER,
  parseCommand,
  playByInputs,
  playSession,
  renderRegions,
  renderScene,
  transcript,
} from "../src/index.js";

/**
 * T20 — accessibility baseline (NFR-ACC-01/02). The first client is text end to end; this proves the
 * text carries every critical fact on its own (no color/audio), keeps a stable navigable region
 * order across turn types, and is fully playable with number keys alone.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "a11y-rivermouth", createdAt: "2026-07-05T06:00:00.000Z" };
const base = () => startRun(opts, regions, nodes);

// --- derive the four turn types from one start --------------------------------------------
const overweight = (s: GameState): GameState => ({
  ...s,
  player: { ...s.player, inventory: [{ type: "item.pistol", quantity: 5 }] }, // 5*8 = 40 = full
});
const wounded = (s: GameState): GameState => {
  const w: Wound = { type: "wound.laceration", site: "left arm", severity: 40, treated: 0, inflictedDay: 1 };
  return { ...s, player: { ...s.player, condition: { ...s.player.condition, wounds: [w] } } };
};
const threatened = (s: GameState): GameState => {
  const here = s.player.location;
  return { ...s, nodes: { ...s.nodes, [here]: { ...s.nodes[here]!, walkers: 2 } } };
};

// --- NFR-ACC-01: the plain text carries everything -----------------------------------------

describe("critical info is in the text, no color or audio (T20 · NFR-ACC-01)", () => {
  it("renders zero ANSI escape codes — meaning never rides on color", () => {
    const { state, graph } = base();
    for (const mk of [(x: GameState) => x, overweight, wounded, threatened]) {
      const s = mk(state);
      const text = renderScene(playSession(s, graph, []).opening, s).join("\n");
      expect(text).not.toMatch(/\x1b\[/); // no CSI sequences at all
    }
  });

  it("a full pack states the leave-behind in words, and offers a drop", () => {
    const { state, graph } = base();
    const s = overweight(state);
    const scene = playSession(s, graph, []).opening;
    const status = renderRegions(scene, s).status.join(" ");
    expect(status.toLowerCase()).toContain("full");
    expect(status.toLowerCase()).toContain("leave");
    expect(scene.choices.some((c) => c.id.startsWith("drop:"))).toBe(true);
  });

  it("an active wound is named in words, not a bar", () => {
    const { state, graph } = base();
    const s = wounded(state);
    const status = renderRegions(playSession(s, graph, []).opening, s).status.join(" ");
    expect(status).toContain("laceration");
    expect(status).toContain("left arm");
    expect(status).toContain("untreated");
  });

  it("a threat states both the danger and the way out (a stealth path exists)", () => {
    const { state, graph } = base();
    const s = threatened(state);
    const story = renderRegions(playSession(s, graph, []).opening, s).story.join(" ");
    expect(story.toLowerCase()).toContain("walker");
    expect(story.toLowerCase()).toContain("slip away");
  });

  it("every offered choice shows its known cost in the line (FR-UI-03)", () => {
    const { state, graph } = base();
    const scene = playSession(state, graph, []).opening;
    const choiceLines = renderRegions(scene, state).choices;
    for (const line of choiceLines) expect(line).toMatch(/\((\d+h|free)\)$/);
  });
});

// --- NFR-ACC-02: stable, navigable structure -----------------------------------------------

describe("stable navigable region order across turn types (T20 · NFR-ACC-02)", () => {
  it("every turn type renders header first, footer last, and all regions present", () => {
    const { state, graph } = base();
    for (const mk of [(x: GameState) => x, overweight, wounded, threatened]) {
      const s = mk(state);
      const scene = playSession(s, graph, []).opening;
      const r = renderRegions(scene, s);
      for (const region of SCREEN_REGION_ORDER) expect(r[region].length).toBeGreaterThan(0);
      const lines = renderScene(scene, s);
      expect(lines[0]).toBe(r.header[0]); // header first
      expect(lines[lines.length - 1]).toBe(FOOTER); // footer last
      // fixed order: status before story before the prompt before the choices.
      const idx = (needle: string) => lines.findIndex((l) => l.includes(needle));
      expect(idx("Pack:")).toBeLessThan(idx(r.story[0]!.slice(0, 12)));
      expect(idx(r.story[0]!.slice(0, 12))).toBeLessThan(idx("What do you do?"));
    }
  });
});

// --- keyboard-only play --------------------------------------------------------------------

describe("keyboard-only play — number keys, no pointer, no timing (T20 · NFR-ACC-02)", () => {
  it("parses number selections and the save/quit keys", () => {
    const { state, graph } = base();
    const scene = playSession(state, graph, []).opening;
    expect(parseCommand(scene, "1")).toEqual({ kind: "choice", choiceId: scene.choices[0]!.id });
    expect(parseCommand(scene, " 2 ")).toEqual({ kind: "choice", choiceId: scene.choices[1]!.id });
    expect(parseCommand(scene, "S").kind).toBe("save");
    expect(parseCommand(scene, "q").kind).toBe("quit");
    expect(parseCommand(scene, "999").kind).toBe("invalid");
    expect(parseCommand(scene, "x").kind).toBe("invalid");
  });

  it("a run of number keys plays the same slice as the equivalent choice script", () => {
    const { state, graph } = base();
    // choose #3 (search), then #3 again, then #1 (a move) — as a human would type them.
    const inputs = ["3", "3", "1"];
    const byKeys = playByInputs(state, graph, inputs);
    expect(byKeys.stopped).toBe("end-of-input");
    // reconstruct the same choice ids by parsing against each successive scene.
    let s = state;
    const ids: string[] = [];
    for (const raw of inputs) {
      const scene = playSession(s, graph, []).opening;
      const cmd = parseCommand(scene, raw);
      if (cmd.kind !== "choice") continue;
      ids.push(cmd.choiceId);
      s = playSession(s, graph, [cmd.choiceId]).final;
    }
    expect(transcript(byKeys.session)).toStrictEqual(transcript(playSession(state, graph, ids)));
    expect(byKeys.session.turns.length).toBe(3);
  });

  it("the S key stops play with a save intent (quit/resume seam, feeds T21)", () => {
    const { state, graph } = base();
    const r = playByInputs(state, graph, ["3", "s", "3"]);
    expect(r.stopped).toBe("save");
    expect(r.session.turns.length).toBe(1); // only the pre-save turn resolved
  });
});
