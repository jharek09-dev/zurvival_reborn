import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  auditTurn,
  availableActions,
  startRun,
  type GameState,
  type NodeDef,
  type RegionDef,
} from "../../engine/src/index.js";
import {
  FOOTER,
  describeChoice,
  describeStatus,
  playSession,
  renderScene,
  transcript,
  UnofferedChoiceError,
} from "../src/index.js";

/**
 * Integration (T19 · FR-UI-01/02/03/05): the story-first single-decision client over *shipped*
 * Rivermouth. A human plays a slice by reading prose and picking a number; the screen shows only
 * critical state, in words, in a fixed region order, and every listed choice is one the engine
 * actually offers.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const opts = { seed: "play-rivermouth", createdAt: "2026-07-05T06:00:00.000Z" };

/** Greedily play a scavenge slice: search where possible, else move, else rest. */
function scavengeScript(state: GameState, graph: ReturnType<typeof startRun>["graph"], n: number): string[] {
  const ids: string[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const choices = availableActions(s, graph);
    const c =
      choices.find((x) => x.id === "search") ??
      choices.find((x) => x.id.startsWith("move:")) ??
      choices.find((x) => x.id === "rest");
    if (!c) break;
    ids.push(c.id);
    s = playSession(s, graph, [c.id]).final;
  }
  return ids;
}

describe("story-first screen shape (T19 · FR-UI-01)", () => {
  it("renders header → status → story → choices → footer in that order", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const scene = playSession(state, graph, []).opening;
    const lines = renderScene(scene, state);
    expect(lines[0]).toMatch(/^Day \d+ · \w+ · \w+ · \d\d:00 · turn \d+$/); // header now surfaces weather (T28 surfacing) // header
    const whatIdx = lines.indexOf("What do you do?");
    expect(whatIdx).toBeGreaterThan(0);
    expect(lines[lines.length - 1]).toBe(FOOTER); // footer last
    // status (a "Pack:" line) appears before the story and the choices.
    const packIdx = lines.findIndex((l) => l.startsWith("Pack:"));
    expect(packIdx).toBeGreaterThan(0);
    expect(packIdx).toBeLessThan(whatIdx);
    // every choice line is numbered and shows its known cost (FR-UI-03).
    for (let i = 0; i < scene.choices.length; i++) {
      expect(lines).toContain(describeChoice(i + 1, scene.choices[i]!));
    }
  });

  it("shows only critical stats, in words, and never an infection number (FR-UI-02)", () => {
    const { state } = startRun(opts, regions, nodes);
    const status = describeStatus(state).join("\n");
    expect(status).toContain("Pack:");
    // A fresh survivor is steady; no bars, no raw need integers besides the pack count.
    expect(status).toMatch(/steady|hungry|thirsty|tired/);
    // infection progression is a hidden number — it must never surface as a value.
    const prog = state.player.condition.infection.progression;
    expect(status).not.toContain(`${prog}`.padStart(2, "0"));
    expect(status.toLowerCase()).not.toContain("infection:");
  });
});

describe("the client presents no fake choices (T19 · FR-UI-03)", () => {
  it("submitting an unoffered choice is rejected", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    expect(() => playSession(state, graph, ["move:node.nowhere"])).toThrow(UnofferedChoiceError);
  });

  it("every rendered choice maps to a real, resolvable action", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const scene = playSession(state, graph, []).opening;
    for (const c of scene.choices) {
      // resolving each offered choice from the opening state must not throw.
      expect(() => playSession(state, graph, [c.id])).not.toThrow();
    }
  });
});

describe("a playable slice over Rivermouth (T19)", () => {
  it("plays a multi-turn scavenge as narrative and every turn moves a system", () => {
    const { state, graph } = startRun(opts, regions, nodes);
    const script = scavengeScript(state, graph, 12);
    expect(script.length).toBeGreaterThan(5);
    const session = playSession(state, graph, script);

    // Each resolved turn changed >= 1 real system (T13 audit holds through the client).
    let prev = session.initial;
    for (const t of session.turns) {
      expect(auditTurn(prev, t.state).ok).toBe(true);
      expect(t.changed.length).toBeGreaterThan(0);
      prev = t.state;
    }
    // The whole run reads as text a human could follow.
    const text = transcript(session).join("\n");
    expect(text).toContain("What do you do?");
    expect(text).toContain("> you chose:");
    // scavenging turned up something, and the pack line reflects a real load.
    expect(session.final.player.inventory.length).toBeGreaterThan(0);
    expect(transcript(session).some((l) => /^Pack: [1-9]/.test(l))).toBe(true);
  });

  it("is deterministic — same seed + script renders identically", () => {
    const a = startRun(opts, regions, nodes);
    const b = startRun(opts, regions, nodes);
    const script = scavengeScript(a.state, a.graph, 10);
    const ta = transcript(playSession(a.state, a.graph, script));
    const tb = transcript(playSession(b.state, b.graph, script));
    expect(ta).toStrictEqual(tb);
  });
});
