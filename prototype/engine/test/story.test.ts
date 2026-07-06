import { describe, expect, it } from "vitest";
import {
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  saveGame,
  loadGame,
  registerArcs,
  activeArcs,
  arcBeat,
  evaluateArcs,
  storyChoices,
  resolveStoryAction,
  resolveDueStoryEvents,
  storyLine,
  stashUnits,
  canParley,
  PARLEY_MIN,
  THE_LAST_CUSTOMER,
  ARC_DORMANT,
  ARC_PLEA,
  ARC_HELPED,
  ARC_REFUSED,
  ARC_RESOLVED_GOOD,
  ARC_RESOLVED_COLD,
  STORY_EVENT_KIND,
  type GameState,
  type NPCState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "../src/index.js";

/**
 * T40 — First authored story arc (FR-STORY-01): "The Last Customer". A deterministic trigger chain — a
 * survivor in trouble at your base → a costed choice → a rippling consequence — over story.progress +
 * queue (reserved, no rung). Opt-in per run, so every prior golden is inert. Reproducible from a seed,
 * append-only into the Living History, save-lossless.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x", baseline: { loot: 50 } }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];
const opts = { seed: "story-seed", createdAt: "2026-07-06T00:00:00Z" };
const ARC = THE_LAST_CUSTOMER.id;
const SUBJ = THE_LAST_CUSTOMER.subject;
const HERE = "node.x.a";

const run = (arcs: readonly string[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, [], arcs);

const withShelter = (s: GameState, id: string | null): GameState => ({ ...s, player: { ...s.player, shelterId: id as GameState["player"]["shelterId"] } });
const withStash = (s: GameState, stash: GameState["player"]["stash"]): GameState => ({ ...s, player: { ...s.player, stash } });
const ruth = (over: Partial<NPCState> = {}): NPCState => ({
  id: SUBJ, type: SUBJ, name: "Ruth", disposition: "desperate",
  needs: { hunger: 70, thirst: 70, fatigue: 40 }, location: "node.x.b",
  alive: true, met: true, trust: 35, ...over,
});
const withRuth = (s: GameState, over: Partial<NPCState> = {}): GameState => ({ ...s, npcs: { ...s.npcs, [SUBJ]: ruth(over) } });
const ids = (cs: readonly { id: string }[]): string[] => cs.map((c) => c.id);
const take = (s: GameState, g: RegionGraph, id: string) => {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (!c) throw new Error(`choice "${id}" not offered; got: ${ids(availableActions(s, g)).join(",")}`);
  return applyAction(s, c.action, g);
};
// A base with Ruth met, in trouble, the arc registered, and a stocked cache — one plea away.
const atThreshold = (stashUnitsN = 3): GameState =>
  withStash(withRuth(withShelter(registerArcs(run().state, [ARC]), HERE)), Array.from({ length: stashUnitsN }, () => ({ type: "item.canned-food", quantity: 1 })));

// --- opt-in: inert unless registered ----------------------------------------------------------

describe("an arc is opt-in — every prior (unregistered) run is inert (T40)", () => {
  it("a run that registers no arc has no active arcs and never touches story/queue", () => {
    const { state, graph } = run();
    expect(activeArcs(state)).toEqual([]);
    let s = state;
    for (const id of ["search", "search", "search", "rest"]) s = take(s, graph, id).state;
    expect(s.story.progress).toEqual({});
    expect(s.queue).toEqual([]);
    expect(evaluateArcs(s)).toBe(s); // the stage-13 body is a strict no-op with no arc
  });

  it("registering seeds the arc dormant in story.progress", () => {
    const { state } = run([ARC]);
    expect(activeArcs(state)).toContain(ARC);
    expect(arcBeat(state, ARC)).toBe(ARC_DORMANT);
  });
});

// --- the plea trigger (stage 13) --------------------------------------------------------------

describe("the plea fires only when the world has set the stage (T40)", () => {
  it("does not fire without a shelter, without meeting her, or before she is in trouble", () => {
    const base = withRuth(withShelter(registerArcs(run().state, [ARC]), HERE));
    expect(arcBeat(evaluateArcs(withShelter(base, null)), ARC)).toBe(ARC_DORMANT); // no base
    expect(arcBeat(evaluateArcs(withRuth(base, { met: false })), ARC)).toBe(ARC_DORMANT); // a stranger
    expect(arcBeat(evaluateArcs(withRuth(base, { needs: { hunger: 10, thirst: 10, fatigue: 10 } })), ARC)).toBe(ARC_DORMANT); // not yet desperate
  });

  it("fires the plea — and surfaces it in the Scene — once she is met, alive, desperate, at your base", () => {
    const { graph } = run([ARC]);
    const res = take(atThreshold(), graph, "rest"); // any turn runs stage 13
    expect(arcBeat(res.state, ARC)).toBe(ARC_PLEA);
    expect(res.state.history.some((e) => e.type === "story.beat")).toBe(true);
    expect(res.scene.narration).toContain("barricade"); // T41 — the story reads in the Scene
    expect(res.changed).toContain("story");
  });
});

// --- the costed choices -----------------------------------------------------------------------

describe("the plea's costed fork (T40)", () => {
  const pleaState = (): { s: GameState; g: RegionGraph } => {
    const { graph } = run([ARC]);
    const res = take(atThreshold(3), graph, "rest");
    return { s: res.state, g: graph };
  };

  it("offers take-in only when the cache can cover it, and turn-away always", () => {
    const { g } = pleaState();
    const stocked = take(atThreshold(3), g, "rest").state;
    expect(ids(storyChoices(stocked))).toEqual(expect.arrayContaining([`story-help:${ARC}`, `story-refuse:${ARC}`]));
    // strip the cache below the draw — take-in withdrawn, refusal remains (never a soft-lock)
    const bare = withStash(stocked, [{ type: "item.canned-food", quantity: 1 }]);
    expect(ids(storyChoices(bare))).not.toContain(`story-help:${ARC}`);
    expect(ids(storyChoices(bare))).toContain(`story-refuse:${ARC}`);
  });

  it("take-in spends the cache, eases her need, lifts trust, and enqueues the good consequence", () => {
    const { s, g } = pleaState();
    const before = stashUnits(s.player.stash);
    const res = take(s, g, `story-help:${ARC}`);
    expect(arcBeat(res.state, ARC)).toBe(ARC_HELPED);
    expect(stashUnits(res.state.player.stash)).toBe(before - THE_LAST_CUSTOMER.stashDraw);
    expect(res.state.npcs[SUBJ]!.trust).toBeGreaterThan(s.npcs[SUBJ]!.trust);
    expect(res.state.npcs[SUBJ]!.needs.hunger).toBeLessThan(s.npcs[SUBJ]!.needs.hunger);
    expect(res.state.queue.some((e) => e.kind === STORY_EVENT_KIND)).toBe(true);
    expect(res.changed).toEqual(expect.arrayContaining(["player", "npcs", "story", "queue", "history"]));
  });

  it("turn-away collapses her trust below parley (a betrayal that sticks) and enqueues the cold return", () => {
    const { s, g } = pleaState();
    const res = take(s, g, `story-refuse:${ARC}`);
    expect(arcBeat(res.state, ARC)).toBe(ARC_REFUSED);
    expect(res.state.npcs[SUBJ]!.trust).toBeLessThan(PARLEY_MIN);
    expect(canParley(res.state.npcs[SUBJ]!)).toBe(false);
    expect(res.state.queue.some((e) => e.kind === STORY_EVENT_KIND)).toBe(true);
  });
});

// --- the delayed consequence (stage 12) -------------------------------------------------------

describe("the consequence pays out when it comes due (T40 · stage 12)", () => {
  it("good branch: she brings supplies back to the cache and warms further", () => {
    const { s, g } = { s: take(atThreshold(3), run([ARC]).graph, "rest").state, g: run([ARC]).graph };
    const helped = take(s, g, `story-help:${ARC}`).state;
    const afterDraw = stashUnits(helped.player.stash);
    // jump the clock past the due time and resolve the queue directly
    const due = helped.queue[0]!;
    const ticked: GameState = { ...helped, meta: { ...helped.meta, day: due.dueDay + 1 } };
    const paid = resolveDueStoryEvents(ticked);
    expect(arcBeat(paid, ARC)).toBe(ARC_RESOLVED_GOOD);
    expect(stashUnits(paid.player.stash)).toBeGreaterThan(afterDraw);
    expect(paid.queue).toHaveLength(0);
    expect(paid.history.some((e) => e.type === "story.beat" && (e.data as { beat: number }).beat === ARC_RESOLVED_GOOD)).toBe(true);
  });

  it("cold branch: she raids the cache and knocks the barricade — the raided-stash beat", () => {
    const g = run([ARC]).graph;
    const pleaS = take(withStash(atThreshold(0), [{ type: "item.canned-food", quantity: 4 }]), g, "rest").state;
    const refused = take(pleaS, g, `story-refuse:${ARC}`).state;
    const fortified: GameState = { ...refused, nodes: { ...refused.nodes, [HERE]: { ...refused.nodes[HERE]!, barricades: 80 } } };
    const before = stashUnits(fortified.player.stash);
    const due = fortified.queue[0]!;
    const ticked: GameState = { ...fortified, meta: { ...fortified.meta, day: due.dueDay + 1 } };
    const paid = resolveDueStoryEvents(ticked);
    expect(arcBeat(paid, ARC)).toBe(ARC_RESOLVED_COLD);
    expect(stashUnits(paid.player.stash)).toBeLessThan(before);
    expect(paid.nodes[HERE]!.barricades).toBeLessThan(80);
    expect(paid.history.some((e) => e.type === "stash.raided")).toBe(true);
  });
});

// --- determinism, save-lossless, narration ----------------------------------------------------

describe("deterministic, save-lossless, legible (T40/T41)", () => {
  it("the whole plea→help slice replays byte-identically from the same setup", () => {
    const g = run([ARC]).graph;
    const play = (): string => {
      const plea = take(atThreshold(3), g, "rest").state;
      return saveGame(take(plea, g, `story-help:${ARC}`).state);
    };
    expect(play()).toBe(play());
  });

  it("a mid-arc run (plea live, consequence queued) round-trips deep-equal through the save", () => {
    const g = run([ARC]).graph;
    const helped = take(take(atThreshold(3), g, "rest").state, g, `story-help:${ARC}`).state;
    expect(helped.queue.length).toBeGreaterThan(0);
    expect(loadGame(saveGame(helped))).toEqual(helped);
  });

  it("surfaces the resolution even when a world event is logged after it (regression: not last-slot)", () => {
    const g = run([ARC]).graph;
    const helped = take(take(atThreshold(3), g, "rest").state, g, `story-help:${ARC}`).state;
    const due = helped.queue[0]!;
    const ticked: GameState = { ...helped, meta: { ...helped.meta, day: due.dueDay + 1 } };
    const paid = resolveDueStoryEvents(ticked); // appends the RESOLVED_GOOD story.beat
    // stage 13 would then append world events *after* the story beat — simulate a trailing one:
    const withTrailing: GameState = {
      ...paid,
      history: [...paid.history, { day: paid.meta.day, hour: paid.meta.hour, turn: paid.meta.turn, type: "weather.change", subjects: [], data: {} }],
    };
    expect(arcBeat(withTrailing, ARC)).toBe(ARC_RESOLVED_GOOD);
    expect(storyLine(withTrailing)).toContain("left supplies in your cache"); // payoff still shows
  });

  it("makes the take-in requirement legible: the plea states the cache cost whether or not you can afford it", () => {
    const g = run([ARC]).graph;
    // short cache (1 < stashDraw 2): take-in is not offered, but the plea now says exactly why + how to unlock it
    const short = take(atThreshold(1), g, "rest").state;
    expect(ids(storyChoices(short))).not.toContain(`story-help:${ARC}`);
    const shortLine = storyLine(short)!;
    expect(shortLine).toContain("from your cache");
    expect(shortLine).toMatch(/Stash \d+ more/);
    // affordable cache: take-in is offered, its label carries the cost, and the plea confirms you can help
    const ok = take(atThreshold(3), g, "rest").state;
    const help = storyChoices(ok).find((c) => c.id === `story-help:${ARC}`)!;
    expect(help.label).toContain("from your cache");
    expect(storyLine(ok)).toContain("enough to take her in");
  });

  it("storyLine reads each live beat", () => {
    const plea = take(atThreshold(3), run([ARC]).graph, "rest").state;
    expect(storyLine(plea)).toContain("barricade");
    const helped = take(plea, run([ARC]).graph, `story-help:${ARC}`).state;
    expect(storyLine(helped)).not.toBeNull();
  });

  it("a zero-hour wait does not advance an arc (empty-turn contract holds)", () => {
    const primed = atThreshold(3);
    expect(evaluateArcs(primed)).not.toBe(primed); // (sanity: it WOULD fire on a real turn)
    // but a bare wait through the pipeline with the plea already resolved changes nothing story-side
    const { graph } = run([ARC]);
    const idle = applyAction(run([ARC]).state, { type: "wait" }, graph);
    expect(idle.state.story.progress[ARC]).toBe(ARC_DORMANT);
    expect(idle.state.queue).toEqual([]);
  });
});
