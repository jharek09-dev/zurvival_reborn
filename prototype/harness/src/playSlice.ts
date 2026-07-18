/**
 * Interactive Fun-Gate SLICE CLI (M3 Part 4 · T42 input). The same keyboard-only read-render-resolve
 * shell as playCli.ts, but it stands up the vertical-slice scenario so the authored arc "The Last
 * Customer" (T40) is reachable in one sitting: it registers the arc into the run and hands the player a
 * modest scavenged kit (scrap to fortify, food/water to stash and live on) so the base loop turns on
 * decisions, not loot rolls. Everything else is a real, unscripted playthrough over the shipped
 * Rivermouth content.
 *
 *   npm run play:slice              # full slice — search a base clean, claim, fortify, stash, meet
 *                                   #   Ruth at the corner store, then head home to her plea
 *   npm run play:slice -- --fast    # primed at the plea — base claimed + cache stocked + Ruth desperate
 *   npm run play:slice -- <seed>    # full slice, chosen seed
 *
 * Save/quit is lossless at any turn boundary (S), exactly as npm run play (writes ./zurvival-save.json).
 */

import { createInterface } from "node:readline";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRegionGraph,
  startRun,
  applyAction,
  availableActions,
  sceneOf,
  isRunOver,
  THE_LAST_CUSTOMER,
  ARC_PLEA,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";
import { parseCommand, renderScene, saveState } from "./play.js";
import { renderDepthScreen } from "./screens.js";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const DEFAULT_SAVE = join(process.cwd(), "zurvival-save.json");
const ARC = THE_LAST_CUSTOMER.id;
const SUBJ = THE_LAST_CUSTOMER.subject;

const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

/** A modest scavenged opening kit so fortifying + stashing don't hinge on loot luck. */
function withKit(state: GameState): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      inventory: [
        { type: "item.scrap", quantity: 3 },
        { type: "item.canned-food", quantity: 6 },
        { type: "item.water", quantity: 5 },
      ],
    },
  };
}

/** --fast: drop the player at the plea — base claimed, cache stocked, Ruth met and desperate. */
function primeAtPlea(state: GameState): GameState {
  const here = state.player.location;
  const ruth = state.npcs[SUBJ];
  return {
    ...state,
    player: { ...state.player, shelterId: here, stash: [{ type: "item.canned-food", quantity: 3 }] },
    npcs: ruth === undefined ? state.npcs : { ...state.npcs, [SUBJ]: { ...ruth, met: true, needs: { hunger: 78, thirst: 78, fatigue: 45 } } },
    story: { ...state.story, progress: { ...state.story.progress, [ARC]: ARC_PLEA } },
  };
}

function boot(argv: readonly string[]): { state: GameState; graph: RegionGraph } {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");
  const npcs = load<NPCDef>("npcs");
  const fast = argv.includes("--fast");
  const seedArg = argv.slice(2).find((a) => !a.startsWith("--"));
  const { state, graph } = startRun(
    { seed: seedArg ?? "fun-gate-slice", createdAt: new Date().toISOString() },
    regions, nodes, npcs, [ARC],
  );
  const kitted = withKit(state);
  return { state: fast ? primeAtPlea(kitted) : kitted, graph };
}

async function main(argv: readonly string[]): Promise<number> {
  const fast = argv.includes("--fast");
  let { state, graph } = boot(argv);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const banner = fast
    ? "— THE LAST CUSTOMER (primed at the plea): Ruth is at your barricade. Take her in (share the cache) or turn her away — then rest/advance a day to see what she does. —"
    : "— THE LAST CUSTOMER (full slice): search this place clean → make it your shelter → fortify it → stash food → cross to the corner store to meet Ruth → head home. The hours you spend are hours she goes without. —";
  process.stdout.write(`\n${banner}\n[keys: a number to choose · S to save & quit · Q to quit]\n`);

  const draw = (): void => {
    process.stdout.write(`\n${renderScene(sceneOf(state, graph), state, graph).join("\n")}\n\n> `);
  };

  draw();
  for await (const line of rl) {
    const cmd = parseCommand(sceneOf(state, graph), line);
    if (cmd.kind === "quit") { process.stdout.write("Left the run (unsaved).\n"); rl.close(); return 0; }
    if (cmd.kind === "save") {
      writeFileSync(DEFAULT_SAVE, saveState(state), "utf8");
      process.stdout.write(`Saved to ${DEFAULT_SAVE}. Resume with: npm run play -- --resume ${DEFAULT_SAVE}\n`);
      rl.close();
      return 0;
    }
    if (cmd.kind === "screen") {
      // A depth screen is a read-only overlay (FR-UI-04): show it, redraw, resolve no turn.
      process.stdout.write(`\n${renderDepthScreen(cmd.screenId, state, graph).join("\n")}\n`);
      draw();
      continue;
    }
    if (cmd.kind === "invalid") { process.stdout.write(`(${cmd.reason})\n> `); continue; }
    const action = availableActions(state, graph).find((c) => c.id === cmd.choiceId)!.action;
    state = applyAction(state, action, graph).state;
    if (isRunOver(state)) {
      process.stdout.write(`\n${renderScene(sceneOf(state, graph), state, graph).join("\n")}\n\nThe run is over.\n`);
      break;
    }
    draw();
  }
  process.stdout.write("\nInput ended — left the run (unsaved).\n");
  rl.close();
  return 0;
}

main(process.argv).then((code) => process.exit(code));
