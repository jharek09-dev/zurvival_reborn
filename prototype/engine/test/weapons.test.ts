import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BARE_HANDS,
  ENEMIES,
  HEAVY_NOISE_MULT,
  MELEE_NOISE,
  PUSH_NOISE,
  WEAPONS,
  WEAPON_BARE,
  WEAPON_SLOT,
  applyAction,
  availableActions,
  combatChoices,
  combatNarration,
  drawFloat,
  resolveCombatAction,
  surestOf,
  wearWeaponOnStrike,
  effectiveDamage,
  firearmFor,
  loadGame,
  retaliateChance,
  saveGame,
  startRun,
  weaponFor,
  weaponProfile,
  withRoster,
  type ContentId,
  type GameState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type SceneChoice,
} from "../src/index.js";

/**
 * T80 — weapon profiles and the two missing combat verbs (FR-CBT-02 · FR-CBT-04 · FR-PLR-04).
 *
 * Three claims under test: what you hold changes the fight, a shot can miss and be answered, and the
 * two new verbs each pay for what they buy. The fourth claim — that an EMPTY-HANDED fight is arithmetic
 * ally untouched — is carried by `combat.test.ts` and the other 51 suites continuing to pass, and is
 * pinned directly in "bare hands is the pre-T80 profile" below.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true, walkers: 1 },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a store", adjacent: ["node.x.a"] },
];
const run = (seed = "t80"): { state: GameState; graph: RegionGraph } =>
  startRun({ seed, createdAt: "2026-09-13T00:00:00Z" }, REGIONS, NODES);

/** Put one body of `zombie` at the start node, optionally equipping a weapon / loading a gun. */
function fixture(
  seed: string,
  opts: { zombie?: ContentId; weapon?: ContentId; durability?: number | null; rounds?: number; loud?: boolean } = {},
): { state: GameState; graph: RegionGraph } {
  const { state, graph } = run(seed);
  const base = state.nodes["node.x.a"]!;
  const here = opts.loud === true ? { ...base, noise: 60, zombieState: "chasing" as const } : base;
  let next: GameState = {
    ...state,
    nodes: { ...state.nodes, "node.x.a": withRoster(here, [opts.zombie ?? "zombie.walker"]) },
  };
  if ((opts.rounds ?? 0) > 0) {
    next = { ...next, player: { ...next.player, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.ammo", quantity: opts.rounds! }] } };
  }
  if (opts.weapon !== undefined) {
    const id = `${opts.weapon}#fx`;
    next = {
      ...next,
      items: { ...next.items, [id]: { type: opts.weapon, quality: 100, durability: opts.durability === undefined ? 100 : opts.durability, metadata: {} } },
      player: {
        ...next.player,
        inventory: [...next.player.inventory, { type: opts.weapon, quantity: 1, itemId: id }],
        equipment: { ...next.player.equipment, [WEAPON_SLOT]: id },
      },
    };
  }
  return { state: next, graph };
}

const offered = (s: GameState, g: RegionGraph): string[] => availableActions(s, g).map((c) => c.id);
function take(state: GameState, graph: RegionGraph, choiceId: string): GameState {
  const c = availableActions(state, graph).find((x) => x.id === choiceId);
  if (!c) throw new Error(`no choice ${choiceId}; offered: ${offered(state, graph).join(",")}`);
  return applyAction(state, c.action, graph).state;
}
const choice = (state: GameState, graph: RegionGraph, id: string): SceneChoice =>
  availableActions(state, graph).find((c) => c.id === id)!;
const wounds = (s: GameState): number => s.player.condition.wounds.length;

// --- the table ------------------------------------------------------------------------------

describe("weapon profiles (T80 · FR-CBT-04 · FR-PLR-04)", () => {
  it("bare hands is the pre-T80 profile exactly — 1–2 damage, melee noise, no pierce, no wear", () => {
    expect(BARE_HANDS.id).toBe(WEAPON_BARE);
    expect([BARE_HANDS.dmgMin, BARE_HANDS.dmgMax]).toEqual([1, 2]);
    expect(BARE_HANDS.noise).toBe(MELEE_NOISE);
    expect(BARE_HANDS.armorPierce).toBe(0);
    expect(BARE_HANDS.durabilityCost).toBe(0);
    expect(BARE_HANDS.retaliateModifier).toBe(0);
    expect(BARE_HANDS.accuracy).toBe(1); // always lands ⇒ no draw ⇒ the T15 combat stream is unchanged
  });

  it("an empty-handed player fights with bare hands; the equipped artifact replaces it", () => {
    expect(weaponFor(run().state).id).toBe(WEAPON_BARE);
    expect(weaponFor(fixture("a", { weapon: "item.tool-reinforced" }).state).id).toBe("item.tool-reinforced");
  });

  it("a BROKEN weapon is bare hands — durability 0 drops the profile, null keeps it", () => {
    expect(weaponFor(fixture("a", { weapon: "item.tool-reinforced", durability: 0 }).state).id).toBe(WEAPON_BARE);
    expect(weaponFor(fixture("a", { weapon: "item.tool-reinforced", durability: null }).state).id).toBe("item.tool-reinforced");
    expect(weaponFor(fixture("a", { weapon: "item.tool-reinforced", durability: 1 }).state).id).toBe("item.tool-reinforced");
  });

  it("an unknown item type, a missing instance, and an equipped FIREARM all read as bare hands", () => {
    expect(weaponProfile("item.blanket").id).toBe(WEAPON_BARE);
    expect(weaponProfile(undefined).id).toBe(WEAPON_BARE);
    expect(weaponFor(fixture("a", { weapon: "item.pistol" }).state).id).toBe(WEAPON_BARE); // no pistol-whip verb
    const orphan = fixture("a");
    const state: GameState = { ...orphan.state, player: { ...orphan.state.player, equipment: { [WEAPON_SLOT]: "nope#1" } } };
    expect(weaponFor(state).id).toBe(WEAPON_BARE);
  });

  it("every firearm row is flat-damage and pierces every armor value in the game", () => {
    const armors = Object.values(ENEMIES).map((e) => e.armor);
    for (const w of Object.values(WEAPONS).filter((x) => x.kind === "firearm")) {
      expect(w.dmgMin).toBe(w.dmgMax); // flat ⇒ rollDamage takes no draw
      expect(w.accuracy).toBeLessThan(1); // the T80 fix: no firearm is a certainty
      for (const armor of armors) expect(effectiveDamage(w.dmgMin, armor, w.armorPierce)).toBe(w.dmgMin);
    }
  });
});

describe("the arithmetic, pinned without a GameState (T80)", () => {
  it("effectiveDamage reproduces both pre-T80 rules and adds the middle one", () => {
    expect(effectiveDamage(2, 1, 0)).toBe(1); // bare hands vs the Riot — the old `dmg - armor`
    expect(effectiveDamage(1, 1, 0)).toBe(0); // ...floored at 0, as it always was
    expect(effectiveDamage(3, 1, 3)).toBe(3); // a shot — "armor never reduces a shot"
    expect(effectiveDamage(2, 1, 1)).toBe(2); // NEW: a melee weapon that answers riot plate
  });

  it("effectiveDamage never returns a negative, for any inputs", () => {
    fc.assert(fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }),
      (d, a, p) => effectiveDamage(d, a, p) >= 0));
  });

  const base = { melee: 0.5, firearm: 0.25 };
  it("a committed swing and a fast dead are ALWAYS answered; a weapon modifier cannot lower either", () => {
    const reach = { ...BARE_HANDS, retaliateModifier: -90 };
    expect(retaliateChance(base, BARE_HANDS, { initiative: false, heavy: true })).toBe(1);
    expect(retaliateChance(base, reach, { initiative: false, heavy: true })).toBe(1);
    expect(retaliateChance(base, reach, { initiative: true, heavy: false })).toBe(1);
  });

  it("otherwise the base is the blow's kind, shifted by the weapon and clamped", () => {
    expect(retaliateChance(base, BARE_HANDS, { initiative: false, heavy: false })).toBe(0.5);
    expect(retaliateChance(base, WEAPONS["item.pistol"]!, { initiative: false, heavy: false })).toBe(0.25);
    expect(retaliateChance(base, WEAPONS["item.tool-reinforced"]!, { initiative: false, heavy: false })).toBeCloseTo(0.4, 10);
    expect(retaliateChance(base, { ...BARE_HANDS, retaliateModifier: -500 }, { initiative: false, heavy: false })).toBe(0);
    expect(retaliateChance(base, { ...BARE_HANDS, retaliateModifier: 500 }, { initiative: false, heavy: false })).toBe(1);
    expect(retaliateChance(base, { ...BARE_HANDS, retaliateModifier: Number.NaN }, { initiative: false, heavy: false })).toBe(0);
  });

  it("surestOf breaks an accuracy TIE by id, so the pack's order can never decide it", () => {
    // Unreachable with the five shipped rows (no two share an accuracy), which is exactly why it is
    // tested here on a constructed pair rather than left to rot behind the table.
    const a = { ...WEAPONS["item.pistol"]!, id: "item.aaa" as ContentId, accuracy: 0.5 };
    const z = { ...WEAPONS["item.pistol"]!, id: "item.zzz" as ContentId, accuracy: 0.5 };
    expect(surestOf([z, a])!.id).toBe("item.aaa");
    expect(surestOf([a, z])!.id).toBe("item.aaa");
    expect(surestOf([])).toBeUndefined();
  });

  it("firearmFor brings up the surest gun in the pack, ties broken by id, pistol as the floor", () => {
    const p = run().state.player;
    expect(firearmFor({ ...p, inventory: [{ type: "item.pistol", quantity: 1 }] }).id).toBe("item.pistol");
    expect(firearmFor({ ...p, inventory: [{ type: "item.pistol", quantity: 1 }, { type: "item.shotgun", quantity: 1 }] }).id).toBe("item.shotgun");
    expect(firearmFor({ ...p, inventory: [{ type: "item.rifle", quantity: 1 }, { type: "item.shotgun", quantity: 1 }] }).id).toBe("item.shotgun");
    expect(firearmFor({ ...p, inventory: [] }).id).toBe("item.pistol"); // unarmed never reaches this, but it is total
    expect(firearmFor({ ...p, inventory: [{ type: "item.pistol", quantity: 0 }] }).id).toBe("item.pistol");
  });
});

// --- what you hold changes the fight -----------------------------------------------------------

describe("equipment defines capability (T80 · FR-PLR-04)", () => {
  it("the same fight against the Riot is hours shorter with a piercing weapon than with fists", () => {
    const play = (weapon?: ContentId): number => {
      let { state, graph } = fixture("riot-1", { zombie: "zombie.riot", ...(weapon !== undefined ? { weapon } : {}) });
      state = take(state, graph, "fight");
      let blows = 1;
      while (state.combat !== null && blows < 40) { state = take(state, graph, "strike"); blows += 1; }
      return blows;
    };
    expect(play("item.tool-reinforced")).toBeLessThan(play());
  });

  it("a melee blow spends the weapon's own durability, and a heavy swing spends double", () => {
    const wear = (heavy: boolean): number => {
      const { state, graph } = fixture("wear", { weapon: "item.tool-reinforced" });
      const after = take(state, graph, heavy ? "heavy" : "fight");
      const id = after.player.equipment[WEAPON_SLOT]!;
      return 100 - (after.items[id]?.durability ?? 0);
    };
    expect(wear(false)).toBe(WEAPONS["item.tool-reinforced"]!.durabilityCost);
    expect(wear(true)).toBe(WEAPONS["item.tool-reinforced"]!.durabilityCost * 2);
  });

  it("bare hands wear nothing, even with a durability artifact equipped but broken", () => {
    const { state, graph } = fixture("wear2", { weapon: "item.tool-reinforced", durability: 0 });
    const after = take(state, graph, "fight");
    expect(after.items[after.player.equipment[WEAPON_SLOT]!]?.durability).toBe(0);
  });

  it("the choice label names what you are swinging — and stops naming it once it breaks", () => {
    expect(choice(fixture("l1", { weapon: "item.tool-reinforced" }).state, fixture("l1").graph, "fight").label)
      .toBe("Fight the walker with the reinforced tool");
    expect(choice(run().state, run().graph, "fight").label).toBe("Fight the walker"); // unchanged since T15
    expect(choice(fixture("l2", { weapon: "item.tool-reinforced", durability: 0 }).state, fixture("l2").graph, "fight").label)
      .toBe("Fight the walker");
  });

  it("a heavier weapon deposits its own noise, and a heavy swing doubles it — at the node AND in the fight", () => {
    const { state, graph } = fixture("n", { weapon: "item.tool-reinforced" });
    const tool = WEAPONS["item.tool-reinforced"]!;
    expect(choice(state, graph, "fight").action.params!["noise"]).toBe(tool.noise);
    expect(choice(state, graph, "heavy").action.params!["noise"]).toBe(tool.noise * HEAVY_NOISE_MULT);
    expect(choice(run().state, run().graph, "fight").action.params!["noise"]).toBe(MELEE_NOISE); // bare hands, unchanged
    // ...and again once the fight is live, where a separate menu builds the same two verbs.
    const inFight = { ...state, combat: { node: "node.x.a", enemy: "enemy.walker", hp: 3, maxHp: 3, alerted: true } } as GameState;
    const byId = (id: string): SceneChoice => combatChoices(inFight, graph).find((c) => c.id === id)!;
    expect(byId("strike").action.params!["noise"]).toBe(tool.noise);
    expect(byId("heavy").action.params!["noise"]).toBe(tool.noise * HEAVY_NOISE_MULT);
    expect(byId("strike").label).toBe("Strike with the reinforced tool");
  });
});

// --- firing is no longer free ------------------------------------------------------------------

describe("firing is fallible (T80 · the design review's dominant strategy)", () => {
  /** Fire once at a full-hp walker across many seeds; a pistol one-shots it *when it lands*. */
  const shots = (n: number): { misses: number; hurt: number } => {
    let misses = 0;
    let hurt = 0;
    for (let i = 0; i < n; i += 1) {
      const { state, graph } = fixture(`fire-${i}`, { rounds: 3 });
      const after = take(state, graph, "fire");
      if (after.combat !== null || after.nodes["node.x.a"]!.walkers > 0) misses += 1;
      if (wounds(after) > 0) hurt += 1;
    }
    return { misses, hurt };
  };

  it("some shots miss, and a miss still spends the round and deposits the full bang", () => {
    const { misses } = shots(200);
    expect(misses).toBeGreaterThan(0);
    expect(misses).toBeLessThan(200); // ...and some land: the accuracy dial is a dial, not a wall
    // find a seed that missed and pin what it still cost
    let missed: GameState | null = null;
    for (let i = 0; i < 200 && missed === null; i += 1) {
      const { state, graph } = fixture(`fire-${i}`, { rounds: 3 });
      const after = take(state, graph, "fire");
      if (after.combat !== null) missed = after;
    }
    expect(missed).not.toBeNull();
    expect(missed!.player.inventory.find((e) => e.type === "item.ammo")!.quantity).toBe(2); // the round is gone
    expect(missed!.nodes["node.x.a"]!.noise).toBeGreaterThanOrEqual(WEAPONS["item.pistol"]!.noise);
    expect(missed!.combat!.hp).toBe(missed!.combat!.maxHp); // and it is untouched
  });

  it("a shot CAN now hurt you — the pre-T80 rate was exactly zero", () => {
    expect(shots(200).hurt).toBeGreaterThan(0);
  });

  it("but a shot that puts the body down is never answered", () => {
    for (let i = 0; i < 60; i += 1) {
      const { state, graph } = fixture(`kill-${i}`, { rounds: 3 });
      const after = take(state, graph, "fire");
      if (after.combat === null && after.nodes["node.x.a"]!.walkers === 0) expect(wounds(after)).toBe(0);
    }
  });

  it("a flat-damage weapon takes exactly ONE combat draw on a killing shot — the accuracy roll", () => {
    // Resolved through the combat layer directly so nothing else in the pipeline can touch the stream
    // (`combat` is drawn from nowhere else in the engine). A firearm is flat, so there is no damage
    // draw; a killing shot is not answered, so there is no retaliation draw. One draw, and this pins it.
    for (let i = 0; i < 40; i += 1) {
      const { state, graph } = fixture(`draws-${i}`, { rounds: 2 });
      const after = resolveCombatAction(state, graph, { type: "fire", timeCost: 1 });
      if (after.combat !== null) continue; // a miss (2 draws) or a survivor — not the case under test
      const oneDraw = drawFloat(state.rng, state.meta.seed, "combat").rng;
      expect(after.rng.streams["combat"]).toEqual(oneDraw.streams["combat"]);
      return;
    }
    throw new Error("no killing shot in 40 seeds");
  });

  it("out of ammo, the shot is not offered at all (unchanged since T15)", () => {
    const { state, graph } = fixture("dry", { rounds: 0 });
    expect(offered(state, graph)).not.toContain("fire");
  });
});

// --- the two new verbs -------------------------------------------------------------------------

describe("six verbs (T80 · FR-CBT-02)", () => {
  it("a live fight offers strike, heavy, push, fire and a retreat; the contested node offers the slip", () => {
    const { state, graph } = fixture("verbs", { rounds: 2 });
    expect(offered(state, graph)).toEqual(expect.arrayContaining(["fight", "heavy", "fire", "slip:node.x.b"]));
    const fighting = take(state, graph, "fight");
    expect(offered(fighting, graph)).toEqual(expect.arrayContaining(["strike", "heavy", "push", "fire", "retreat:node.x.b"]));
  });

  it("HEAVY hits for double and is ALWAYS answered — including by the body it puts down", () => {
    // A walker is 3hp; a heavy bare-handed swing is 2–4, so it lands the kill about half the time.
    let killedOutright = 0;
    for (let i = 0; i < 40; i += 1) {
      const { state, graph } = fixture(`heavy-${i}`);
      const after = take(state, graph, "heavy");
      expect(wounds(after)).toBeGreaterThan(0); // the guarantee, whatever the outcome
      if (after.combat === null) killedOutright += 1;
    }
    expect(killedOutright).toBeGreaterThan(0);
    expect(killedOutright).toBeLessThan(40);
  });

  it("HEAVY ends a fight in fewer blows than STRIKE, which is what it is buying", () => {
    const blowsTo = (verb: "strike" | "heavy"): number => {
      let { state, graph } = fixture("blows", { zombie: "zombie.riot" });
      state = take(state, graph, verb === "heavy" ? "heavy" : "fight");
      let n = 1;
      while (state.combat !== null && n < 40) { state = take(state, graph, verb); n += 1; }
      return n;
    };
    expect(blowsTo("heavy")).toBeLessThan(blowsTo("strike"));
  });

  it("PUSH deals no damage, shoves it off balance, clears alerted, and is not offered twice", () => {
    const { state, graph } = fixture("push");
    const fighting = take(state, graph, "fight");
    expect(fighting.combat!.alerted).toBe(true);
    const hp = fighting.combat!.hp;
    const shoved = take(fighting, graph, "push");
    expect(shoved.combat!.hp).toBe(hp); // no damage
    expect(shoved.combat!.alerted).toBe(false);
    expect(shoved.combat!.offBalance).toBe(true);
    expect(wounds(shoved)).toBe(wounds(fighting)); // and no answer
    expect(offered(shoved, graph)).not.toContain("push");
    expect(choice(fighting, graph, "push").action.params!["noise"]).toBe(PUSH_NOISE);
  });

  it("any blow spends the shove — a strike and a shot both, and it cannot be banked", () => {
    // The Riot is 5hp: neither a bare-handed strike nor a single pistol round can end the fight, so both
    // branches are guaranteed to be exercised rather than skipped by a lucky kill.
    for (const verb of ["strike", "fire"] as const) {
      const { state, graph } = fixture("bank", { zombie: "zombie.riot", rounds: 3 });
      const shoved = take(take(state, graph, "fight"), graph, "push");
      expect(shoved.combat!.offBalance).toBe(true);
      const after = take(shoved, graph, verb);
      expect(after.combat).not.toBeNull();
      expect(after.combat!.offBalance).toBe(false);
      expect(after.combat!.alerted).toBe(true);
      expect(offered(after, graph)).toContain("push");
    }
  });

  it("a SLIP submitted mid-fight does not collect the shove — only a retreat breaks off a fight", () => {
    // The menu never offers both at once; this pins the rule at the layer that enforces it, so the
    // `slip`/`retreat` asymmetry cannot be refactored away silently.
    const rate = (verb: "slip" | "retreat"): number => {
      let hurt = 0;
      for (let i = 0; i < 120; i += 1) {
        const { state, graph } = fixture(`slip-guard-${i}`, { zombie: "zombie.riot", loud: true });
        const shoved = take(take(state, graph, "fight"), graph, "push");
        const out = resolveCombatAction(shoved, graph, { type: verb, timeCost: 2, params: { to: "node.x.b" } });
        if (out.player.condition.wounds.length > shoved.player.condition.wounds.length) hurt += 1;
      }
      return hurt;
    };
    // Same seeds, same node, one `stealth` draw each — so the gap IS the bonus the retreat collects and
    // the slip does not. (After a shove `alerted` is false, so the retreat's usual penalty is not the
    // difference here; the 30 points of `PUSH_ESCAPE_BONUS` are.)
    expect(rate("retreat")).toBeLessThan(rate("slip"));
  });

  it("a retreat off a shoved enemy is measurably cleaner than the same retreat taken straight", () => {
    // The loud, chasing node T77 measured as the shape 85% of real escapes actually have.
    const hurtRate = (shove: boolean): number => {
      let hurt = 0;
      for (let i = 0; i < 150; i += 1) {
        const { state, graph } = fixture(`out-${i}`, { loud: true });
        let s = take(state, graph, "fight");
        const before = wounds(s);
        if (shove) s = take(s, graph, "push");
        s = take(s, graph, "retreat:node.x.b");
        if (wounds(s) > before) hurt += 1;
      }
      return hurt;
    };
    expect(hurtRate(true)).toBeLessThan(hurtRate(false));
  });
});

describe("total-ness and the signpost (T80)", () => {
  it("a negative or zero durability cost never REPAIRS the equipped artifact", () => {
    const { state } = fixture("neg", { weapon: "item.tool-reinforced", durability: 50 });
    const id = state.player.equipment[WEAPON_SLOT]!;
    expect(wearWeaponOnStrike(state, 0).items[id]!.durability).toBe(50);
    expect(wearWeaponOnStrike(state, -10).items[id]!.durability).toBe(50);
    expect(wearWeaponOnStrike(state, Number.NaN).items[id]!.durability).toBe(50);
    expect(wearWeaponOnStrike(state, 10).items[id]!.durability).toBe(40);
  });

  it("the narration says what the shove bought, and says nothing when nothing is shoved", () => {
    const { state, graph } = fixture("tell", { zombie: "zombie.riot" });
    const fighting = take(state, graph, "fight");
    expect(combatNarration(fighting)).not.toContain("back on its heels");
    const shoved = take(fighting, graph, "push");
    expect(combatNarration(shoved)).toContain("back on its heels");
  });
});

// --- persistence ---------------------------------------------------------------------------------

describe("the shove crosses a save (T80 · no schema rung)", () => {
  it("a shoved fight round-trips, and a pre-T80 fight without the field reads as not shoved", () => {
    const { state, graph } = fixture("save");
    const shoved = take(take(state, graph, "fight"), graph, "push");
    expect(loadGame(saveGame(shoved)).combat!.offBalance).toBe(true);
    const legacy = JSON.parse(saveGame(shoved)) as { state: { combat: Record<string, unknown> } };
    delete legacy.state.combat["offBalance"];
    const back = loadGame(JSON.stringify(legacy));
    expect(back.combat!.offBalance).toBeUndefined();
    expect(availableActions(back, graph).map((c) => c.id)).toContain("push"); // absent reads as "not shoved"
  });
});
