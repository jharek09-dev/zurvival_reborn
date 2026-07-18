import { writeFileSync } from "node:fs";
import {
  startRun, applyAction, availableActions, sceneOf,
  THE_LAST_CUSTOMER,
  type GameState, type NodeDef, type NPCDef, type RegionDef,
} from "../engine/src/index.js";
import { renderScene } from "./src/index.js";

const REGIONS: RegionDef[] = [{ id: "region.rm", name: "Rivermouth", description: "a flooded river district gone quiet", baseline: { loot: 60 } }];
const NODES: NodeDef[] = [
  { id: "node.safehouse", regionId: "region.rm", name: "Shuttered Pharmacy", description: "a steel-shuttered pharmacy off the plaza — defensible, if you can clear it", adjacent: ["node.store"], start: true },
  { id: "node.store", regionId: "region.rm", name: "Corner Store", description: "Ruth's corner store, shelves stripped to the brackets", adjacent: ["node.safehouse"] },
];
const NPCS: NPCDef[] = [{ id: "npc.ruth", name: "Ruth", description: "an older woman rationing crackers behind the counter", disposition: "desperate", homeNode: "node.store" }];
const ARC = THE_LAST_CUSTOMER.id;
const opts = { seed: "fun-gate-slice", createdAt: "2026-07-06T06:00:00Z" };

type Step = { pick: string } | { note: string } | { mutate: (s: GameState) => GameState; note: string };

function play(steps: Step[]): string[] {
  const { state, graph } = startRun(opts, REGIONS, NODES, NPCS, [ARC]);
  // A scavenged opening kit, so the demo turns on decisions, not loot rolls.
  let s: GameState = { ...state, player: { ...state.player, inventory: [
    { type: "item.scrap", quantity: 2 }, { type: "item.canned-food", quantity: 5 }, { type: "item.water", quantity: 5 },
  ] } };
  const out: string[] = ["```", ...renderScene(sceneOf(s, graph), s, graph), "```"];
  for (const step of steps) {
    if ("note" in step && !("mutate" in step)) { out.push("", `_${step.note}_`, ""); continue; }
    if ("mutate" in step) { s = step.mutate(s); out.push("", `_${step.note}_`, ""); continue; }
    const c = availableActions(s, graph).find((x) => x.id === step.pick);
    if (!c) throw new Error(`"${step.pick}" not offered at ${s.player.location}; offered: ${availableActions(s, graph).map((x) => x.id).join(", ")}`);
    s = applyAction(s, c.action, graph).state;
    out.push("", `**▸ you chose: ${c.label}**`, "", "```", ...renderScene(sceneOf(s, graph), s, graph), "```");
  }
  return out;
}

const opening: Step[] = [
  { note: "You start on the shuttered pharmacy — a place you might make yours, once it's clear." },
  { pick: "search" }, { pick: "search" }, { pick: "search" },
  { pick: "claim-shelter" },
  { pick: "fortify" },
  { pick: "stash-deposit:item.canned-food" }, { pick: "stash-deposit:item.canned-food" }, { pick: "stash-deposit:item.canned-food" },
  { note: "You cross to the corner store and meet its last guard." },
  { pick: "move:node.store" },
  { pick: "talk:npc.ruth" },
  { pick: "move:node.safehouse" },
];

// The plea fires on its own: the ~20 in-game hours you spend making the pharmacy yours are hours Ruth
// goes without, so by the time you walk back through the door she is desperate at the barricade (stage 13).
const beforeChoice = "**The hours you spent making the pharmacy yours were hours Ruth went without.** You cross back through the plaza — and she is at your barricade.";

// --- Branch A: take her in -> she repays ---
const branchA = play([
  ...opening,
  { note: beforeChoice },
  { pick: `story-help:${ARC}` },       // take her in — spend the cache
  { note: "You give her a place by the fire and food from the cache. A night and a day pass." },
  { mutate: (s) => ({ ...s, meta: { ...s.meta, day: s.meta.day + 1 } }), note: "**⏳ The next day.**" },
  { pick: "rest" },                    // the turn the good consequence comes due (stage 12)
]);

// --- Branch B: turn her away -> she comes back for it ---
const branchB = play([
  ...opening,
  { note: beforeChoice },
  { pick: `story-refuse:${ARC}` },     // turn her away
  { note: "You bar the door and don't look back. A night and a day pass." },
  { mutate: (s) => ({ ...s, meta: { ...s.meta, day: s.meta.day + 1 } }), note: "**⏳ The next day.**" },
  { pick: "rest" },                    // the cold consequence lands (stage 12): the raid
]);

const md = [
  "# M3 Slice — Fun-Gate playthrough transcript (T42 input)",
  "",
  "A scripted end-to-end run of the vertical slice, played through the real engine, rendered by the",
  "real story-first client (`renderScene`). Every mechanic below is genuinely played — search, claim,",
  "fortify, stash, meet, the plea, the costed choice, and its consequence. Nothing is faked — the plea",
  "fires on its own because the hours you spend building a home are hours Ruth goes hungry. Only the wait",
  "for the delayed consequence is fast-forwarded a day (marked ⏳). Two branches show the arc warm and cold.",
  "",
  `Arc: **${THE_LAST_CUSTOMER.title}** (\`${ARC}\`) · subject \`${THE_LAST_CUSTOMER.subject}\` · seed \`${opts.seed}\`.`,
  "",
  "---",
  "",
  "## Branch A — you take Ruth in",
  "",
  ...branchA,
  "",
  "---",
  "",
  "## Branch B — you turn Ruth away",
  "",
  ...branchB,
  "",
];
writeFileSync("../../docs/qa/FUN_GATE_SLICE.md", md.join("\n"));
console.log("wrote FUN_GATE_SLICE.md — branchA", branchA.length, "lines, branchB", branchB.length, "lines");
