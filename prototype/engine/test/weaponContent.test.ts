import { describe, expect, it } from "vitest";
import {
  BASE_LOOT_WEIGHT,
  CARRY_CAPACITY,
  EQUIP_COST,
  ITEM_WEIGHTS,
  LOOT_TABLES,
  WEAPONS,
  WEAPON_BARE,
  WEAPON_SLOT,
  applyAction,
  availableActions,
  artifactMarks,
  buildRegionGraph,
  carriedWeapons,
  dropArtifact,
  drawWeighted,
  gearChoices,
  itemWeight,
  loadGame,
  lootEntriesFor,
  lootTableFor,
  marksSuffix,
  resolveGearAction,
  resolveSearchLoot,
  saveGame,
  startRun,
  weaponFor,
  weaponLootFor,
  weaponProfile,
  weaponPool,
  weaponsActive,
  type ContentId,
  type GameState,
  type ItemInstance,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type WeaponDef,
} from "../src/index.js";

/**
 * T81 — the melee weapon content set, and the wiring that makes it reachable (FR-CBT-04 · FR-PLR-04).
 *
 * Five claims under test, in the order the task depends on them:
 *
 *   1. **The roster is a set of trades, not a ladder.** No melee profile is at least as good as another
 *      on every axis the player pays on — the GDD's "not power tiers" rule, enforced rather than asserted.
 *   2. **A weapon reaches a hand by playing.** Loot mints a tracked artifact, an empty hand takes it up,
 *      a full hand does not, and the `equip` verb is how you choose between two working weapons.
 *   3. **It can be put down again.** A found artifact is droppable by instance, which `dropItem` could
 *      never do — without it the carry-weight trade ratchets shut.
 *   4. **The gate holds.** No registered weapon pool ⇒ the exact pre-T81 uniform table, and the weighted
 *      draw costs the identical single RNG step, so the stream advances the same either way.
 *   5. **Provenance renders in words.** PL-M4-33's raw durability ints never reach a label.
 */

const REGIONS: RegionDef[] = [{ id: "region.x", name: "X", description: "x" }];
const NODES: NodeDef[] = [
  { id: "node.x.a", regionId: "region.x", name: "Node A", description: "a plaza", adjacent: ["node.x.b"], start: true, kind: "residential" },
  { id: "node.x.b", regionId: "region.x", name: "Node B", description: "a yard", adjacent: ["node.x.a"], kind: "police" },
];

/** Every weapon row as a pool, which is all the gate needs (the dials stay engine-authoritative). */
const POOL: readonly WeaponDef[] = Object.values(WEAPONS);

/** A run with (or without) the weapon content set registered. */
function run(seed: string, withWeapons: boolean): { state: GameState; graph: RegionGraph } {
  return startRun(
    { seed, createdAt: "2026-09-13T00:00:00Z" },
    REGIONS, NODES, [], [], [], [], [], [], [],
    withWeapons ? POOL : [],
  );
}

/** A region with loot to give and a node that has never been searched — the shape a search needs. */
function searchable(state: GameState, nodeId = "node.x.a"): GameState {
  const node = state.nodes[nodeId]!;
  return {
    ...state,
    nodes: { ...state.nodes, [nodeId]: { ...node, searchPct: 0, discovered: true } },
    regions: { ...state.regions, "region.x": { ...state.regions["region.x"]!, loot: 90 } },
    player: { ...state.player, location: nodeId },
  };
}

/** Put a weapon in the pack as a tracked artifact (equipped unless `equip` is false). */
function carrying(state: GameState, type: ContentId, opts: { durability?: number | null; equip?: boolean; id?: string; metadata?: unknown } = {}): GameState {
  const id = opts.id ?? `${type}#fx`;
  const item = {
    type, quality: 100,
    durability: opts.durability === undefined ? (WEAPONS[type]?.startDurability ?? 100) : opts.durability,
    metadata: (opts.metadata ?? {}) as ItemInstance["metadata"],
  };
  return {
    ...state,
    items: { ...state.items, [id]: item },
    player: {
      ...state.player,
      inventory: [...state.player.inventory, { type, quantity: 1, itemId: id }],
      ...(opts.equip === false ? {} : { equipment: { ...state.player.equipment, [WEAPON_SLOT]: id } }),
    },
  };
}

const MELEE = Object.values(WEAPONS).filter((w) => w.kind === "melee");
const ids = (s: GameState, g: RegionGraph): string[] => availableActions(s, g).map((c) => c.id);

// --- 1. the roster is a set of trades ----------------------------------------------------------

describe("the weapon roster (T81 · FR-CBT-04 · GDD IX)", () => {
  it("ships all three melee families the GDD names, with the firefighter's axe among them", () => {
    const cats = new Set(MELEE.map((w) => w.category));
    expect(cats).toEqual(new Set(["improvised", "bladed", "blunt"]));
    expect(WEAPONS["item.axe-fire"]).toBeDefined();
    expect(WEAPONS["item.axe-fire"]!.category).toBe("bladed");
    // The pre-T81 build had TWO melee profiles (bare hands + the crafted tool) and the design review's
    // "there are no melee weapons in the game". Anything under five is a regression to that.
    expect(MELEE.length).toBeGreaterThanOrEqual(8);
  });

  it("NO melee profile is strictly better than another — the anti-power-tier rule, enforced", () => {
    // Every axis the player pays on. Higher is better on each, so a row dominates when it is >= on all
    // of them and > on one. Bare hands never breaks, which is a real advantage and counts as one.
    const axes = (w: WeaponDef): number[] => [
      w.dmgMin + w.dmgMax,
      -w.noise,
      -w.durabilityCost,
      -w.retaliateModifier,
      w.armorPierce,
      w.startDurability === null ? Number.POSITIVE_INFINITY : w.startDurability,
      -itemWeight(w.id),
    ];
    const dominated: string[] = [];
    for (const a of MELEE) {
      for (const b of MELEE) {
        if (a.id === b.id) continue;
        const xa = axes(a), xb = axes(b);
        if (xa.every((v, i) => v >= xb[i]!) && xa.some((v, i) => v > xb[i]!)) dominated.push(`${b.id} < ${a.id}`);
      }
    }
    expect(dominated).toEqual([]);
  });

  it("every placed weapon carries a durability track, a carry weight and somewhere to be found", () => {
    for (const w of MELEE) {
      if (w.id === WEAPON_BARE) { expect(w.startDurability).toBeNull(); continue; }
      expect(w.startDurability, w.id).toBeGreaterThan(0);
      expect(ITEM_WEIGHTS[w.id], w.id).toBeDefined();
      // Either the world places it, or the bench mints it. A row with neither is decoration — which is
      // exactly what the shotgun and rifle rows were before this task (PL-M5-36).
      const placed = w.lootWeight > 0 && w.lootKinds.length > 0;
      expect(placed || w.id === "item.tool-reinforced", `${w.id} is reachable`).toBe(true);
    }
    // PL-M5-36 closed: every firearm row now has somewhere to be found.
    for (const id of ["item.pistol", "item.shotgun", "item.rifle"]) {
      expect(WEAPONS[id]!.lootWeight, id).toBeGreaterThan(0);
      expect(WEAPONS[id]!.lootKinds.length, id).toBeGreaterThan(0);
    }
  });

  it("the axe is the heaviest melee weapon in the game — the carry cost of holding the best one", () => {
    const heaviest = Math.max(...MELEE.filter((w) => w.id !== WEAPON_BARE).map((w) => itemWeight(w.id)));
    expect(itemWeight("item.axe-fire")).toBe(heaviest);
    expect(itemWeight("item.axe-fire")).toBeGreaterThan(itemWeight("item.knife"));
    // ...and a fifth of the whole pack, which is what makes carrying it a decision.
    expect(itemWeight("item.axe-fire") * 5).toBeGreaterThanOrEqual(CARRY_CAPACITY);
  });

  it("the axe is the rarest thing in the station and no firearm is commoner than a knife", () => {
    const police = new Map(weaponLootFor("police").map((w) => [w.id, w.weight]));
    expect(police.get("item.axe-fire")!).toBeLessThan(police.get("item.knife")!);
    expect(police.get("item.pistol")!).toBeLessThan(police.get("item.knife")!);
    // ...and every one of them is rare against an ordinary find.
    for (const [, weight] of police) expect(weight).toBeLessThan(BASE_LOOT_WEIGHT);
  });

  it("no ordinary item is silently deleted when the weighted table is built", () => {
    // `lootEntriesFor` strips every WEAPONS id out of the flat list before re-adding the weapons at their
    // own weight. A weapon row sitting in a hand-written table with lootWeight 0 would therefore vanish
    // from that table entirely and never come back — which is a silent content deletion, not a rarity.
    for (const kind of Object.keys(LOOT_TABLES)) {
      const flat = new Set(lootTableFor(kind, true, true));
      const weighted = new Set(lootEntriesFor(kind, true, true).map((e) => e.value));
      for (const id of flat) expect(weighted.has(id), `${id} disappeared from the ${kind} table`).toBe(true);
    }
  });

  it("a weapon is only offered in the kinds it is authored for, ordered stably", () => {
    expect(weaponLootFor("medical")).toEqual([]);
    expect(weaponLootFor(undefined)).toEqual([]);
    expect(weaponLootFor("police").map((w) => w.id)).toContain("item.axe-fire");
    expect(weaponLootFor("industrial").map((w) => w.id)).not.toContain("item.axe-fire");
    const ordered = weaponLootFor("residential").map((w) => w.id);
    expect([...ordered].sort()).toEqual(ordered);
  });
});

// --- 2. the gate --------------------------------------------------------------------------------

describe("the weapon pool gates placement (T81 · the T50/T51 byte-identity discipline)", () => {
  it("a graph without a pool is inert and one with it is active", () => {
    expect(weaponsActive(run("g0", false).graph)).toBe(false);
    expect(weaponPool(run("g0", false).graph)).toEqual([]);
    expect(weaponsActive(run("g1", true).graph)).toBe(true);
    expect(weaponsActive(undefined)).toBe(false);
    expect(buildRegionGraph(REGIONS, NODES).weapons).toBeUndefined();
  });

  it("no pool ⇒ the exact pre-T81 uniform table, weapons and all", () => {
    // The police table's own contents are unchanged; it is the DRAW that the gate switches.
    expect(lootTableFor("police")).toContain("item.pistol");
    expect(lootTableFor("police")).not.toContain("item.axe-fire");
    const { state, graph } = run("gate", false);
    let s = searchable(state, "node.x.b");
    // 400 searches with the pack emptied and the region topped up between each. Both resets matter: a
    // full pack declines every find (the T18 rule) and a stripped region yields nothing, so without them
    // this loop goes quiet after a dozen passes and would sleep through a gate that had been torn out.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      s = resolveSearchLoot({
        ...s,
        nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        player: { ...s.player, inventory: [] },
      }, "node.x.b", "police");
      // Record EVERY pass, not just the last: emptying the pack between searches is what keeps the
      // probe alive, and it also throws the evidence away if the assertion waits until the end. (An
      // early cut asserted only on the final inventory and slept through a torn-out gate.)
      for (const e of s.player.inventory) seen.add(e.type);
    }
    const weaponsSeen = [...seen].filter((id) => WEAPONS[id] !== undefined && WEAPONS[id]!.kind === "melee");
    expect(weaponsSeen, "a pool-less run drew a melee weapon").toEqual([]);
    expect(seen.size, "400 searches should have exercised the whole police table").toBeGreaterThanOrEqual(3);
    expect(Object.keys(s.items)).toEqual([]);
    expect(graph.weapons).toBeUndefined();
  });

  it("with the pool, weapons enter the table at their own weight and leave the flat list", () => {
    const entries = lootEntriesFor("police");
    const byId = new Map(entries.map((e) => [e.value, e.weight]));
    // the pistol appears EXACTLY once — it was in the hand-written police table and must not be
    // counted twice (once flat, once weighted), which would have made it commoner, not rarer.
    expect(entries.filter((e) => e.value === "item.pistol")).toHaveLength(1);
    expect(byId.get("item.pistol")).toBe(WEAPONS["item.pistol"]!.lootWeight);
    expect(byId.get("item.ammo")).toBe(BASE_LOOT_WEIGHT);
    expect(byId.get("item.axe-fire")).toBe(WEAPONS["item.axe-fire"]!.lootWeight);
    // a kind with no weapons authored is a uniform table again, just expressed in weights
    expect(new Set(lootEntriesFor("medical").map((e) => e.weight))).toEqual(new Set([BASE_LOOT_WEIGHT]));
  });

  it("the weighted draw costs exactly one RNG step, the same as the uniform pick", () => {
    const { state } = run("step", true);
    const before = state.rng;
    const uniform = resolveSearchLoot(searchable(state), "node.x.a", "residential", false, false, false);
    const weighted = resolveSearchLoot(searchable(state), "node.x.a", "residential", false, false, true);
    // Both take one `loot` draw for the yield and one for the pick; the stream lands in the same place.
    expect(weighted.rng.streams["loot"]).toEqual(uniform.rng.streams["loot"]);
    expect(before.streams["loot"]).not.toEqual(weighted.rng.streams["loot"]);
  });

  it("drawWeighted matches the weights, and a non-positive weight can never be chosen", () => {
    const { state } = run("dw", true);
    const counts: Record<string, number> = { a: 0, b: 0, never: 0, negative: 0 };
    let rng = state.rng;
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      const d = drawWeighted(rng, `seed-${i}`, "loot", [
        { value: "a", weight: 9 }, { value: "b", weight: 1 },
        { value: "never", weight: 0 }, { value: "negative", weight: -5 },
      ]);
      rng = d.rng;
      counts[d.value] = (counts[d.value] ?? 0) + 1;
    }
    expect(counts["never"]).toBe(0);
    expect(counts["negative"]).toBe(0); // a negative weight is floored at 0, never subtracted from the total
    // 1-in-10 within a generous band: tight enough that an off-by-one in the walk shows up, loose
    // enough that it is not a coin-flip test. (An early cut asserted only a > b*3 and slept through it.)
    expect(counts["b"]).toBeGreaterThan(N * 0.06);
    expect(counts["b"]).toBeLessThan(N * 0.15);
    expect(counts["a"]! + counts["b"]!).toBe(N);
    expect(() => drawWeighted(state.rng, "s", "loot", [{ value: "x", weight: 0 }])).toThrow(/positive weight/);
    expect(() => drawWeighted(state.rng, "s", "loot", [])).toThrow(/positive weight/);
  });
});

// --- 3. a weapon reaches a hand -----------------------------------------------------------------

describe("a found weapon becomes a tracked artifact in a hand (T81)", () => {
  /** Search a police node until a weapon with a durability track comes out. */
  function findWeapon(seed: string): GameState {
    const { state } = run(seed, true);
    let s = searchable(state, "node.x.b");
    for (let i = 0; i < 200; i += 1) {
      s = resolveSearchLoot({ ...s, nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } } }, "node.x.b", "police", false, false, true);
      if (Object.keys(s.items).length > 0) return s;
    }
    throw new Error("no weapon found in 200 police searches — the placement is broken");
  }

  it("arrives with a durability track, provenance, and the hands take it up", () => {
    const s = findWeapon("find-a");
    const [id, item] = Object.entries(s.items)[0]!;
    expect(item.durability).toBe(WEAPONS[item.type]!.startDurability);
    const meta = item.metadata as { foundDay?: number; foundAt?: string; repairs?: unknown[] };
    expect(meta.foundDay).toBe(s.meta.day);
    expect(meta.foundAt).toBe("node.x.b");
    expect(meta.repairs).toEqual([]); // the ledger the repair recipe appends to
    expect(s.player.inventory.find((e) => e.itemId === id)).toBeDefined();
    expect(s.player.equipment[WEAPON_SLOT]).toBe(id); // empty hands ⇒ taken up on the spot
    expect(weaponFor(s).id).toBe(item.type);
  });

  it("arrives at the profile's own starting durability, and debits the region for it", () => {
    const { state } = run("dur", true);
    const s0 = searchable(state);
    let s = s0;
    let debited = false;
    for (let i = 0; i < 200 && Object.keys(s.items).length === 0; i += 1) {
      // Reset the node, the region stock and the pack every pass: 200 unbroken searches would otherwise
      // strip the region and fill the pack, and a full pack legitimately declines the find (the T18 rule).
      const before: GameState = {
        ...s,
        nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        player: { ...s.player, inventory: [] },
      };
      s = resolveSearchLoot(before, "node.x.a", "residential", false, false, true);
      if (Object.keys(s.items).length > 0) debited = s.regions["region.x"]!.loot < before.regions["region.x"]!.loot;
    }
    const item = Object.values(s.items)[0]!;
    expect(item, "no weapon in 200 residential searches").toBeDefined();
    // Every residential weapon starts BELOW full, so a mutant that hard-codes 100 cannot hide here
    // (which it could against the axe, the one profile that does start at 100).
    expect(WEAPONS[item.type]!.startDurability).toBeLessThan(100);
    expect(item.durability).toBe(WEAPONS[item.type]!.startDurability);
    // A pocketed weapon is a find like any other: the finite region stock pays for it (FR-ECO-01).
    expect(debited).toBe(true);
  });

  it("a found FIREARM stays a stack — it is fed by ammo, not repaired", () => {
    const { state } = run("gun", true);
    let s = searchable(state, "node.x.b");
    let sawGun = false;
    for (let i = 0; i < 300; i += 1) {
      s = resolveSearchLoot({
        ...s,
        nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        player: { ...s.player, inventory: s.player.inventory.filter((e) => e.itemId !== undefined || WEAPONS[e.type] !== undefined) },
      }, "node.x.b", "police", false, false, true);
      if (s.player.inventory.some((e) => WEAPONS[e.type]?.kind === "firearm")) { sawGun = true; break; }
    }
    expect(sawGun, "no firearm in 300 police searches").toBe(true);
    for (const e of s.player.inventory) {
      if (WEAPONS[e.type]?.kind === "firearm") expect(e.itemId, `${e.type} was minted as an artifact`).toBeUndefined();
    }
    expect(Object.values(s.items).every((i) => WEAPONS[i.type]!.kind === "melee")).toBe(true);
  });

  it("a weapon already in a working hand is NOT silently replaced by what you just found", () => {
    const { state } = run("keep", true);
    const armed = carrying(searchable(state, "node.x.b"), "item.axe-fire");
    const held = armed.player.equipment[WEAPON_SLOT];
    let s = armed;
    for (let i = 0; i < 200 && Object.keys(s.items).length < 2; i += 1) {
      s = resolveSearchLoot({ ...s, nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } } }, "node.x.b", "police", false, false, true);
    }
    expect(Object.keys(s.items).length).toBeGreaterThan(1);
    expect(s.player.equipment[WEAPON_SLOT]).toBe(held);
  });

  it("a BROKEN weapon is replaced — empty hands and a snapped haft are the same hands", () => {
    const { state } = run("broken", true);
    const broken = carrying(searchable(state, "node.x.b"), "item.chair-leg", { durability: 0 });
    const held = broken.player.equipment[WEAPON_SLOT];
    expect(weaponFor(broken).id).toBe(WEAPON_BARE); // T80: a broken weapon fights as bare hands
    let s = broken;
    for (let i = 0; i < 200 && Object.keys(s.items).length < 2; i += 1) {
      s = resolveSearchLoot({ ...s, nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } } }, "node.x.b", "police", false, false, true);
    }
    expect(s.player.equipment[WEAPON_SLOT]).not.toBe(held);
  });

  it("a full pack leaves the weapon in the world and does NOT debit the region (the T18 rule)", () => {
    const { state } = run("full", true);
    const s0 = searchable(state, "node.x.b");
    // Fill the pack to the brim with something that is not a weapon.
    const heavy: GameState = { ...s0, player: { ...s0.player, inventory: [{ type: "item.water" as ContentId, quantity: Math.ceil(CARRY_CAPACITY / itemWeight("item.water")) }] } };
    let s: GameState = heavy;
    for (let i = 0; i < 60; i += 1) {
      s = resolveSearchLoot({ ...s, nodes: { ...s.nodes, "node.x.b": { ...s.nodes["node.x.b"]!, searchPct: 0 } } }, "node.x.b", "police", false, false, true);
    }
    expect(Object.keys(s.items)).toEqual([]);
    expect(s.regions["region.x"]!.loot).toBe(heavy.regions["region.x"]!.loot);
  });

  it("two of the same weapon found on one turn are TWO weapons, not one overwritten", () => {
    // `foundArtifactId` bases the id on the item type and the turn, so a second find of the same type
    // before the clock moves would collide without its numeric backstop — and the first instance, with
    // its own provenance, would be silently replaced by the second. Principle 6 in the negative.
    const { state } = run("collide", true);
    let s = searchable(state);
    const turn = s.meta.turn;
    let dupType: string | null = null;
    for (let i = 0; i < 400 && dupType === null; i += 1) {
      s = resolveSearchLoot({
        ...s,
        nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        player: { ...s.player, inventory: s.player.inventory.filter((e) => e.itemId !== undefined) },
      }, "node.x.a", "residential", false, false, true);
      const counts: Record<string, number> = {};
      for (const it of Object.values(s.items)) counts[it.type] = (counts[it.type] ?? 0) + 1;
      dupType = Object.entries(counts).find(([, n]) => n >= 2)?.[0] ?? null;
    }
    expect(s.meta.turn, "the clock must not have moved — that is what forces the collision").toBe(turn);
    expect(dupType, "no weapon type was found twice in 400 searches").not.toBeNull();
    // every carried artifact still has its own live instance: nothing was overwritten
    const carriedIds = s.player.inventory.filter((e) => e.itemId !== undefined).map((e) => e.itemId!);
    expect(new Set(carriedIds).size).toBe(carriedIds.length);
    for (const id of carriedIds) expect(s.items[id], `${id} lost its instance`).toBeDefined();
    expect(Object.keys(s.items).length).toBe(carriedIds.length);
  });

  it("END TO END: a weapon is found by PLAYING — search, through the pipeline, into a hand", () => {
    // The other tests in this file call `resolveSearchLoot` directly, which cannot see whether the
    // pipeline ever tells it the weapon set is live. That is precisely the dead-wiring failure T81
    // exists to fix, so it gets its own test: choices offered by `availableActions`, taken through
    // `applyAction`, on a graph that registered the pool.
    const { state, graph } = run("e2e", true);
    let s = searchable(state);
    let found: string | null = null;
    for (let i = 0; i < 400 && found === null; i += 1) {
      s = {
        ...s,
        nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        // needs reset too: 400 played searches is 800 in-game hours, and a run that dies of thirst
        // offers no choices at all (T22), which would end the probe rather than answer it.
        player: { ...s.player, inventory: [], condition: { ...s.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } },
      };
      const search = availableActions(s, graph).find((c) => c.id === "search");
      expect(search, "a quiet, unsearched node must offer a search").toBeDefined();
      s = applyAction(s, search!.action, graph).state;
      found = s.player.inventory.find((e) => e.itemId !== undefined)?.type ?? null;
    }
    expect(found, "no weapon reached a hand in 400 played searches").not.toBeNull();
    expect(WEAPONS[found!]!.kind).toBe("melee");
    expect(weaponFor(s).id).toBe(found);            // ...and the empty hands took it up
    expect(gearChoices(s)).toEqual([]);             // nothing else to switch to yet
  });

  it("the same played search on a POOL-LESS run never hands out a weapon", () => {
    const { state, graph } = run("e2e-off", false);
    let s = searchable(state);
    const seenOff = new Set<string>();
    for (let i = 0; i < 400; i += 1) {
      s = {
        ...s,
        nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, searchPct: 0 } },
        regions: { ...s.regions, "region.x": { ...s.regions["region.x"]!, loot: 90 } },
        player: { ...s.player, inventory: [], condition: { ...s.player.condition, needs: { hunger: 0, thirst: 0, fatigue: 0 } } },
      };
      const search = availableActions(s, graph).find((c) => c.id === "search");
      expect(search, "a quiet, unsearched node must offer a search").toBeDefined();
      s = applyAction(s, search!.action, graph).state;
      for (const e of s.player.inventory) seenOff.add(e.type);
    }
    expect([...seenOff].filter((id) => WEAPONS[id] !== undefined && WEAPONS[id]!.kind === "melee")).toEqual([]);
    expect(seenOff.size).toBeGreaterThanOrEqual(3);
    expect(Object.keys(s.items)).toEqual([]);
    expect(s.player.inventory.every((e) => e.itemId === undefined)).toBe(true);
  });

  it("survives a save round-trip: the instance, its ledger, and the hand holding it", () => {
    const s = findWeapon("save");
    const back = loadGame(saveGame(s));
    expect(back.items).toEqual(s.items);
    expect(back.player.equipment).toEqual(s.player.equipment);
    expect(weaponFor(back).id).toBe(weaponFor(s).id);
  });
});

// --- 4. the equip verb --------------------------------------------------------------------------

describe("the label says what is in your hands, and when it breaks (T81 · FR-UI-02)", () => {
  const contested = (s: GameState): GameState => ({
    ...s,
    nodes: { ...s.nodes, "node.x.a": { ...s.nodes["node.x.a"]!, walkers: 1, roster: ["zombie.walker" as ContentId], zombieTypes: ["zombie.walker" as ContentId] } },
  });
  const fightLabel = (s: GameState, g: RegionGraph): string => availableActions(s, g).find((c) => c.id === "fight")!.label;

  it("names the weapon, carries its marks, and says plainly when it has broken", () => {
    const { state, graph } = run("label", true);
    const here = contested(state);
    expect(fightLabel(here, graph)).toBe("Fight the walker"); // empty hands — the untouched T15 label
    expect(fightLabel(carrying(here, "item.axe-fire"), graph)).toBe("Fight the walker with the firefighter's axe");
    expect(fightLabel(carrying(here, "item.bat", { durability: 30 }), graph)).toBe("Fight the walker with the baseball bat (worn)");
    expect(fightLabel(carrying(here, "item.machete", { durability: 0 }), graph)).toBe("Fight the walker — the machete is broken");
  });

  it("never prints a durability number, at any point on the track", () => {
    const { state, graph } = run("nolabelnum", true);
    const here = contested(state);
    for (const d of [0, 1, 25, 26, 60, 61, 99, 100]) {
      expect(fightLabel(carrying(here, "item.crowbar", { durability: d }), graph)).not.toMatch(/\d/);
    }
  });
});

describe("taking up what you carry — the equip verb (T81)", () => {
  it("is offered per carried weapon, never for the one already held, and costs no time", () => {
    const { state, graph } = run("equip", true);
    const bare = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    expect(gearChoices(bare)).toEqual([]); // nothing carried ⇒ inert, as in every pre-T81 run
    const two = carrying(carrying(bare, "item.bat", { id: "bat#1" }), "item.knife", { id: "knife#1", equip: false });
    const offers = gearChoices(two);
    expect(offers.map((c) => c.id)).toEqual(["equip:knife#1"]);
    expect(offers[0]!.timeCost).toBe(EQUIP_COST);
    expect(EQUIP_COST).toBe(0);
    expect(offers[0]!.label).toContain("kitchen knife");
    expect(ids(two, graph)).toContain("equip:knife#1");
  });

  it("actually changes what the fight resolves against", () => {
    const { state, graph } = run("swap", true);
    const quiet = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    const two = carrying(carrying(quiet, "item.chair-leg", { id: "leg#1" }), "item.axe-fire", { id: "axe#1", equip: false });
    expect(weaponFor(two).id).toBe("item.chair-leg");
    const c = availableActions(two, graph).find((x) => x.id === "equip:axe#1")!;
    const after = applyAction(two, c.action, graph).state;
    expect(weaponFor(after).id).toBe("item.axe-fire");
    expect(weaponProfile("item.axe-fire").armorPierce).toBe(2);
  });

  it("is NOT offered inside a fight — you fight with what you walked in holding", () => {
    const { state, graph } = run("mid", true);
    const contested = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, walkers: 1, roster: ["zombie.walker" as ContentId], zombieTypes: ["zombie.walker" as ContentId] } } };
    const two = carrying(carrying(contested, "item.chair-leg", { id: "leg#1" }), "item.axe-fire", { id: "axe#1", equip: false });
    expect(ids(two, graph).some((id) => id.startsWith("equip:"))).toBe(false);
  });

  it("rejects a forged, uncarried or non-weapon target rather than equipping it", () => {
    const { state, graph } = run("forge", true);
    const quiet = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    const armed = carrying(quiet, "item.bat", { id: "bat#1" });
    const withRation = { ...armed, items: { ...armed.items, "ration#1": { type: "item.canned-food" as ContentId, quality: 100, durability: null, metadata: {} } },
      player: { ...armed.player, inventory: [...armed.player.inventory, { type: "item.canned-food" as ContentId, quantity: 1, itemId: "ration#1" }] } };
    // A carried tracked RATION is not a weapon and is never listed, so it is never offered.
    // nor is a tracked FIREARM: a gun is brought up by `firearmFor`, never put in the melee slot.
    const withGun = { ...withRation, items: { ...withRation.items, "gun#1": { type: "item.pistol" as ContentId, quality: 100, durability: 50, metadata: {} } },
      player: { ...withRation.player, inventory: [...withRation.player.inventory, { type: "item.pistol" as ContentId, quantity: 1, itemId: "gun#1" }] } };
    expect(carriedWeapons(withGun).map((w) => w.itemId)).toEqual(["bat#1"]);
    expect(carriedWeapons(withRation).map((w) => w.itemId)).toEqual(["bat#1"]);
    expect(gearChoices(withRation)).toEqual([]);
    // The pipeline's own gate (FR-CORE-01) refuses an unoffered choice before the resolver ever sees it.
    expect(() => applyAction(withRation, { type: "equip", choiceId: "equip:ration#1", timeCost: 0, params: { itemId: "ration#1" } }, graph)).toThrow(/not offered/);
    // And the resolver refuses on its own too, for a replayed or hand-built action that skips the gate:
    // a ration, a forged id, the weapon already held, and a call with no params at all.
    for (const forged of ["ration#1", "nope#9", "bat#1"]) {
      const after = resolveGearAction(withRation, { type: "equip", choiceId: `equip:${forged}`, timeCost: 0, params: { itemId: forged } });
      expect(after).toBe(withRation); // same reference ⇒ nothing happened at all
    }
    expect(resolveGearAction(withRation, { type: "equip", choiceId: "equip:x", timeCost: 0 })).toBe(withRation);
    expect(resolveGearAction(withRation, { type: "rest", timeCost: 1 })).toBe(withRation);
  });
});

// --- 5. putting it down again -------------------------------------------------------------------

describe("leaving a weapon behind (T81 · the carry-weight trade stays open)", () => {
  it("a found artifact can be dropped by instance — which dropItem could never do", () => {
    const { state, graph } = run("drop", true);
    const quiet = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    // The drop block is gated on a heavy pack, exactly as the T18 stack drop is.
    const loaded = { ...quiet, player: { ...quiet.player, inventory: [{ type: "item.water" as ContentId, quantity: 11 }] } };
    const armed = carrying(loaded, "item.axe-fire", { id: "axe#1" });
    const drop = availableActions(armed, graph).find((c) => c.id === "drop:axe#1");
    expect(drop).toBeDefined();
    expect(drop!.label).toContain("firefighter's axe");
    const after = applyAction(armed, drop!.action, graph).state;
    expect(after.player.inventory.some((e) => e.itemId === "axe#1")).toBe(false);
    expect(after.items["axe#1"]).toBeUndefined();          // the instance is forgotten with it
    expect(after.player.equipment[WEAPON_SLOT]).toBeUndefined(); // and the hand that held it is empty
    expect(weaponFor(after).id).toBe(WEAPON_BARE);
  });

  it("dropArtifact matches by instance, not by type — two crowbars are two crowbars", () => {
    const { state } = run("two", true);
    const two = carrying(carrying(state, "item.crowbar", { id: "cb#1" }), "item.crowbar", { id: "cb#2", equip: false });
    const left = dropArtifact(two.player.inventory, "cb#1");
    expect(left.filter((e) => e.type === "item.crowbar")).toHaveLength(1);
    expect(left.find((e) => e.itemId === "cb#2")).toBeDefined();
    expect(dropArtifact(two.player.inventory, "nope")).toBe(two.player.inventory);
  });
});

// --- 6. provenance in words ---------------------------------------------------------------------

describe("provenance renders in words, never numbers (T81 · closes PL-M4-33's rendering half)", () => {
  const mk = (durability: number | null, repairs: number): ItemInstance =>
    ({ type: "item.axe-fire", quality: 100, durability, metadata: { repairs: Array.from({ length: repairs }, (_, i) => ({ nth: i })) } } as ItemInstance);

  it("reads repairs first, then wear, and says nothing about a fresh weapon", () => {
    expect(artifactMarks(mk(100, 0))).toBe("");
    expect(artifactMarks(mk(61, 0))).toBe("");            // band edges pinned, both sides
    expect(artifactMarks(mk(60, 0))).toBe("worn");
    expect(artifactMarks(mk(55, 0))).toBe("worn");
    expect(artifactMarks(mk(26, 0))).toBe("worn");
    expect(artifactMarks(mk(25, 0))).toBe("about to go");
    expect(artifactMarks(mk(10, 0))).toBe("about to go");
    expect(artifactMarks(mk(1, 0))).toBe("about to go");
    expect(artifactMarks(mk(0, 0))).toBe("broken");
    expect(artifactMarks(mk(100, 1))).toBe("mended once");
    expect(artifactMarks(mk(100, 2))).toBe("mended twice");
    // SCR-10's own sentence, which is the reason the ledger exists.
    expect(artifactMarks(mk(100, 3))).toBe("it carries the marks now");
    expect(artifactMarks(mk(20, 4))).toBe("it carries the marks now"); // history outranks condition
    expect(artifactMarks(undefined)).toBe("");
    expect(artifactMarks(mk(null, 0))).toBe("");
  });

  it("never leaks a durability number into a label", () => {
    for (const d of [0, 1, 25, 26, 60, 61, 99, 100]) {
      expect(marksSuffix(mk(d, 0))).not.toMatch(/\d/);
    }
    expect(marksSuffix(mk(100, 0))).toBe("");
    expect(marksSuffix(mk(55, 0))).toBe(" (worn)");
  });

  it("survives metadata that is not an object, or has no ledger at all", () => {
    expect(artifactMarks({ type: "item.bat", quality: 100, durability: 90, metadata: null } as unknown as ItemInstance)).toBe("");
    expect(artifactMarks({ type: "item.bat", quality: 100, durability: 30, metadata: [1, 2] } as unknown as ItemInstance)).toBe("worn");
    expect(artifactMarks({ type: "item.bat", quality: 100, durability: 30, metadata: { repairs: "three" } } as unknown as ItemInstance)).toBe("worn");
  });

  it("the marks reach the choice the player actually reads", () => {
    const { state } = run("marks", true);
    const quiet = { ...state, nodes: { ...state.nodes, "node.x.a": { ...state.nodes["node.x.a"]!, searchPct: 100 } } };
    const worn = carrying(carrying(quiet, "item.bat", { id: "bat#1" }), "item.machete", { id: "mac#1", equip: false, durability: 20 });
    expect(gearChoices(worn)[0]!.label).toBe("Take up the machete (about to go)");
  });
});
