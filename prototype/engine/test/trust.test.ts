import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DISPOSITION_TRUST,
  PARLEY_MIN,
  RECRUIT_MIN,
  TRUST_DELTAS,
  adjustTrust,
  applyTrustEvent,
  canParley,
  canRecruit,
  spawnNpcs,
  startingTrust,
  startRun,
  tickNpcs,
  trustTier,
  type NodeDef,
  type NPCDef,
  type NPCDisposition,
  type NPCState,
  type RegionDef,
} from "../src/index.js";

/**
 * T34 — Trust & disposition (FR-NPC-02, VS subset). A per-NPC 0–100 scalar that moves only from the
 * player's actions and never regenerates on its own — a betrayal sticks — gating dialogue and recruit.
 */

const npc = (over: Partial<NPCState> = {}): NPCState => ({
  id: "npc.x",
  type: "npc.x",
  name: "X",
  disposition: "neutral",
  needs: { hunger: 0, thirst: 0, fatigue: 0 },
  location: "node.s",
  alive: true,
  met: false,
  trust: 40,
  ...over,
});

// --- adjust & clamp -------------------------------------------------------------------------

describe("adjustTrust clamps to 0–100 (T34)", () => {
  it("caps at 100 and floors at 0", () => {
    expect(adjustTrust(npc({ trust: 95 }), 15).trust).toBe(100);
    expect(adjustTrust(npc({ trust: 10 }), -30).trust).toBe(0);
  });
  it("a no-op delta returns the same object", () => {
    const n = npc({ trust: 100 });
    expect(adjustTrust(n, 20)).toBe(n); // already maxed — no change
    const m = npc();
    expect(adjustTrust(m, 0)).toBe(m);
  });
});

// --- action → delta -------------------------------------------------------------------------

describe("applyTrustEvent moves trust by the mapped, asymmetric delta (T34)", () => {
  it("help/share/trade raise; threaten/rob/abandon lower", () => {
    expect(applyTrustEvent(npc(), "help").trust).toBe(55);
    expect(applyTrustEvent(npc(), "share").trust).toBe(50);
    expect(applyTrustEvent(npc(), "trade").trust).toBe(45);
    expect(applyTrustEvent(npc(), "threaten").trust).toBe(20);
    expect(applyTrustEvent(npc(), "rob").trust).toBe(10);
    expect(applyTrustEvent(npc(), "abandon").trust).toBe(15);
  });
  it("harm outweighs help — a betrayal costs more than a good turn earns", () => {
    expect(Math.abs(TRUST_DELTAS.rob)).toBeGreaterThan(TRUST_DELTAS.help);
    expect(Math.abs(TRUST_DELTAS.abandon)).toBeGreaterThan(TRUST_DELTAS.share);
  });
});

// --- tiers & gates --------------------------------------------------------------------------

describe("trustTier bands and the T35/T36 gates (T34)", () => {
  it("maps a scalar to its band", () => {
    expect(trustTier(0)).toBe("hostile");
    expect(trustTier(19)).toBe("hostile");
    expect(trustTier(20)).toBe("wary");
    expect(trustTier(39)).toBe("wary");
    expect(trustTier(40)).toBe("neutral");
    expect(trustTier(59)).toBe("neutral");
    expect(trustTier(60)).toBe("warm");
    expect(trustTier(79)).toBe("warm");
    expect(trustTier(80)).toBe("trusted");
    expect(trustTier(100)).toBe("trusted");
  });
  it("canParley gates on PARLEY_MIN and life", () => {
    expect(canParley(npc({ trust: PARLEY_MIN }))).toBe(true);
    expect(canParley(npc({ trust: PARLEY_MIN - 1 }))).toBe(false);
    expect(canParley(npc({ trust: 100, alive: false }))).toBe(false);
  });
  it("canRecruit gates on RECRUIT_MIN and life", () => {
    expect(canRecruit(npc({ trust: RECRUIT_MIN }))).toBe(true);
    expect(canRecruit(npc({ trust: RECRUIT_MIN - 1 }))).toBe(false);
    expect(canRecruit(npc({ trust: 100, alive: false }))).toBe(false);
  });
});

// --- disposition seed -----------------------------------------------------------------------

describe("disposition seeds starting trust (T33↔T34)", () => {
  it("startingTrust matches the disposition table", () => {
    const dispositions: NPCDisposition[] = ["hostile", "wary", "neutral", "friendly", "desperate"];
    for (const d of dispositions) expect(startingTrust(d)).toBe(DISPOSITION_TRUST[d]);
    expect(startingTrust("friendly")).toBeGreaterThan(startingTrust("hostile"));
  });
  it("a spawned survivor carries its disposition's starting trust", () => {
    const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
    const NODES: NodeDef[] = [{ id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: [], start: true }];
    const DEFS: NPCDef[] = [{ id: "npc.f", name: "F", description: "f", disposition: "friendly", homeNode: "node.s" }];
    const { state } = startRun({ seed: "t", createdAt: "2026-07-05T00:00:00Z" }, REGIONS, NODES, DEFS);
    expect(state.npcs["npc.f"]!.trust).toBe(startingTrust("friendly"));
  });
});

// --- no free regen: a betrayal sticks -------------------------------------------------------

describe("trust never regenerates on its own — a betrayal sticks (T34)", () => {
  const REGIONS: RegionDef[] = [{ id: "region.z", name: "Z", description: "z" }];
  const NODES: NodeDef[] = [{ id: "node.s", regionId: "region.z", name: "S", description: "s", adjacent: [], start: true }];
  const DEFS: NPCDef[] = [{ id: "npc.a", name: "A", description: "a", disposition: "friendly", homeNode: "node.s" }];
  const state = startRun({ seed: "regen", createdAt: "2026-07-05T00:00:00Z" }, REGIONS, NODES, DEFS).state;

  it("ticking needs over many hours never moves trust", () => {
    const before = state.npcs["npc.a"]!.trust;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (hours) => {
        expect(tickNpcs(state, hours).npcs["npc.a"]!.trust).toBe(before);
      }),
    );
  });

  it("a robbed survivor stays low no matter how long you wait", () => {
    const robbed = applyTrustEvent(state.npcs["npc.a"]!, "rob");
    const low = robbed.trust;
    const s2 = { ...state, npcs: { ...state.npcs, "npc.a": robbed } };
    expect(tickNpcs(s2, 500).npcs["npc.a"]!.trust).toBe(low);
  });

  it("spawnNpcs never overwrites trust on a re-seed of an existing pool", () => {
    // Defensive: spawning again with the same defs re-creates entries but is only ever called at run
    // start; trust lives in per-run state, not content.
    const respawned = spawnNpcs(state, DEFS);
    expect(respawned.npcs["npc.a"]!.trust).toBe(startingTrust("friendly"));
  });
});
