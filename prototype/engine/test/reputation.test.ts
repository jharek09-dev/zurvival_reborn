import { describe, expect, it } from "vitest";
import {
  adjustReputation,
  adjustReputationPublic,
  applyEncounterEffect,
  availableActions,
  canRecruitEligible,
  effectiveDisposition,
  encounterPeople,
  factionRivalsOf,
  loadGame,
  matchesRequirement,
  memoryOf,
  reputationOf,
  resolveEncounterAction,
  saveGame,
  standingBand,
  standingIsHostile,
  standingIsWarm,
  standingLine,
  standingOf,
  startRun,
  sceneOf,
  socialChoices,
  REPUTATION_CRUELTY,
  REPUTATION_HOSTILE_AT,
  REPUTATION_MAX,
  REPUTATION_MIN,
  REPUTATION_RECRUIT,
  REPUTATION_SHARE,
  REPUTATION_SPILL_PCT,
  REPUTATION_THREATEN,
  REPUTATION_WARM_AT,
  type EncounterDef,
  type FactionDef,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../src/index.js";

/**
 * T86 — faction reputation made consequential (FR-NPC-10 · closes PL-M4-43).
 *
 * The load-bearing guarantees, in order: a run with no faction pool is UNTOUCHED by every path here
 * (byte-identity); the faction-level rivalry is DERIVED from authored content and never stored; the
 * `hostile` override is DERIVED, so `NPCState.disposition` keeps its authored value and no save rung is
 * taken; and each of the three people-verbs moves standing with the right people, by the right sign.
 *
 * The tests assert CONSEQUENCES, never a constant against itself — `expect(X_AT).toBe(X_AT)` cannot fail
 * when the constant moves, which is the survivor class that has led every mutation round since T84.
 */

const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
const NODES: NodeDef[] = [
  { id: "node.start", regionId: "region.z", name: "Start", description: "s", adjacent: ["node.mid"], start: true },
  { id: "node.mid", regionId: "region.z", name: "Mid", description: "m", adjacent: ["node.start", "node.far"] },
  // two hops out, so it is HIDDEN at spawn — a lead that reveals it is a lead with somewhere to go
  { id: "node.far", regionId: "region.z", name: "Far", description: "f", adjacent: ["node.mid"] },
];

/** kin (baseline +10) feuds with foe (baseline −30) via the cross-faction grudge rex↔vic. */
const NPCS: NPCDef[] = [
  { id: "npc.sana", name: "Sana", description: "a steady medic", disposition: "friendly", homeNode: "node.start" },
  {
    id: "npc.rex", name: "Rex", description: "a wary scavenger", disposition: "wary", homeNode: "node.start",
    // a real lead, so the `ask` verb has something to offer and the standing gate on it is testable
    knowledge: [{ id: "rex.far", hint: "There is a cache out at Far.", reveals: "node.far", minTrust: 40 }],
  },
  { id: "npc.vic", name: "Vic", description: "a hard one", disposition: "neutral", homeNode: "node.start" },
  { id: "npc.solo", name: "Solo", description: "belongs to nobody", disposition: "neutral", homeNode: "node.start" },
];
const FACTIONS: FactionDef[] = [
  {
    id: "faction.kin",
    name: "Kin",
    archetype: "holdout",
    description: "the people who stayed",
    homeNode: "node.mid",
    members: ["npc.sana", "npc.rex"],
    baseline: { reputation: 10 },
    // a CROSS-faction grudge (rex is kin, vic is foe) and a SAME-faction one (sana/rex), which must be ignored
    rivalries: [{ a: "npc.rex", b: "npc.vic" }, { a: "npc.sana", b: "npc.rex" }],
  },
  { id: "faction.foe", name: "Foe", archetype: "crew", description: "the other crew", members: ["npc.vic"], baseline: { reputation: -30 } },
  { id: "faction.far", name: "Far", archetype: "collective", description: "elsewhere", members: ["npc.nobody"], baseline: { reputation: 0 } },
];

const opts = { seed: "rep-seed", createdAt: "2026-09-14T00:00:00Z" };
const withPool = (extra: EncounterDef[] = []): { state: GameState; graph: RegionGraph } =>
  startRun(opts, REGIONS, NODES, NPCS, [], extra, [], [], [], FACTIONS);
/** The byte-identity baseline: no faction pool at all. */
const noPool = (): { state: GameState; graph: RegionGraph } => startRun(opts, REGIONS, NODES, NPCS);

const setRep = (s: GameState, id: string, v: number): GameState =>
  ({ ...s, player: { ...s.player, reputation: { ...s.player.reputation, [id]: v } } });
const meet = (s: GameState, id: string): GameState =>
  ({ ...s, npcs: { ...s.npcs, [id]: { ...s.npcs[id]!, met: true } } });
const setTrust = (s: GameState, id: string, trust: number): GameState =>
  ({ ...s, npcs: { ...s.npcs, [id]: { ...s.npcs[id]!, trust } } });
const carry = (s: GameState, type: string, quantity = 1): GameState =>
  ({ ...s, player: { ...s.player, inventory: [...s.player.inventory, { type, quantity }] } });
/** Make one survivor (or everyone, with no id) hungry+thirsty enough for the share offers to appear. */
const hungry = (s: GameState, id?: string): GameState => {
  const npcs = { ...s.npcs };
  for (const k of id === undefined ? Object.keys(npcs) : [id]) {
    npcs[k] = { ...npcs[k]!, needs: { ...npcs[k]!.needs, hunger: 90, thirst: 90 } };
  }
  return { ...s, npcs };
};

describe("T86 · the faction-level rivalry is DERIVED from authored content", () => {
  it("reads a cross-faction survivor grudge as a faction feud, from both ends", () => {
    const { graph } = withPool();
    expect(factionRivalsOf(graph, "faction.kin")).toContain("faction.foe");
    expect(factionRivalsOf(graph, "faction.foe")).toContain("faction.kin");
  });

  it("ignores a grudge between two members of the SAME faction", () => {
    // sana↔rex are both kin; if same-faction pairs counted, kin would be its own rival.
    expect(factionRivalsOf(withPool().graph, "faction.kin")).not.toContain("faction.kin");
  });

  it("unions an authored faction-level `rivals` list, symmetrically, and only for registered factions", () => {
    const authored: FactionDef[] = [
      { ...FACTIONS[0]!, rivalries: [] },
      FACTIONS[1]!,
      { ...FACTIONS[2]!, rivals: ["faction.kin", "faction.ghost"] },
    ];
    const { graph } = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], authored);
    expect(factionRivalsOf(graph, "faction.far")).toEqual(["faction.kin"]); // faction.ghost is not registered
    expect(factionRivalsOf(graph, "faction.kin")).toEqual(["faction.far"]); // symmetric from the other end
  });

  it("returns its rivals in a stable SORTED order, whatever order the pool arrives in", () => {
    // The spill walks this list; an order that depends on pool ordering is a replay divergence.
    const many: FactionDef[] = [
      { id: "faction.zulu", name: "Z", archetype: "crew", description: "z", members: ["npc.z"] },
      { id: "faction.mike", name: "M", archetype: "crew", description: "m", members: ["npc.m"] },
      { id: "faction.alfa", name: "A", archetype: "crew", description: "a", members: ["npc.a"], rivals: ["faction.zulu", "faction.mike", "faction.kilo"] },
      { id: "faction.kilo", name: "K", archetype: "crew", description: "k", members: ["npc.k"] },
    ];
    const fwd = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], many);
    const rev = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], [...many].reverse());
    expect(factionRivalsOf(fwd.graph, "faction.alfa")).toEqual(["faction.kilo", "faction.mike", "faction.zulu"]);
    expect(factionRivalsOf(rev.graph, "faction.alfa")).toEqual(factionRivalsOf(fwd.graph, "faction.alfa"));
  });

  it("resolves a survivor listed by two factions to the SAME one whatever order the pool arrives in", () => {
    // `factionIdOfNpc` picks the first by sorted faction id; without the sort it picks whichever the
    // content loader happened to hand over first, and the same save replays differently.
    const both: FactionDef[] = [
      { id: "faction.zulu", name: "Z", archetype: "crew", description: "z", members: ["npc.rex"], baseline: { reputation: 5 } },
      { id: "faction.alfa", name: "A", archetype: "crew", description: "a", members: ["npc.rex"], baseline: { reputation: -5 } },
    ];
    const fwd = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], both);
    const rev = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], [...both].reverse());
    expect(standingOf(fwd.state, fwd.graph, "npc.rex")).toBe(-5); // faction.alfa sorts first
    expect(standingOf(rev.state, rev.graph, "npc.rex")).toBe(standingOf(fwd.state, fwd.graph, "npc.rex"));
  });

  it("is empty with no faction pool at all", () => {
    expect(factionRivalsOf(noPool().graph, "faction.kin")).toEqual([]);
  });
});

describe("T86 · a PUBLIC standing move spills, sign-flipped, onto the faction's rivals", () => {
  it("raising one faction LOWERS the faction it feuds with", () => {
    const { state, graph } = withPool();
    const before = reputationOf(state, "faction.foe");
    const after = adjustReputationPublic(state, graph, "faction.kin", 20);
    expect(reputationOf(after, "faction.kin")).toBe(reputationOf(state, "faction.kin") + 20);
    expect(reputationOf(after, "faction.foe")).toBeLessThan(before);
  });

  it("lowering one faction RAISES the faction it feuds with — the sentence the design review said the game could not say", () => {
    const { state, graph } = withPool();
    const after = adjustReputationPublic(state, graph, "faction.kin", -20);
    expect(reputationOf(after, "faction.kin")).toBeLessThan(reputationOf(state, "faction.kin"));
    expect(reputationOf(after, "faction.foe")).toBeGreaterThan(reputationOf(state, "faction.foe"));
  });

  it("spills a strictly smaller magnitude than the move itself", () => {
    const { state, graph } = withPool();
    const up = adjustReputationPublic(state, graph, "faction.kin", 40);
    const moved = reputationOf(up, "faction.kin") - reputationOf(state, "faction.kin");
    const spilled = Math.abs(reputationOf(up, "faction.foe") - reputationOf(state, "faction.foe"));
    expect(spilled).toBeGreaterThan(0);
    expect(spilled).toBeLessThan(moved);
  });

  it("the QUIET write moves one faction and nobody else — the rival is untouched in either direction", () => {
    const { state, graph } = withPool();
    for (const d of [30, -30]) {
      const after = adjustReputation(state, graph, "faction.kin", d);
      expect(reputationOf(after, "faction.kin")).toBe(reputationOf(state, "faction.kin") + d);
      expect(reputationOf(after, "faction.foe")).toBe(reputationOf(state, "faction.foe"));
    }
  });

  it("a step too small to spill leaves the rival exactly where it was — TRUNCATED, not rounded", () => {
    // Both signs, because a fractional spill that is merely handed to the clamp survives in one of them:
    // trunc(-30 + 0.5) is -29, so dropping the truncation here silently GIVES a negative-standing rival
    // a point for a step that was supposed to be too small to reach them.
    const { state, graph } = withPool();
    const tiny = Math.max(1, Math.trunc(100 / REPUTATION_SPILL_PCT) - 1);
    for (const sign of [1, -1]) {
      const after = adjustReputationPublic(state, graph, "faction.kin", tiny * sign);
      expect(reputationOf(after, "faction.kin")).toBe(reputationOf(state, "faction.kin") + tiny * sign);
      expect(reputationOf(after, "faction.foe")).toBe(reputationOf(state, "faction.foe"));
    }
    expect(reputationOf(state, "faction.foe")).toBeLessThan(0); // the rival must be NEGATIVE for this to bite
  });

  it("clamps both ends and never escapes the band, however often it is pushed", () => {
    const { state, graph } = withPool();
    let hi = state;
    for (let i = 0; i < 40; i += 1) hi = adjustReputationPublic(hi, graph, "faction.kin", 50);
    expect(reputationOf(hi, "faction.kin")).toBe(REPUTATION_MAX);
    let lo = state;
    for (let i = 0; i < 40; i += 1) lo = adjustReputationPublic(lo, graph, "faction.kin", -50);
    expect(reputationOf(lo, "faction.kin")).toBe(REPUTATION_MIN);
  });

  it("is INERT — the same object back — with no pool, an unregistered faction, a null id, or a zero step", () => {
    const pooled = withPool();
    const bare = noPool();
    for (const fn of [adjustReputation, adjustReputationPublic]) {
      expect(fn(bare.state, bare.graph, "faction.kin", 30)).toBe(bare.state);
      expect(fn(pooled.state, pooled.graph, "faction.ghost", 30)).toBe(pooled.state);
      expect(fn(pooled.state, pooled.graph, null, 30)).toBe(pooled.state);
      expect(fn(pooled.state, pooled.graph, "faction.kin", 0)).toBe(pooled.state);
    }
  });
});

describe("T86 · standing is read off the faction, and the hostile override is DERIVED", () => {
  it("a survivor carries their faction's standing; an unaffiliated one carries none", () => {
    const { state, graph } = withPool();
    expect(standingOf(state, graph, "npc.rex")).toBe(reputationOf(state, "faction.kin"));
    expect(standingOf(state, graph, "npc.solo")).toBeNull();
  });

  it("pushing a faction past the floor turns ALL of its people hostile, and leaves outsiders alone", () => {
    const { state, graph } = withPool();
    const hated = setRep(state, "faction.kin", REPUTATION_HOSTILE_AT);
    expect(effectiveDisposition(hated, graph, hated.npcs["npc.rex"]!)).toBe("hostile");
    expect(effectiveDisposition(hated, graph, hated.npcs["npc.sana"]!)).toBe("hostile");
    expect(effectiveDisposition(hated, graph, hated.npcs["npc.solo"]!)).toBe("neutral");
    expect(effectiveDisposition(hated, graph, hated.npcs["npc.vic"]!)).toBe("neutral");
  });

  it("stores NOTHING: the authored disposition survives, and winning the faction back restores the read", () => {
    const { state, graph } = withPool();
    const hated = setRep(state, "faction.kin", REPUTATION_HOSTILE_AT - 20);
    expect(hated.npcs["npc.sana"]!.disposition).toBe("friendly"); // the field itself never moved
    const forgiven = adjustReputationPublic(hated, graph, "faction.kin", 100);
    expect(effectiveDisposition(forgiven, graph, forgiven.npcs["npc.sana"]!)).toBe("friendly");
  });

  it("without a graph the authored disposition is returned verbatim — every pre-T86 caller is unmoved", () => {
    const { state } = withPool();
    const hated = setRep(state, "faction.kin", -100);
    expect(effectiveDisposition(hated, undefined, hated.npcs["npc.sana"]!)).toBe("friendly");
  });

  it("the warm read opens only at the ceiling gate", () => {
    const { state, graph } = withPool();
    expect(standingIsWarm(setRep(state, "faction.kin", REPUTATION_WARM_AT), graph, "npc.rex")).toBe(true);
    expect(standingIsWarm(setRep(state, "faction.kin", REPUTATION_WARM_AT - 1), graph, "npc.rex")).toBe(false);
    expect(standingIsHostile(setRep(state, "faction.kin", REPUTATION_HOSTILE_AT), graph, "npc.rex")).toBe(true);
    expect(standingIsHostile(setRep(state, "faction.kin", REPUTATION_HOSTILE_AT + 1), graph, "npc.rex")).toBe(false);
  });

  it("a faction's AUTHORED BASELINE never lands in a band that claims the player is owed something", () => {
    // The shipped Quad Collective opens at exactly 20. A `welcome` floor of 20 had the Scene saying
    // "the Quad owe you something" on turn zero, before a single action — so the floor must sit above
    // the highest baseline any content can author, and 20 is the one to pin.
    const authored: FactionDef[] = [{ id: "faction.twenty", name: "Twenty", archetype: "crew", description: "t", members: ["npc.solo"], baseline: { reputation: 20 } }];
    const { state, graph } = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], authored);
    expect(reputationOf(state, "faction.twenty")).toBe(20);
    expect(standingBand(20)).toBe("unknown");
    expect(standingLine(state, graph, "npc.solo", "Solo")).toBeNull();
  });

  it("every band boundary is pinned, and the five bands tile the whole legal range in order", () => {
    const order = ["hated", "resented", "unknown", "welcome", "kin"] as const;
    expect(standingBand(REPUTATION_MIN)).toBe("hated");
    expect(standingBand(REPUTATION_HOSTILE_AT)).toBe("hated");
    expect(standingBand(REPUTATION_HOSTILE_AT + 1)).toBe("resented");
    expect(standingBand(-11)).toBe("resented");
    expect(standingBand(-10)).toBe("unknown");
    expect(standingBand(24)).toBe("unknown");
    expect(standingBand(25)).toBe("welcome");
    expect(standingBand(REPUTATION_WARM_AT - 1)).toBe("welcome");
    expect(standingBand(REPUTATION_WARM_AT)).toBe("kin");
    expect(standingBand(REPUTATION_MAX)).toBe("kin");
    // monotone, and every band actually used somewhere in the band
    let last = -1;
    for (let v = REPUTATION_MIN; v <= REPUTATION_MAX; v += 1) {
      const i = order.indexOf(standingBand(v));
      expect(i).toBeGreaterThanOrEqual(last);
      last = i;
    }
    expect(last).toBe(order.length - 1);
  });

  it("a faction the run never registered reads as neutral zero, not as some default standing", () => {
    const { state } = withPool();
    expect(reputationOf(state, "faction.ghost")).toBe(0);
    expect(standingBand(reputationOf(state, "faction.ghost"))).toBe("unknown");
  });
});

describe("T86 · the three people-verbs move standing with the right people", () => {
  const share = (s: GameState, g: RegionGraph, id: string): GameState =>
    resolveEncounterAction(hungry(carry(s, "item.canned-food", 3), id), { type: "give-food", choiceId: `give-food:${id}`, timeCost: 1, params: { npc: id } }, g);
  const menace = (s: GameState, g: RegionGraph, id: string): GameState =>
    resolveEncounterAction(s, { type: "threaten", choiceId: `threaten:${id}`, timeCost: 1, params: { npc: id } }, g);

  it("sharing food with one of their people raises their faction and costs you with its rival", () => {
    const { state, graph } = withPool();
    const after = share(state, graph, "npc.rex");
    expect(reputationOf(after, "faction.kin")).toBe(reputationOf(state, "faction.kin") + REPUTATION_SHARE);
    expect(reputationOf(after, "faction.foe")).toBeLessThanOrEqual(reputationOf(state, "faction.foe"));
  });

  it("menacing one of their people costs MORE standing than sharing earns — harm outweighs help", () => {
    const { state, graph } = withPool();
    const kind = reputationOf(share(state, graph, "npc.rex"), "faction.kin") - reputationOf(state, "faction.kin");
    const cruel = reputationOf(state, "faction.kin") - reputationOf(menace(state, graph, "npc.rex"), "faction.kin");
    expect(cruel).toBeGreaterThan(kind);
  });

  it("recruiting one of their people is the strongest positive the engine offers", () => {
    const { state, graph } = withPool();
    const ready = setTrust(meet(state, "npc.sana"), "npc.sana", 100);
    const after = resolveEncounterAction(ready, { type: "recruit", choiceId: "recruit:npc.sana", timeCost: 1, params: { npc: "npc.sana" } }, graph);
    expect(after.actors["npc.sana"]).toBeDefined();
    expect(reputationOf(after, "faction.kin") - reputationOf(ready, "faction.kin")).toBe(REPUTATION_RECRUIT);
    expect(REPUTATION_RECRUIT).toBeGreaterThan(REPUTATION_SHARE);
  });

  it("a REFUSED recruit moves no standing — the gate is the join, not the asking", () => {
    // The trust gate lives on the OFFER (`encounterPeople`), never on `recruit` itself, so the refusal
    // exercised here is the standing one: a faction that has turned on you does not hand over its people
    // even when the action is dispatched straight at the engine.
    const { state, graph } = withPool();
    const hated = setRep(setTrust(meet(state, "npc.rex"), "npc.rex", 100), "faction.kin", REPUTATION_HOSTILE_AT);
    const after = resolveEncounterAction(hated, { type: "recruit", choiceId: "recruit:npc.rex", timeCost: 1, params: { npc: "npc.rex" } }, graph);
    expect(after.actors["npc.rex"]).toBeUndefined();
    expect(reputationOf(after, "faction.kin")).toBe(reputationOf(hated, "faction.kin"));
  });

  it("an unaffiliated survivor moves no faction at all", () => {
    const { state, graph } = withPool();
    const after = menace(state, graph, "npc.solo");
    expect(after.npcs["npc.solo"]!.trust).toBeLessThan(state.npcs["npc.solo"]!.trust); // the verb still lands
    expect(after.player.reputation).toEqual(state.player.reputation);
  });

  it("without a faction pool not one of the three verbs touches reputation", () => {
    const { state, graph } = noPool();
    expect(share(state, graph, "npc.rex").player.reputation).toEqual({});
    expect(menace(state, graph, "npc.rex").player.reputation).toEqual({});
  });
});

describe("T86 · a hated faction closes the door its members' own trust would have left open", () => {
  it("refuses the recruit however high the personal trust runs", () => {
    const { state, graph } = withPool();
    const ready = setTrust(meet(state, "npc.sana"), "npc.sana", 100);
    expect(canRecruitEligible(ready, ready.npcs["npc.sana"]!, graph)).toBe(true);
    const hated = setRep(ready, "faction.kin", REPUTATION_HOSTILE_AT);
    expect(canRecruitEligible(hated, hated.npcs["npc.sana"]!, graph)).toBe(false);
    // and the refusal is the STANDING's, not the party's or the trust's
    expect(canRecruitEligible(hated, hated.npcs["npc.sana"]!, undefined)).toBe(true);
  });

  it("stops offering talk and threaten to their people, while an outsider at the same node still engages", () => {
    const { state, graph } = withPool();
    const ready = hungry(carry(state, "item.canned-food", 3));
    expect(encounterPeople(ready, graph).map((c) => c.id)).toContain("talk:npc.rex");

    const hated = setRep(ready, "faction.kin", REPUTATION_HOSTILE_AT);
    const shut = encounterPeople(hated, graph).map((c) => c.id);
    expect(shut).not.toContain("talk:npc.rex");
    expect(shut).not.toContain("threaten:npc.rex");
    expect(shut).not.toContain("talk:npc.sana");
    expect(shut).toContain("talk:npc.solo"); // an outsider is untouched
    expect(shut).toContain("threaten:npc.solo");
  });

  it("LEAVES A WAY BACK: they still take a meal, so a hated faction is never a dead end", () => {
    // Without this, the audit measured that at the floor NOT ONE offered choice could raise the
    // faction again — a standing you can lose and never recover is a trap, not a decision.
    const { state, graph } = withPool();
    const ready = setRep(hungry(carry(state, "item.canned-food", 3)), "faction.kin", REPUTATION_HOSTILE_AT);
    const shut = encounterPeople(ready, graph).map((c) => c.id);
    expect(shut).toContain("give-food:npc.rex");
    const fed = resolveEncounterAction(ready, { type: "give-food", choiceId: "give-food:npc.rex", timeCost: 1, params: { npc: "npc.rex" } }, graph);
    expect(reputationOf(fed, "faction.kin")).toBeGreaterThan(reputationOf(ready, "faction.kin"));
  });

  it("closes the `ask` verb too — a faction that has cut you off does not go on confiding map intel", () => {
    // The audit caught this one wide open: the hated survivor still handed over a node reveal, and the
    // SAME Scene paragraph said "they lower their voice" and "there is nothing to talk about".
    const { state, graph } = withPool();
    const told = meet(setTrust(state, "npc.rex", 80), "npc.rex");
    expect(socialChoices(told, graph).map((c) => c.id)).toContain("ask:npc.rex");
    const hated = setRep(told, "faction.kin", REPUTATION_HOSTILE_AT);
    expect(socialChoices(hated, graph).map((c) => c.id)).not.toContain("ask:npc.rex");
    // and it is THEIR faction's standing that closes it, not any faction's
    expect(socialChoices(setRep(told, "faction.foe", REPUTATION_HOSTILE_AT), graph).map((c) => c.id)).toContain("ask:npc.rex");
  });

  it("stops OFFERING the recruit to a met, fully-trusted survivor once their faction turns", () => {
    // `canRecruitEligible` refusing is not enough on its own — the offer layer has to stop showing a
    // choice the resolve layer would refuse, or the Scene advertises something that silently does nothing.
    const { state, graph } = withPool();
    const ready = setTrust(meet(state, "npc.sana"), "npc.sana", 100);
    expect(encounterPeople(ready, graph).map((c) => c.id)).toContain("recruit:npc.sana");
    const hated = setRep(ready, "faction.kin", REPUTATION_HOSTILE_AT);
    expect(encounterPeople(hated, graph).map((c) => c.id)).not.toContain("recruit:npc.sana");
  });

  it("never leaves the player with nothing to do — the no-soft-lock invariant holds at the worst standing", () => {
    const { state, graph } = withPool();
    let worst = state;
    for (const f of ["faction.kin", "faction.foe", "faction.far"]) worst = setRep(worst, f, REPUTATION_MIN);
    expect(availableActions(worst, graph).length).toBeGreaterThan(0);
  });

  it("says WHY the choices went away, instead of the ordinary greeting it would otherwise print", () => {
    const { state, graph } = withPool();
    const open = sceneOf(state, graph).narration;
    expect(open).toContain("Someone is here — Rex"); // the T35 first-sight read, before standing turns
    const hated = setRep(state, "faction.kin", REPUTATION_HOSTILE_AT);
    const shut = sceneOf(hated, graph).narration;
    expect(shut).toContain("Kin");
    expect(shut).not.toContain("Someone is here — Rex"); // the greeting is REPLACED, not appended to
    expect(shut).toContain("Someone is here — Solo"); // an outsider still reads normally
  });

  it("carries the faction's view into the Scene at a standing well short of the floor", () => {
    // The line must not be a hostile-only tell, or the player never learns which way standing is going
    // until the door slams.
    const { state, graph } = withPool();
    const warm = setRep(state, "faction.kin", REPUTATION_WARM_AT);
    expect(sceneOf(warm, graph).narration).toContain("Kin");
    expect(standingIsHostile(warm, graph, "npc.rex")).toBe(false); // not the hostile branch
    expect(standingLine(state, graph, "npc.solo", "Solo")).toBeNull(); // no faction, no line, ever
  });

  it("the offer list reached through availableActions is gated too, not just encounterPeople", () => {
    const { state, graph } = withPool();
    expect(availableActions(state, graph).map((c) => c.id)).toContain("talk:npc.rex");
    const hated = setRep(state, "faction.kin", REPUTATION_HOSTILE_AT);
    expect(availableActions(hated, graph).map((c) => c.id)).not.toContain("talk:npc.rex");
    expect(availableActions(hated, graph).map((c) => c.id)).toContain("talk:npc.solo");
  });
});

describe("T86 · the authored channel: the encounter effect and the standing gate", () => {
  const ctx = (graph?: RegionGraph) => (graph === undefined ? { encounterId: "e", node: "node.start" } : { encounterId: "e", node: "node.start", graph });

  it("the effect moves the named faction and spills like every other write", () => {
    const { state, graph } = withPool();
    const after = applyEncounterEffect(state, { kind: "adjustReputation", faction: "faction.kin", delta: 30 }, ctx(graph));
    expect(reputationOf(after, "faction.kin")).toBeGreaterThan(reputationOf(state, "faction.kin"));
    expect(reputationOf(after, "faction.foe")).toBeLessThan(reputationOf(state, "faction.foe"));
  });

  it("the effect is a no-op when the context carries no graph", () => {
    const { state } = withPool();
    expect(applyEncounterEffect(state, { kind: "adjustReputation", faction: "faction.kin", delta: 30 }, ctx())).toBe(state);
  });

  it("a standing bound gates the encounter, and both ends of the band are enforced", () => {
    const { state } = withPool();
    const node = state.nodes["node.start"]!;
    const req = { faction: "faction.kin", minReputation: 40 } as const;
    expect(matchesRequirement(setRep(state, "faction.kin", 39), req, node, "node.start", undefined)).toBe(false);
    expect(matchesRequirement(setRep(state, "faction.kin", 40), req, node, "node.start", undefined)).toBe(true);
    const cap = { faction: "faction.kin", maxReputation: -40 } as const;
    expect(matchesRequirement(setRep(state, "faction.kin", -39), cap, node, "node.start", undefined)).toBe(false);
    expect(matchesRequirement(setRep(state, "faction.kin", -40), cap, node, "node.start", undefined)).toBe(true);
  });

  it("a bound the run cannot evaluate FAILS rather than passing silently", () => {
    const { state } = withPool();
    const node = state.nodes["node.start"]!;
    expect(matchesRequirement(state, { minReputation: 0 }, node, "node.start", undefined)).toBe(false);
    expect(matchesRequirement(state, { faction: "faction.ghost", minReputation: -100 }, node, "node.start", undefined)).toBe(false);
    const bare = noPool();
    expect(matchesRequirement(bare.state, { faction: "faction.kin", minReputation: -100 }, bare.state.nodes["node.start"]!, "node.start", undefined)).toBe(false);
  });

  it("a requirement with a faction but NO bound is ignored, as every absent field is", () => {
    const { state } = withPool();
    expect(matchesRequirement(state, { faction: "faction.ghost" }, state.nodes["node.start"]!, "node.start", undefined)).toBe(true);
  });
});

describe("T86 · saw-cruelty finally has its occasion", () => {
  const ctx = (graph: RegionGraph) => ({ encounterId: "e", node: "node.start", graph });

  it("a cruel act is remembered by the people who were standing there, and costs you with theirs", () => {
    const { state, graph } = withPool();
    const after = applyEncounterEffect(state, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    for (const id of ["npc.rex", "npc.sana", "npc.vic", "npc.solo"]) {
      expect(memoryOf(after.npcs[id]!).some((m) => m.kind === "saw-cruelty")).toBe(true);
    }
    // Two of the four witnesses are kin, so the Kin lose the most; and because the cruelty is charged
    // per witness while the spill only ever returns a fraction of it, the standing SUMMED across every
    // faction must fall — there is no arrangement of witnesses that leaves you better off for it.
    expect(reputationOf(after, "faction.kin")).toBeLessThan(reputationOf(state, "faction.kin"));
    const total = (s: GameState): number =>
      Object.values(s.player.reputation).reduce((a: number, b: number) => a + b, 0);
    expect(total(after)).toBeLessThan(total(state));
  });

  it("a faction with nobody watching pays nothing", () => {
    // Only `faction.far` has no member at the node — the cruelty must not reach it through the spill
    // either, because `faction.far` feuds with nobody.
    const { state, graph } = withPool();
    const after = applyEncounterEffect(state, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    expect(reputationOf(after, "faction.far")).toBe(reputationOf(state, "faction.far"));
  });

  it("a KIND act is remembered by nobody — the hook is one-sided by design", () => {
    const { state, graph } = withPool();
    const after = applyEncounterEffect(state, { kind: "adjustHumanity", delta: 20 }, ctx(graph));
    expect(memoryOf(after.npcs["npc.rex"]!)).toHaveLength(0);
    expect(after.player.reputation).toEqual(state.player.reputation);
  });

  it("only the people who were THERE remember it", () => {
    const { state, graph } = withPool();
    const elsewhere = { ...state, npcs: { ...state.npcs, ["npc.rex"]: { ...state.npcs["npc.rex"]!, location: "node.mid" } } };
    const after = applyEncounterEffect(elsewhere, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    expect(memoryOf(after.npcs["npc.rex"]!)).toHaveLength(0);
    expect(memoryOf(after.npcs["npc.sana"]!).some((m) => m.kind === "saw-cruelty")).toBe(true);
  });

  it("writes nothing at all on a run with no faction pool", () => {
    const { state, graph } = noPool();
    const after = applyEncounterEffect(state, { kind: "adjustHumanity", delta: -20 }, { encounterId: "e", node: "node.start", graph });
    expect(memoryOf(after.npcs["npc.rex"]!)).toHaveLength(0);
    expect(after.player.reputation).toEqual({});
  });
});

describe("T86 · no save rung, and a pool-less run is untouched", () => {
  it("standing survives a save round-trip without a schema bump", () => {
    const { state, graph } = withPool();
    const moved = adjustReputationPublic(state, graph, "faction.kin", 35);
    const back = loadGame(saveGame(moved));
    expect(back.player.reputation).toEqual(moved.player.reputation);
    expect(saveGame(back)).toEqual(saveGame(moved));
  });

  it("a run that registers no faction carries an empty standing map, exactly as before", () => {
    const { state } = noPool();
    expect(state.player.reputation).toEqual({});
    expect(state.groups).toEqual({});
  });
});

describe("T86 · a non-finite step never reaches the save (the T83/T84 NaN shape, third time)", () => {
  it("refuses NaN / Infinity outright rather than clamping them into an integer field", () => {
    const { state, graph } = withPool();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(adjustReputation(state, graph, "faction.kin", bad)).toBe(state);
      const after = adjustReputationPublic(state, graph, "faction.kin", bad);
      expect(after).toBe(state);
      expect(Number.isFinite(reputationOf(after, "faction.kin"))).toBe(true);
    }
  });

  it("and nothing non-finite survives a save round-trip through the effect interpreter either", () => {
    const { state, graph } = withPool();
    const after = applyEncounterEffect(state, { kind: "adjustReputation", faction: "faction.kin", delta: Number.NaN }, { encounterId: "e", node: "node.start", graph });
    const back = loadGame(saveGame(after));
    for (const v of Object.values(back.player.reputation)) expect(Number.isFinite(v)).toBe(true);
  });
});


/** A minimal recruited companion parked at a node. */
const companion = (id: string, location: string, s: GameState): Survivor => ({
  id, type: id, condition: s.player.condition, location, groupId: null,
  relationships: {}, flags: {}, inventory: [],
});

describe("T86 · the audit's exploits, each pinned by the behaviour that closed it", () => {
  const ctx = (graph: RegionGraph) => ({ encounterId: "e", node: "node.start", graph });

  it("SHARING BACK AND FORTH BETWEEN TWO FEUDING FACTIONS CANNOT LIFT BOTH", () => {
    // The spill used to ride every write, so alternating a meal between rivals netted each of them
    // `delta x (1 - spill%)` per cycle, unbounded to the clamp. Ten cycles through the real verbs:
    const { state, graph } = withPool();
    let s = hungry(carry(state, "item.canned-food", 60));
    const start = { kin: reputationOf(s, "faction.kin"), foe: reputationOf(s, "faction.foe") };
    for (let i = 0; i < 10; i += 1) {
      for (const who of ["npc.rex", "npc.vic"]) {
        s = hungry(resolveEncounterAction(s, { type: "give-food", choiceId: `give-food:${who}`, timeCost: 1, params: { npc: who } }, graph));
      }
    }
    // both DID rise — feeding people is meant to work — but each rose by exactly its own meals, with
    // nothing conjured out of the feud: 10 shares each, and not one point more.
    expect(reputationOf(s, "faction.kin")).toBe(start.kin + REPUTATION_SHARE * 10);
    expect(reputationOf(s, "faction.foe")).toBe(start.foe + REPUTATION_SHARE * 10);
  });

  it("A CRUEL ACT NEVER LEAVES A RIVAL BETTER OFF, however many witnesses one faction has", () => {
    // Charging per witness meant three of one faction watching spilled three times onto their rivals,
    // while the rival's own single charge did not scale — so the cruellest choice in the game came out
    // as the strongest POSITIVE move for the faction that hated you most.
    const { state, graph } = withPool();
    const crowd = { ...state, npcs: { ...state.npcs, ["npc.solo"]: { ...state.npcs["npc.solo"]!, id: "npc.solo" } } };
    const after = applyEncounterEffect(crowd, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    for (const f of ["faction.kin", "faction.foe", "faction.far"]) {
      expect(reputationOf(after, f)).toBeLessThanOrEqual(reputationOf(crowd, f));
    }
  });

  it("and it charges a faction ONCE, not once per head standing in the room", () => {
    const { state, graph } = withPool();
    const one = { ...state, npcs: { ...state.npcs, ["npc.sana"]: { ...state.npcs["npc.sana"]!, location: "node.mid" } } };
    const cruelOne = applyEncounterEffect(one, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    const cruelBoth = applyEncounterEffect(state, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    // rex alone, or rex AND sana — the Kin pay the same, because the act is one act
    expect(reputationOf(cruelBoth, "faction.kin") - reputationOf(state, "faction.kin"))
      .toBe(reputationOf(cruelOne, "faction.kin") - reputationOf(one, "faction.kin"));
  });

  it("A COMPANION A REGION AWAY DID NOT SEE IT", () => {
    // `saw-cruelty` drives desertion and betrayal off `respect`/`fear`. Remembering onto every entry in
    // `actors` put a companion holding the base into betrayal range for acts they were nowhere near.
    const { state, graph } = withPool();
    const withParty = {
      ...state,
      actors: {
        ...state.actors,
        ["npc.here"]: companion("npc.here", "node.start", state),
        ["npc.away"]: companion("npc.away", "node.mid", state),
      },
    } as GameState;
    let out = withParty;
    for (let i = 0; i < 10; i += 1) out = applyEncounterEffect(out, { kind: "adjustHumanity", delta: -20 }, ctx(graph));
    expect(memoryOf(out.actors["npc.here"]!).length).toBeGreaterThan(0);
    expect(memoryOf(out.actors["npc.away"]!)).toHaveLength(0);
  });

  it("A TURN-ZERO RUN ASSERTS NO DEBT: no faction's authored baseline lands in a band that claims one", () => {
    // `welcome` reads "they owe you something". Its floor used to sit exactly on the Quad's baseline,
    // so the Scene said it before the player had done anything at all.
    const { state, graph } = withPool();
    for (const fid of Object.keys(state.player.reputation)) {
      expect(standingBand(reputationOf(state, fid))).not.toBe("welcome");
      expect(standingBand(reputationOf(state, fid))).not.toBe("kin");
    }
    expect(standingOf(state, graph, "npc.rex")).toBeLessThan(REPUTATION_WARM_AT);
  });
});


describe("T86 · the seeded baseline the whole axis starts from", () => {
  it("clamps an authored baseline into the legal band rather than seeding a value no write could produce", () => {
    const wild: FactionDef[] = [
      { id: "faction.hi", name: "Hi", archetype: "crew", description: "h", members: ["npc.solo"], baseline: { reputation: 5000 } },
      { id: "faction.lo", name: "Lo", archetype: "crew", description: "l", members: ["npc.a"], baseline: { reputation: -5000 } },
    ];
    const { state } = startRun(opts, REGIONS, NODES, NPCS, [], [], [], [], [], wild);
    expect(reputationOf(state, "faction.hi")).toBe(REPUTATION_MAX);
    expect(reputationOf(state, "faction.lo")).toBe(REPUTATION_MIN);
    // and the bands still read, which is what an unclamped seed would have broken
    expect(standingBand(reputationOf(state, "faction.hi"))).toBe("kin");
    expect(standingBand(reputationOf(state, "faction.lo"))).toBe("hated");
  });
});
