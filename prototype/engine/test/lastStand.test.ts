import { describe, expect, it } from "vitest";
import {
  BARE_HANDS,
  BREAK_BASE,
  BREAK_MAX,
  BREAK_PER_COMPANION,
  COMPANION_FATAL_BURDEN,
  COMPANION_DMG_MAX,
  COMPANION_DMG_MIN,
  COMPANION_FLAG,
  COMPANION_HIT_CHANCE,
  COMPANION_SOAK,
  COMPANION_SOAK_MAX,
  ENEMIES,
  GRAB_CHANCE,
  LAST_STAND_AT,
  ORDER_TRUST_MIN,
  PARTY_STREAM,
  WEAPON_SLOT,
  applyAction,
  availableActions,
  breakFreeChance,
  combatNarration,
  endingNarration,
  fightingCompanions,
  inLastStand,
  isGrabbed,
  isRunOver,
  loadGame,
  resolveCombatAction,
  runEndReason,
  saveGame,
  startRun,
  weaponInFight,
  withRoster,
  woundBurden,
  type ActorId,
  type ContentId,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type Survivor,
} from "../src/index.js";

/**
 * T82 — combat stakes: the GRABBED outcome, the party in the fight, and the Last Stand (FR-CBT-02 ·
 * FR-NPC-03 remainder · GDD IX "Canonical: the Last Stand" · ADR-0007 · closes PL-M4-07).
 *
 * Four claims under test:
 *   1. A fight can take your way out away (`grabbed`), and give you a verb to buy it back.
 *   2. A fight can END THE RUN — the first time in the project's history that it can.
 *   3. The party is an input to a fight: it swings, it soaks, and it can be killed doing so.
 *   4. None of it costs a `combat` draw, and a player fighting alone is unshifted.
 *
 * The last one is why the T15–T81 combat measurements are still comparable, and it is asserted
 * directly rather than assumed.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true, walkers: 1 },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];

interface Opts {
  readonly zombie?: ContentId;
  readonly weapon?: ContentId;
  /** Companions to place at the start node, as [trust, order] pairs. */
  readonly party?: readonly (readonly [number, "follow" | "hold"])[];
}

function fixture(seed: string, opts: Opts = {}): { state: GameState; graph: RegionGraph } {
  const { state, graph } = startRun({ seed, createdAt: "2026-09-13T00:00:00Z" }, REGIONS, NODES);
  const base = state.nodes["node.x.a"]!;
  let next: GameState = { ...state, nodes: { ...state.nodes, "node.x.a": withRoster(base, [opts.zombie ?? "zombie.walker"]) } };
  if (opts.weapon !== undefined) {
    const id = `${opts.weapon}#fx`;
    next = {
      ...next,
      items: { ...next.items, [id]: { type: opts.weapon, quality: 100, durability: 100, metadata: {} } },
      player: {
        ...next.player,
        inventory: [...next.player.inventory, { type: opts.weapon, quantity: 1, itemId: id }],
        equipment: { ...next.player.equipment, [WEAPON_SLOT]: id },
      },
    };
  }
  if (opts.party !== undefined) {
    const actors: Record<string, Survivor> = { ...(next.actors as Record<string, Survivor>) };
    opts.party.forEach(([trust, order], i) => {
      actors[`npc.c${i}`] = {
        id: `npc.c${i}` as ActorId,
        type: "npc.fixture",
        name: `C${i}`,
        trust,
        condition: { needs: { hunger: 10, thirst: 10, fatigue: 10 }, wounds: [], infection: { progression: 0, stage: "none" }, mind: { stress: 0, morale: 60 } },
        location: "node.x.a",
        groupId: null,
        relationships: {},
        inventory: [],
        flags: { [COMPANION_FLAG]: true, ...(order === "hold" ? { "order:hold": true } : {}) },
      } as unknown as Survivor;
    });
    next = { ...next, actors };
  }
  return { state: next, graph };
}

const ids = (s: GameState, g: RegionGraph): string[] => availableActions(s, g).map((c) => c.id);
function take(s: GameState, g: RegionGraph, id: string): GameState {
  const c = availableActions(s, g).find((x) => x.id === id);
  if (c === undefined) throw new Error(`no choice ${id}; offered: ${ids(s, g).join(",")}`);
  return applyAction(s, c.action, g).state;
}
const strike = (s: GameState, g: RegionGraph): GameState =>
  resolveCombatAction(s, g, { type: s.combat === null ? "fight" : "strike", choiceId: "x", timeCost: 1, params: {} });

/** Fight on until the dead have hold of the player, or give up after `n` exchanges. */
function untilGrabbed(seedPrefix: string, opts: Opts = {}, n = 400): GameState | null {
  for (let i = 0; i < n; i += 1) {
    const { state, graph } = fixture(`${seedPrefix}-${i}`, { zombie: "zombie.riot", ...opts });
    let s = state;
    for (let k = 0; k < 12 && !isGrabbed(s); k += 1) {
      s = strike(s, graph);
      if (s.combat === null) break;
    }
    if (isGrabbed(s)) return s;
  }
  return null;
}

/** Force the grab on rather than fishing for a seed, where the grab itself is not what is under test. */
const grab = (s: GameState): GameState => ({ ...s, combat: { ...s.combat!, grabbed: true } });
/** …and force it off, for the paired negative case, since an opening exchange may grab on its own. */
function ungrab(s: GameState): GameState {
  if (s.combat === null) return s;
  const { grabbed: _g, ...free } = s.combat;
  return { ...s, combat: free };
}
/** Put `n` points of untreated damage on the player, as named wounds. */
const hurt = (s: GameState, n: number): GameState => ({
  ...s,
  player: {
    ...s.player,
    condition: {
      ...s.player.condition,
      wounds: [{ type: "wound.laceration" as ContentId, site: "arm", severity: n, treated: 0, inflictedDay: 1 }],
    },
  },
});

// --- 1. the grab ---------------------------------------------------------------------------------

describe("GRABBED — a fight can take your way out away (T82 · FR-CBT-02)", () => {
  it("is reachable by ordinary play, and sets the flag", () => {
    const held = untilGrabbed("reach");
    expect(held).not.toBeNull();
    expect(held!.combat!.grabbed).toBe(true);
    expect(isGrabbed(held!)).toBe(true);
  });

  it("withholds every retreat and offers BREAK FREE instead", () => {
    const { state, graph } = fixture("offers");
    const held = grab(ungrab(strike(state, graph)));
    const offered = ids(held, graph);
    expect(offered).toContain("break");
    expect(offered).toContain("strike");
    expect(offered.filter((x) => x.startsWith("retreat"))).toEqual([]);
    // …and the shove is gone too: you cannot make room from something already holding you.
    expect(offered).not.toContain("push");
    // The same fight, not grabbed, offers the mirror image. This is the pairing that proves the
    // withholding is the grab's doing and not the fixture's.
    const free = ungrab(strike(state, graph));
    expect(ids(free, graph).filter((x) => x.startsWith("retreat")).length).toBeGreaterThan(0);
    expect(ids(free, graph)).not.toContain("break");
  });

  it("NEVER withholds the pre-fight slip — FR-CBT-05's promise is about the stealth path", () => {
    // A contested node with no fight open still offers a way past, which is the requirement's actual
    // text. A player who never chooses to fight can never be grabbed, so can never lose a retreat.
    const { state, graph } = fixture("slip");
    expect(state.combat).toBeNull();
    expect(ids(state, graph).filter((x) => x.startsWith("slip")).length).toBeGreaterThan(0);
  });

  it("makes the player fight bare-handed — and says so, only when they are holding something", () => {
    const { state, graph } = fixture("bare", { weapon: "item.machete" });
    const free = ungrab(strike(state, graph));
    expect(weaponInFight(free).id).not.toBe(BARE_HANDS.id);
    const held = grab(free);
    expect(weaponInFight(held).id).toBe(BARE_HANDS.id);
    const label = availableActions(held, graph).find((c) => c.id === "strike")!.label;
    expect(label).toContain("cannot bring the weapon to bear");

    // Empty-handed, the same situation must NOT invent a weapon to take away.
    const { state: s2, graph: g2 } = fixture("bare2");
    const held2 = grab(ungrab(strike(s2, g2)));
    expect(availableActions(held2, g2).find((c) => c.id === "strike")!.label).not.toContain("weapon to bear");
  });

  it("leaves the equipped weapon un-worn while it is not being swung", () => {
    const { state, graph } = fixture("wear", { weapon: "item.machete" });
    const held = grab(ungrab(strike(state, graph)));
    const id = held.player.equipment[WEAPON_SLOT]!;
    const before = held.items[id]!.durability;
    const after = strike(held, graph);
    expect(after.items[id]!.durability).toBe(before);
  });

  it("a strike does not shake the grab off — only BREAK FREE or the enemy's death does", () => {
    // A survivor of the first mutation round: `resolveStrike` rebuilds `combat` on every blow, so a
    // stray `grabbed: false` in that object literal would hand the player their retreats back for
    // free after one swing, and nothing in the suite noticed. Swinging is not escaping.
    let checked = 0;
    for (let i = 0; i < 200; i += 1) {
      const { state, graph } = fixture(`sticky-${i}`, { zombie: "zombie.riot" });
      let s = grab(ungrab(strike(state, graph)));
      for (let k = 0; k < 4; k += 1) {
        if (s.combat === null || isRunOver(s)) break;
        s = strike(s, graph);
        if (s.combat === null || isRunOver(s)) break;
        checked += 1;
        expect(isGrabbed(s)).toBe(true);
        expect(ids(s, graph).filter((x) => x.startsWith("retreat"))).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("signposts itself — a choice list that silently loses three entries would read as a bug", () => {
    const { state, graph } = fixture("tell");
    const free = ungrab(strike(state, graph));
    expect(combatNarration(free)).not.toContain("It has you");
    expect(combatNarration(grab(free))).toContain("It has you");
  });

  it("only ever grabs on a blow that ALSO wounds — the partition invariant, not a second roll", () => {
    // The grab costs no extra `combat` draw because it is the bottom slice of the retaliation float
    // that function has always drawn. The observable consequence of that — and the thing that breaks
    // the moment someone re-implements it as its own roll — is that a grab can never happen on an
    // exchange the enemy missed. If that ever stops holding, every T15–T81 combat measurement has
    // silently decoupled from the tree, so it is pinned rather than assumed.
    let grabs = 0;
    for (let i = 0; i < 300; i += 1) {
      const { state, graph } = fixture(`partition-${i}`, { zombie: "zombie.riot" });
      let s = state;
      for (let k = 0; k < 8; k += 1) {
        const before = s;
        s = strike(s, graph);
        if (s.combat === null || isRunOver(s)) break;
        const newlyGrabbed = isGrabbed(s) && !isGrabbed(before);
        if (newlyGrabbed) {
          grabs += 1;
          expect(s.player.condition.wounds.length).toBeGreaterThan(before.player.condition.wounds.length);
        }
      }
    }
    expect(grabs).toBeGreaterThan(20); // the invariant is worthless if nothing was ever grabbed
  });

  it("a player fighting ALONE never touches the party stream", () => {
    // The property that keeps a solo run's RNG exactly where T81 left it.
    const { state, graph } = fixture("stream");
    const after = strike(strike(state, graph), graph);
    expect(after.rng.streams["combat"]).toBeDefined();
    expect(after.rng.streams[PARTY_STREAM]).toBeUndefined();
  });

  it("GRAB_CHANCE is a minority of a minority, pinned against a literal", () => {
    // The T77 lesson: asserting a constant against itself lets any value survive mutation.
    expect(GRAB_CHANCE).toBeCloseTo(1 / 3, 10);
    expect(GRAB_CHANCE).toBeGreaterThan(0);
    expect(GRAB_CHANCE).toBeLessThan(1);
  });
});

describe("BREAK FREE — buying your way out back (T82)", () => {
  it("clears the grab when it succeeds, and DROPS the field rather than setting it false", () => {
    const { state, graph } = fixture("break");
    let s = grab(ungrab(strike(state, graph)));
    for (let i = 0; i < 40 && isGrabbed(s); i += 1) s = take(s, graph, "break");
    expect(isGrabbed(s)).toBe(false);
    // Absent-reads-as-false is the save shape (no schema rung), so an escaped fight must serialize
    // identically to one that was never grabbed.
    expect(Object.prototype.hasOwnProperty.call(s.combat!, "grabbed")).toBe(false);
  });

  it("a FAILED attempt is ANSWERED; a successful one is not — the verb is a gamble, not a free exit", () => {
    // The first cut of `resolveBreak` took its roll and returned, which made BREAK risk-free and
    // therefore strictly better than every other verb while grabbed. This is the regression test for
    // that, and it is written as two paired rates over DIFFERENT seeds — the earlier version of this
    // test re-ran one pure call sixty times, saw one outcome, and closed on
    // `expect(failures).toBeGreaterThanOrEqual(0)`, which is true of every possible number.
    let failed = 0, failedAndWounded = 0;
    let escaped = 0, escapedAndWounded = 0;
    for (let i = 0; i < 300; i += 1) {
      const { state, graph } = fixture(`breakfail-${i}`, { zombie: "zombie.riot" });
      const held = grab(ungrab(strike(state, graph)));
      const before = held.player.condition.wounds.length;
      const after = resolveCombatAction(held, graph, { type: "break", choiceId: "break", timeCost: 1, params: {} });
      const wounded = after.player.condition.wounds.length > before;
      if (isGrabbed(after)) {
        failed += 1;
        if (wounded) failedAndWounded += 1;
      } else {
        escaped += 1;
        if (wounded) escapedAndWounded += 1;
      }
    }
    // Both branches must actually occur, or neither rate below means anything.
    expect(failed).toBeGreaterThan(20);
    expect(escaped).toBeGreaterThan(20);
    // Getting clear is clean: you are out of its reach before it answers.
    expect(escapedAndWounded).toBe(0);
    // Failing is not. This is the assertion that a risk-free break cannot survive.
    expect(failedAndWounded).toBeGreaterThan(0);
    // …and it is answered at the BARE-HANDS rate, so a held player with an axe is not answered less
    // often for holding it. `MELEE_RETALIATE_CHANCE` is 0.5 and a Riot has no `initiative`, so the
    // observed rate must sit around half of the failures rather than at 0 or at 1.
    expect(failedAndWounded).toBeGreaterThan(failed * 0.25);
    expect(failedAndWounded).toBeLessThan(failed * 0.75);
  });

  it("is a total no-op on a fight that is not grabbed, and off a fight entirely", () => {
    const { state, graph } = fixture("noop");
    const free = ungrab(strike(state, graph));
    const act = { type: "break", choiceId: "break", timeCost: 1, params: {} };
    expect(resolveCombatAction(free, graph, act)).toBe(free);
    expect(resolveCombatAction(state, graph, act)).toBe(state);
  });

  it("your people make it likelier, and the bonus is capped", () => {
    // Pinned against LITERALS, not against the constants themselves. The first version of this test
    // asserted `breakFreeChance(one) === BREAK_BASE + BREAK_PER_COMPANION`, which is equally true when
    // BREAK_PER_COMPANION is 0 — so a mutant that deleted the companion bonus outright survived it.
    // The T77 rule: assert a ceiling against a literal, or the assertion is the code restated.
    expect(BREAK_BASE).toBeCloseTo(0.55, 10);
    expect(BREAK_PER_COMPANION).toBeCloseTo(0.15, 10);
    expect(BREAK_PER_COMPANION).toBeGreaterThan(0); // the party MUST change this number

    const solo = fixture("chance").state;
    expect(breakFreeChance(solo)).toBeCloseTo(0.55, 10);
    const one = fixture("chance1", { party: [[90, "follow"]] }).state;
    expect(breakFreeChance(one)).toBeCloseTo(0.70, 10);
    expect(breakFreeChance(one)).toBeGreaterThan(breakFreeChance(solo));
    const three = fixture("chance3", { party: [[90, "follow"], [90, "follow"], [90, "follow"]] }).state;
    expect(breakFreeChance(three)).toBeCloseTo(0.95, 10);
    // …and a fourth buys nothing, because the cap has already bitten.
    const many = fixture("chanceN", { party: [[90, "follow"], [90, "follow"], [90, "follow"], [90, "follow"]] }).state;
    expect(breakFreeChance(many)).toBeCloseTo(0.95, 10);
    expect(BREAK_MAX).toBeCloseTo(0.95, 10);
    expect(BREAK_MAX).toBeLessThan(1); // nothing is ever certain — the T77 clamp rule
    // An untrusted companion contributes nothing here either — the gate is one definition, not two.
    const shy = fixture("chanceShy", { party: [[ORDER_TRUST_MIN - 1, "follow"]] }).state;
    expect(breakFreeChance(shy)).toBeCloseTo(0.55, 10);
  });
});

// --- 2. the Last Stand ---------------------------------------------------------------------------

describe("the LAST STAND — a fight can finally end the run (T82 · GDD IX · ADR-0007)", () => {
  it("needs BOTH conjuncts: being held, and carrying too much", () => {
    const { state, graph } = fixture("both");
    const fighting = ungrab(strike(state, graph));
    expect(inLastStand(hurt(fighting, LAST_STAND_AT))).toBe(false); // hurt, not held
    expect(inLastStand(grab(hurt(fighting, LAST_STAND_AT - 1)))).toBe(false); // held, not hurt enough
    expect(inLastStand(grab(hurt(fighting, LAST_STAND_AT)))).toBe(true); // both
  });

  it("a badly hurt player OUT of a fight is never ended by the burden alone — this is not a health bar", () => {
    // The whole of ADR-0007 in one assertion: 400 points of untreated damage costs the player scent,
    // drift and a worse stealth roll, and never once costs them the run.
    const { state } = fixture("nohp");
    const wrecked = hurt(state, 100);
    expect(woundBurden(wrecked.player.condition)).toBeGreaterThanOrEqual(LAST_STAND_AT);
    expect(wrecked.combat).toBeNull();
    expect(runEndReason(wrecked)).toBeNull();
    expect(isRunOver(wrecked)).toBe(false);
  });

  it("reports `lastStand`, ahead of the slower deaths, with its own ending", () => {
    const { state, graph } = fixture("reason");
    const doomed = grab(hurt(ungrab(strike(state, graph)), LAST_STAND_AT));
    expect(runEndReason(doomed)).toBe("lastStand");
    // Proximate cause wins: a player who is also dying of thirst died in the grapple.
    const thirsty: GameState = {
      ...doomed,
      player: { ...doomed.player, condition: { ...doomed.player.condition, needs: { ...doomed.player.condition.needs, thirst: 100 } } },
    };
    expect(runEndReason(thirsty)).toBe("lastStand");
    expect(endingNarration("lastStand")).toMatch(/\S/);
    expect(endingNarration("lastStand")).not.toBe(endingNarration("infection"));
  });

  it("END TO END through availableActions + applyAction — the run really stops", () => {
    // The T81 lesson: a suite that only ever calls the resolver directly cannot tell whether the thing
    // is WIRED. This one plays it the way the client does, and nothing else in this file does that.
    const { state, graph } = fixture("e2e");
    let s = hurt(take(state, graph, "fight"), LAST_STAND_AT);
    expect(isRunOver(s)).toBe(false);
    expect(availableActions(s, graph).length).toBeGreaterThan(0);
    let ended = false;
    for (let i = 0; i < 60; i += 1) {
      if (s.combat === null) { s = take(s, graph, "fight"); s = hurt(s, LAST_STAND_AT); continue; }
      s = grab(s);
      if (isRunOver(s)) { ended = true; break; }
      s = take(s, graph, "strike");
      s = hurt(s, LAST_STAND_AT);
    }
    expect(ended).toBe(true);
    expect(runEndReason(s)).toBe("lastStand");
    // A finished run offers nothing — the no-soft-lock invariant's other half (T57): the list is empty
    // because the run is OVER, which is the one legitimate reason for it to be.
    expect(availableActions(s, graph)).toEqual([]);
  });

  it("ends a run the ENGINE produced — nothing forced, nothing hand-built", () => {
    // The end-to-end test above proves the WIRING, but it hand-forces `grab()` and `hurt()` every
    // iteration, so it cannot tell you whether the engine ever reaches that state on its own. This one
    // touches nothing: it picks the fight through `availableActions`, takes `strike` through
    // `applyAction`, and lets the engine grab the player and hurt the player if it is going to. The
    // audit's fair complaint about the first draft of this suite was that no test did this.
    let lastStands = 0;
    let survivedTheFight = 0;
    for (let i = 0; i < 120; i += 1) {
      const { state, graph } = fixture(`organic-${i}`, { zombie: "zombie.riot" });
      let s = state;
      for (let k = 0; k < 30; k += 1) {
        if (isRunOver(s)) break;
        const choices = availableActions(s, graph);
        const pick = choices.find((c) => c.id === "strike") ?? choices.find((c) => c.id === "fight");
        if (pick === undefined) break;
        s = applyAction(s, pick.action, graph).state;
        if (s.combat === null) break;
      }
      if (runEndReason(s) === "lastStand") {
        lastStands += 1;
        expect(isGrabbed(s)).toBe(true);
        expect(woundBurden(s.player.condition)).toBeGreaterThanOrEqual(LAST_STAND_AT);
        expect(availableActions(s, graph)).toEqual([]);
      } else if (s.combat === null && !isRunOver(s)) {
        survivedTheFight += 1;
      }
    }
    // Both outcomes must be reachable: a fight that can ALWAYS be lost is as broken as one that never
    // can, and before T82 this number was zero for the whole history of the project.
    expect(lastStands).toBeGreaterThan(0);
    expect(survivedTheFight).toBeGreaterThan(0);
  });

  it("LAST_STAND_AT is pinned against a literal, and is a burden a real run reaches", () => {
    expect(LAST_STAND_AT).toBe(80);
    // Two untreated bites (40 each) — reachable, and reachable ONLY by taking damage you did not treat.
    expect(LAST_STAND_AT).toBeGreaterThan(40);
  });

  it("survives a save round-trip, and a pre-T82 save reads as not grabbed (no schema rung)", () => {
    const { state, graph } = fixture("save");
    const held = grab(ungrab(strike(state, graph)));
    const back = loadGame(saveGame(held));
    expect(back.combat!.grabbed).toBe(true);
    expect(inLastStand(hurt(back, LAST_STAND_AT))).toBe(true);

    // A save written before T82 has no such field at all. It must read as "nothing has hold of you" —
    // which means the retreats come back AND the Last Stand cannot fire, however hurt the player is.
    const legacy = JSON.parse(saveGame(held)) as { state: { combat: Record<string, unknown> } };
    delete legacy.state.combat["grabbed"];
    const old = loadGame(JSON.stringify(legacy));
    expect(old.combat!.grabbed).toBeUndefined();
    expect(isGrabbed(old)).toBe(false);
    expect(runEndReason(hurt(old, LAST_STAND_AT * 10))).toBeNull();
    expect(ids(old, graph).filter((x) => x.startsWith("retreat")).length).toBeGreaterThan(0);
  });
});

// --- 3. the party in the fight -------------------------------------------------------------------

describe("the party is in the fight at last (T82 · FR-NPC-03 · closes PL-M4-07)", () => {
  it("an UNTRUSTED companion hangs back — byte-identical to fighting alone", () => {
    // The trust ladder gets teeth: a companion recruited at 70 and never fed will follow you, watch,
    // and do nothing. Proven by identity of the whole state, not by a rate.
    const solo = fixture("trust", {});
    const shy = fixture("trust", { party: [[ORDER_TRUST_MIN - 1, "follow"]] });
    expect(fightingCompanions(shy.state, "node.x.a")).toEqual([]);
    const a = strike(strike(solo.state, solo.graph), solo.graph);
    const b = strike(strike(shy.state, shy.graph), shy.graph);
    expect(b.player.condition.wounds).toEqual(a.player.condition.wounds);
    expect(b.combat).toEqual(a.combat);
    expect(b.rng.streams[PARTY_STREAM]).toBeUndefined();
  });

  it("a HELD companion stays out of it — the order is honoured", () => {
    const held = fixture("order", { party: [[95, "hold"]] });
    expect(fightingCompanions(held.state, "node.x.a")).toEqual([]);
  });

  it("a trusted follower swings — the same fight ends sooner", () => {
    const hours = (party?: Opts["party"]): number => {
      let total = 0;
      for (let i = 0; i < 60; i += 1) {
        const { state, graph } = fixture(`swing-${i}`, { zombie: "zombie.riot", ...(party === undefined ? {} : { party }) });
        let s = state;
        let n = 0;
        while (n < 40 && !isRunOver(s) && (s.combat !== null || n === 0)) {
          s = { ...strike(s, graph), player: { ...strike(s, graph).player, condition: { ...strike(s, graph).player.condition, wounds: [] } } };
          n += 1;
          if (s.combat === null) break;
        }
        total += n;
      }
      return total;
    };
    expect(hours([[90, "follow"], [90, "follow"], [90, "follow"]])).toBeLessThan(hours());
  });

  it("a companion takes the blow that was coming to you — and the soak is capped", () => {
    let companionHurt = 0;
    for (let i = 0; i < 200; i += 1) {
      const { state, graph } = fixture(`soak-${i}`, { zombie: "zombie.riot", party: [[90, "follow"]] });
      let s = state;
      for (let k = 0; k < 6 && s.combat !== null || k === 0; k += 1) {
        s = strike(s, graph);
        if (s.combat === null) break;
      }
      const c = (s.actors as Record<string, Survivor>)["npc.c0"];
      if (c !== undefined && c.condition.wounds.length > 0) companionHurt += 1;
    }
    expect(companionHurt).toBeGreaterThan(0);
    // A crowd cannot absorb everything — the correction the measurement forced.
    expect(COMPANION_SOAK_MAX).toBeLessThan(1);
    expect(COMPANION_SOAK * 3).toBeGreaterThan(COMPANION_SOAK_MAX);
  });

  it("a companion who takes enough DIES — permanently, by name, through killCompanion", () => {
    // killCompanion has been exported since T36 and called by nothing. This is its first caller.
    const { state, graph } = fixture("die", { zombie: "zombie.riot", party: [[90, "follow"]] });
    const nearly: GameState = {
      ...state,
      actors: {
        ...state.actors,
        "npc.c0": {
          ...(state.actors as Record<string, Survivor>)["npc.c0"]!,
          condition: {
            ...(state.actors as Record<string, Survivor>)["npc.c0"]!.condition,
            wounds: [{ type: "wound.bite" as ContentId, site: "arm", severity: COMPANION_FATAL_BURDEN - 1, treated: 0, inflictedDay: 1 }],
          },
        },
      },
    };
    let s = nearly;
    let gone = false;
    for (let i = 0; i < 200; i += 1) {
      s = strike(s, graph);
      if ((s.actors as Record<string, Survivor>)["npc.c0"] === undefined) { gone = true; break; }
      if (s.combat === null || isRunOver(s)) {
        const fresh = fixture(`die-${i}`, { zombie: "zombie.riot", party: [[90, "follow"]] });
        s = { ...fresh.state, actors: nearly.actors };
      }
    }
    expect(gone).toBe(true);
    expect(s.player.flags["fallen.npc.c0"]).toBe(true);
  });

  it("a companion's swing can MISS and can LAND — the hit chance is neither 0 nor 1", () => {
    // Both mutants (`COMPANION_HIT_CHANCE` → 0 and → 1) survived the first mutation round: nothing in
    // the suite looked at what a companion's swing actually did, only at its downstream effects.
    expect(COMPANION_HIT_CHANCE).toBeCloseTo(0.4, 10);
    let missed = 0, landed = 0;
    for (let i = 0; i < 200; i += 1) {
      const { state, graph } = fixture(`hit-${i}`, { zombie: "zombie.riot", party: [[90, "follow"]] });
      const before = strike(state, graph); // opens the fight; party swings on the NEXT exchange
      if (before.combat === null) continue;
      const after = strike(before, graph);
      if (after.combat === null) continue;
      // The player's own swing is 1–2 through armor 1, i.e. 0 or 1. Anything past 1 point of drop is
      // the companion; a drop of 0 means neither of them got through.
      const drop = before.combat.hp - after.combat.hp;
      if (drop >= 2) landed += 1;
      else missed += 1;
    }
    expect(landed).toBeGreaterThan(0);
    expect(missed).toBeGreaterThan(0);
  });

  it("a companion never pierces armor — the Riot stays a weapon problem, not a headcount problem", () => {
    // T80 made the Riot's armor a weapon-selection problem. A companion who punched through it would
    // make it a party-size problem instead, which is the power tier the GDD forbids for weapons and
    // should equally forbid for people.
    expect(COMPANION_DMG_MIN).toBe(1);
    expect(COMPANION_DMG_MAX).toBe(2);
    const armor = ENEMIES["enemy.riot"]!.armor;
    expect(armor).toBe(1);
    // Three companions, each at most (2 − 1) through the plate, plus the player's own (2 − 1): a
    // single exchange can never take more than 4 off a Riot. Piercing would allow 2 each, i.e. 8.
    let worst = 0;
    for (let i = 0; i < 300; i += 1) {
      const { state, graph } = fixture(`pierce-${i}`, { zombie: "zombie.riot", party: [[90, "follow"], [90, "follow"], [90, "follow"]] });
      const before = strike(state, graph);
      if (before.combat === null) continue;
      const after = strike(before, graph);
      const hp = after.combat === null ? 0 : after.combat.hp;
      worst = Math.max(worst, before.combat.hp - hp);
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(COMPANION_DMG_MAX - armor + (COMPANION_DMG_MAX - armor) * 3);
  });

  it("a companion's KILLING BLOW is not answered — a corpse does not swing", () => {
    // The regression test for the defect the audit found and I first fixed WITHOUT one: `resolveStrike`
    // retaliated unconditionally after the party's swings, so an enemy a COMPANION had just put down —
    // already cleared from `combat` and struck from the roster — still took a draw and landed a wound,
    // on 15% of party kill turns. A walker is used deliberately: it has no `burstInfection`, so on a
    // kill turn there is no legitimate source of a wound at all and any wound is the corpse's.
    let killTurns = 0, woundedByACorpse = 0;
    for (let i = 0; i < 400; i += 1) {
      const { state, graph } = fixture(`corpse-${i}`, { party: [[90, "follow"], [90, "follow"], [90, "follow"]] });
      let s = strike(state, graph);
      for (let k = 0; k < 8; k += 1) {
        if (s.combat === null || isRunOver(s)) break;
        const before = s;
        s = strike(s, graph);
        if (s.combat === null) {
          killTurns += 1;
          const playerHurt = s.player.condition.wounds.length > before.player.condition.wounds.length;
          const partyHurt =
            Object.values(s.actors as Record<string, Survivor>).filter((a) => a.flags[COMPANION_FLAG] === true)
              .reduce((n, a) => n + a.condition.wounds.length, 0) >
            Object.values(before.actors as Record<string, Survivor>).filter((a) => a.flags[COMPANION_FLAG] === true)
              .reduce((n, a) => n + a.condition.wounds.length, 0);
          if (playerHurt || partyHurt) woundedByACorpse += 1;
          break;
        }
      }
    }
    expect(killTurns).toBeGreaterThan(50); // the probe has to be reaching kills at all
    expect(woundedByACorpse).toBe(0);
  });

  it("the soak does not always fall on the same companion", () => {
    // `idx = 0` survived the first round: nothing checked WHICH companion stepped in, so three
    // companions could have been one companion and two bystanders.
    const took = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const { state, graph } = fixture(`spread-${i}`, { zombie: "zombie.riot", party: [[90, "follow"], [90, "follow"], [90, "follow"]] });
      let s = strike(state, graph);
      for (let k = 0; k < 6; k += 1) {
        if (s.combat === null || isRunOver(s)) break;
        const before = s;
        s = strike(s, graph);
        for (const id of ["npc.c0", "npc.c1", "npc.c2"]) {
          const a = (before.actors as Record<string, Survivor>)[id];
          const b = (s.actors as Record<string, Survivor>)[id];
          if (a !== undefined && (b === undefined || b.condition.wounds.length > a.condition.wounds.length)) took.add(id);
        }
      }
    }
    expect(took.size).toBe(3);
  });

  it("COMPANION_FATAL_BURDEN is a threshold the player can read on them, pinned against a literal", () => {
    expect(COMPANION_FATAL_BURDEN).toBe(60);
    // The property that makes it legible rather than arbitrary: a companion survives any ONE wound the
    // walker table can deal (40 or 30) and dies on the second. If someone raises it past 70 the party
    // stops being losable — measured, 0 of 360 at 100 — and if they drop it to 40 a single bite kills
    // with no warning. Both edges are pinned here so a tuning change has to argue with them.
    expect(COMPANION_FATAL_BURDEN).toBeGreaterThan(40); // one bite must not be instantly fatal
    expect(COMPANION_FATAL_BURDEN).toBeLessThanOrEqual(70); // two wounds must be
    // Deliberately NOT the player's line: the player dies of a situation, the companion of a wound count.
    expect(COMPANION_FATAL_BURDEN).not.toBe(LAST_STAND_AT);
  });
});
