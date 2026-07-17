import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  applyAction,
  availableActions,
  sceneOf,
  startRun,
  workshopListing,
  economyChoices,
  craftable,
  FRESH_FOOD_ITEM,
  SPOILED_FOOD_ITEM,
  type GameState,
  type NodeDef,
  type RecipeDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";
import { renderScene } from "../src/index.js";

/**
 * T51 — the crafting economy over shipped content. Proves the `content/recipes/` set loads and interprets,
 * the workshop screen is legible through the client (SCR-10: honest text rows, the full cost stated, a
 * missing part named not hidden, world-effect prose not stats), and a real play beat: claim a shelter →
 * craft a bandage and watch a component leave the pack → build the workshop room → the room-gated recipes
 * appear → purify dirty water → fresh food spoils to a quiet line in the report.
 */

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

const regions = load<RegionDef>("regions");
const nodes = load<NodeDef>("nodes");
const recipes = load<RecipeDef>("recipes");
const opts = { seed: "economy-ship", createdAt: "2026-07-17T06:00:00.000Z" };
const run = (): { state: GameState; graph: RegionGraph } => startRun(opts, regions, nodes, [], [], [], [], recipes);

type Inv = GameState["player"]["inventory"];
const atShelter = (s: GameState): GameState => ({ ...s, player: { ...s.player, shelterId: s.player.location } });
const withInv = (s: GameState, inv: Inv): GameState => ({ ...s, player: { ...s.player, inventory: inv } });
const withRooms = (s: GameState, rooms: string[]): GameState => ({ ...s, nodes: { ...s.nodes, [s.player.shelterId!]: { ...s.nodes[s.player.shelterId!]!, rooms } } });
const has = (s: GameState, type: string): number => s.player.inventory.filter((e) => e.type === type && e.itemId === undefined).reduce((n, e) => n + e.quantity, 0);
const take = (s: GameState, graph: RegionGraph, id: string): GameState => applyAction(s, availableActions(s, graph).find((c) => c.id === id)!.action, graph).state;

// --- content loads + covers the six recipe families -------------------------------------------

describe("the shipped recipe set (content/recipes)", () => {
  it("covers all six categories, well-formed, with the gating variety the demonstrator needs", () => {
    const cats = new Set(recipes.map((r) => r.category));
    for (const c of ["medical", "weapon", "shelter", "survival", "repair", "purify"]) expect(cats.has(c as never)).toBe(true);
    expect(recipes.some((r) => r.blueprint !== undefined)).toBe(true); // at least one blueprint-gated
    expect(recipes.some((r) => r.room !== undefined)).toBe(true); // at least one room-gated
    expect(recipes.some((r) => r.installsRoom !== undefined)).toBe(true); // at least one room-builder
    expect(recipes.some((r) => r.mintsArtifact === true)).toBe(true); // at least one durability artifact
    expect(recipes.some((r) => r.category === "repair")).toBe(true);
    expect(recipes.some((r) => r.purifyFrom !== undefined && r.purifyTo !== undefined)).toBe(true);
    // Every recipe id matches recipe.<category>.<slug> and carries prose (a world-effect), not a stat.
    for (const r of recipes) {
      expect(r.id).toMatch(/^recipe\.(medical|weapon|shelter|survival|repair|purify)\.[a-z0-9-]+$/);
      expect(r.worldEffect.length).toBeGreaterThan(0);
      expect(r.inputs.length).toBeGreaterThan(0); // nothing is free
      expect(r.timeCost).toBeGreaterThanOrEqual(1); // time is always a price
    }
  });
});

// --- legibility gate (SCR-10) -----------------------------------------------------------------

describe("the workshop is legible through the client (SCR-10)", () => {
  it("a craftable row states its world-effect and full cost in words; a missing part is named, not hidden", () => {
    const { state, graph } = run();
    // Short one cloth for a bandage: the row must be shown WITH its stated missing part (never a bare grey row).
    const short = withInv(atShelter(state), [{ type: "item.cloth", quantity: 1 }]);
    const listing = workshopListing(short, graph);
    const bandage = listing.find((r) => r.recipe.id === "recipe.medical.bandage");
    expect(bandage).toBeDefined();
    expect(bandage!.craftable).toBe(false);
    expect(bandage!.missing.length).toBeGreaterThan(0); // the missing part(s) are stated
    expect(bandage!.recipe.worldEffect.length).toBeGreaterThan(0); // and the what-it-does is prose

    // With the parts, the choice label carries the world-effect and the cost clause — all words + counts.
    const ready = withInv(atShelter(state), [{ type: "item.cloth", quantity: 2 }]);
    const choice = economyChoices(ready, graph).find((c) => c.id === "craft:recipe.medical.bandage");
    expect(choice).toBeDefined();
    expect(choice!.label).toContain("Bandage");
    expect(choice!.label.toLowerCase()).toContain("cloth"); // the cost is named, not a rarity color
    // Rendered through the real client, the scene is a screen-reader-safe string list (no glyph-only meaning).
    const lines = renderScene(sceneOf(ready, graph), ready);
    expect(lines.every((l) => typeof l === "string")).toBe(true);
    expect(lines.join(" ")).toContain("Bandage");
  });
});

// --- a real play beat over shipped content ----------------------------------------------------

describe("a play beat: craft, build a room, purify, spoil (shipped content)", () => {
  it("craft a bandage and watch a component leave the pack", () => {
    const { state, graph } = run();
    const shelter = withInv(atShelter(state), [{ type: "item.cloth", quantity: 3 }]);
    const after = take(shelter, graph, "craft:recipe.medical.bandage");
    expect(has(after, "item.cloth")).toBe(1);
    expect(has(after, "item.bandage")).toBe(1);
    expect(renderScene(sceneOf(after, graph), after).join(" ").toLowerCase()).toContain("bandage");
  });

  it("building the workshop room unlocks the room-gated recipes", () => {
    const { state, graph } = run();
    const workshop = recipes.find((r) => r.installsRoom === "room.workshop")!;
    const shelter = withInv(atShelter(state), workshop.inputs.map((io) => ({ type: io.item, quantity: io.qty })));
    // Before: the shipped repair recipe (room.workshop) is not offered.
    expect(economyChoices(shelter, graph).some((c) => c.id.startsWith("repair:"))).toBe(false);
    const built = take(shelter, graph, `craft:${workshop.id}`);
    expect(built.nodes[built.player.shelterId!]!.rooms).toContain("room.workshop");
    // After the room exists, a room-gated recipe (e.g. reinforce-tool) becomes craftable with its parts.
    const reinforce = recipes.find((r) => r.room === "room.workshop" && r.mintsArtifact === true)!;
    const stocked = withInv(built, reinforce.inputs.map((io) => ({ type: io.item, quantity: io.qty })));
    expect(craftable(stocked, graph, reinforce)).toBe(true);
  });

  it("purify a batch of dirty water safe", () => {
    const { state, graph } = run();
    const boil = recipes.find((r) => r.id === "recipe.purify.boil")!;
    const shelter = withInv(atShelter(state), [{ type: "item.water-dirty", quantity: 2 }, ...boil.inputs.map((io) => ({ type: io.item, quantity: io.qty }))]);
    const after = take(shelter, graph, "purify:recipe.purify.boil");
    expect(has(after, "item.water-dirty")).toBe(0);
    expect(has(after, "item.water")).toBe(2);
  });

  it("fresh food on a low clock spoils to a quiet line in the report", () => {
    const { state, graph } = run();
    // Prime the spoilage clock low, carry fresh food, then spend a turn — stage 4 ages it out.
    const primed: GameState = { ...withInv(state, [{ type: FRESH_FOOD_ITEM, quantity: 2 }]), player: { ...state.player, inventory: [{ type: FRESH_FOOD_ITEM, quantity: 2 }], economy: { blueprints: [], freshness: 1 } } };
    const wait = availableActions(primed, graph).find((c) => c.id === "wait") ?? availableActions(primed, graph)[0]!;
    const after = applyAction(primed, wait.action, graph).state;
    expect(has(after, FRESH_FOOD_ITEM)).toBe(0);
    expect(has(after, SPOILED_FOOD_ITEM)).toBe(2);
    expect(after.history.some((h) => h.type === "food.spoiled")).toBe(true);
    expect(renderScene(sceneOf(after, graph), after).join(" ").toLowerCase()).toContain("turned");
  });
});
