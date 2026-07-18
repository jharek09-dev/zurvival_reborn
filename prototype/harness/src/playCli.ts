/**
 * Interactive story-first play CLI (M1 tasks T19–T21). The impure shell around the pure `play.ts`
 * core: it loads shipped content, stands up (or resumes) a Rivermouth run, and drives a keyboard-only
 * read-render-resolve loop — render the scene, read a number (or S to save & quit, Q to quit), resolve
 * the turn, repeat. All state logic stays in the engine + `play.ts`; this file only touches stdin,
 * stdout, and the save file (client-owned I/O, ADR-0003).
 *
 *   npm run play                 # new run, fixed demo seed
 *   npm run play -- <seed>       # new run, chosen seed
 *   npm run play -- --resume <file>   # resume a saved run
 *
 * Saving writes the T7 SaveFile string to `./zurvival-save.json` (or the --resume path), so quit and
 * resume are lossless at any turn boundary (T21).
 */

import { createInterface } from "node:readline";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRegionGraph,
  loadGame,
  startRun,
  type GameState,
  type NodeDef,
  type NPCDef,
  type RegionDef,
  type RegionGraph,
} from "../../engine/src/index.js";
import { applyAction, availableActions, sceneOf } from "../../engine/src/index.js";
import { parseCommand, renderScene, saveState } from "./play.js";
import { renderDepthScreen } from "./screens.js";
import { isRunOver } from "../../engine/src/index.js";
import type { EncounterDef, SignalDef, RecipeDef, JobDef, FactionDef } from "../../engine/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = join(here, "..", "..", "..", "content");
const DEFAULT_SAVE = join(process.cwd(), "zurvival-save.json");

const load = <T>(sub: string): T[] =>
  readdirSync(join(contentDir, sub))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(contentDir, sub, f), "utf8")) as T);

function boot(argv: readonly string[]): { state: GameState; graph: RegionGraph; savePath: string } {
  const regions = load<RegionDef>("regions");
  const nodes = load<NodeDef>("nodes");
  const npcs = load<NPCDef>("npcs");
  // The data-driven encounter pool (T47): registered so the playable client speaks in scenes. Golden
  // transcript generators (playSlice/gen-slice) deliberately don't register it, staying byte-stable.
  const encounters = load<EncounterDef>("encounters");
  // The radio signal pool (T50): registered so the playable client can tune the wider world's network.
  // Like the encounter pool, golden transcript generators don't register it, so they stay byte-stable.
  const signals = load<SignalDef>("radio");
  // The crafting-recipe pool (T51): registered so the playable client can craft/repair/purify at the
  // workbench. Like the encounter and radio pools, golden transcript generators don't register it, so
  // they stay byte-stable (the economy is inert without a recipe pool).
  const recipes = load<RecipeDef>("recipes");
  // The shelter-job pool (T52): registered so the playable client can assign companions to base jobs and
  // the base runs while you're away. Like the pools above, golden transcript generators don't register it,
  // so they stay byte-stable (the whole jobs system is inert without a job pool).
  const jobs = load<JobDef>("jobs");
  // The faction pool (T53): registered so the playable client's survivors are socially alive — memory,
  // ask-for-leads, desertion/betrayal, inter-NPC bonds, and the off-screen people-sim. It is the social
  // system's master gate; like the pools above, golden transcript generators don't register it, so they
  // stay byte-stable (the whole social layer is inert without a faction pool).
  const factions = load<FactionDef>("factions");
  const resumeIdx = argv.indexOf("--resume");
  if (resumeIdx !== -1 && argv[resumeIdx + 1]) {
    const savePath = argv[resumeIdx + 1]!;
    const state = loadGame(readFileSync(savePath, "utf8"));
    return { state, graph: buildRegionGraph(regions, nodes, encounters, signals, recipes, jobs, factions, npcs), savePath };
  }
  const seed = argv[2] && !argv[2].startsWith("--") ? argv[2] : "rivermouth-demo";
  const { state, graph } = startRun({ seed, createdAt: new Date().toISOString() }, regions, nodes, npcs, [], encounters, signals, recipes, jobs, factions);
  return { state, graph, savePath: DEFAULT_SAVE };
}

async function main(argv: readonly string[]): Promise<number> {
  let { state, graph, savePath } = boot(argv);
  // terminal:false — never let readline echo or redraw the input line, so the screen can't
  // double-paint on Windows consoles; the loop owns every byte of output. The async line iterator
  // drains buffered input cleanly (interactive and piped alike) and ends on EOF.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  /** One atomic write: the whole screen, then the prompt — no interleaving, no partial repaint. */
  const draw = (): void => {
    process.stdout.write(`\n${renderScene(sceneOf(state, graph), state, graph).join("\n")}\n\n> `);
  };

  draw();
  for await (const line of rl) {
    const cmd = parseCommand(sceneOf(state, graph), line);
    if (cmd.kind === "quit") { process.stdout.write("Left the run (unsaved).\n"); rl.close(); return 0; }
    if (cmd.kind === "save") {
      writeFileSync(savePath, saveState(state), "utf8");
      process.stdout.write(`Saved to ${savePath}. Resume with: npm run play -- --resume ${savePath}\n`);
      rl.close();
      return 0;
    }
    if (cmd.kind === "screen") {
      // A depth screen is a read-only overlay (FR-UI-04): show it, then redraw the scene. No turn
      // resolves, no time is spent, no state changes — opening a screen is free.
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
