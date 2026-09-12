/**
 * Headless Test Lab — the same core the browser page runs, driven from the command line so CI can prove
 * the checks on every push. The user-facing tool is the page (`npm run build`); this is the thin wrapper.
 *
 *   npm run check                       # 8 seeds × 4 policies × stocked+unstocked × 400 turns
 *   npm run check -- --seeds 3 --turns 200
 *   npm run check -- --seed tl-3 --policy random --unstocked --json out.json
 *   npm run check -- --resume zurvival-save.json --policy careful
 *
 * Exit code 1 on any failed check.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { loadGame, parseDifficulty, type GameState } from "../../engine/src/index.js";
import { loadContent } from "./loadContent.js";
import { isPolicyName, POLICY_NAMES, type PolicyName } from "./policies.js";
import { batchRuns, defaultSeeds, DEFAULT_SPEC, type BatchSpec, type RunReport } from "./runner.js";
import { summaryText } from "./report.js";

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
const has = (argv: readonly string[], name: string): boolean => argv.includes(name);
const int = (s: string | undefined, d: number): number => (s !== undefined && /^\d+$/.test(s) ? Number.parseInt(s, 10) : d);

function main(argv: readonly string[]): number {
  if (has(argv, "--help") || has(argv, "-h")) {
    process.stdout.write(
      [
        "usage: npm run check -- [options]",
        "  --seeds N            play seeds tl-1 … tl-N (default 8)",
        "  --seed a,b,c         play these seeds instead",
        "  --policy p[,q]       random | careful | greedy | fighter | all (default all)",
        "  --turns N            action cap per run (default 400)",
        "  --stocked            only stocked runs      --unstocked   only unstocked runs (default both)",
        "  --difficulty m       story | survivor | hardcore | nightmare",
        "  --ironman",
        "  --budget MS          CHK-PERF budget per turn (default 100)",
        "  --save-sample N      CHK-SAVE/RESUME every N actions (default 10)",
        "  --det-sample N       CHK-DET every N actions (default 1; 0 = off)",
        "  --no-replay          skip CHK-REPLAY",
        "  --resume FILE        start every run from this save instead of the seed",
        "  --json FILE          write the full reports as JSON",
        "  --content DIR        content directory (default: the repo's content/)",
        "",
      ].join("\n"),
    );
    return 0;
  }
  const content = loadContent(arg(argv, "--content"));
  const policyArg = arg(argv, "--policy") ?? "all";
  const policies: PolicyName[] =
    policyArg === "all"
      ? [...POLICY_NAMES]
      : policyArg.split(",").map((p) => {
          if (!isPolicyName(p)) throw new Error(`unknown policy ${JSON.stringify(p)} (expected ${POLICY_NAMES.join("|")})`);
          return p;
        });
  const seedList = arg(argv, "--seed");
  const seeds = seedList ? seedList.split(",").map((s) => s.trim()).filter(Boolean) : defaultSeeds(int(arg(argv, "--seeds"), 8));
  const stocked = has(argv, "--stocked") ? [true] : has(argv, "--unstocked") ? [false] : [true, false];
  const dArg = arg(argv, "--difficulty");
  const difficulty = dArg ? parseDifficulty(dArg) ?? undefined : undefined;
  const spec: BatchSpec = {
    seeds,
    policies,
    stocked,
    turns: int(arg(argv, "--turns"), DEFAULT_SPEC.turns),
    budgetMs: int(arg(argv, "--budget"), DEFAULT_SPEC.budgetMs),
    saveSample: int(arg(argv, "--save-sample"), DEFAULT_SPEC.saveSample),
    detSample: int(arg(argv, "--det-sample"), DEFAULT_SPEC.detSample),
    replay: !has(argv, "--no-replay"),
    ...(difficulty ? { difficulty } : {}),
    ...(has(argv, "--ironman") ? { ironman: true } : {}),
  };
  const resumePath = arg(argv, "--resume");
  const from: GameState | undefined = resumePath ? loadGame(readFileSync(resumePath, "utf8")) : undefined;

  const reports: RunReport[] = [];
  const t0 = Date.now();
  for (const r of batchRuns(content, spec, from)) {
    reports.push(r);
    process.stdout.write(`${r.ok ? "ok  " : "FAIL"} ${r.spec.seed} ${r.spec.policy} ${r.spec.stocked ? "stocked" : "unstocked"}: ${r.actions} actions, ${r.end} day ${r.endDay}, ${r.failures.length} failure(s)\n`);
  }
  process.stdout.write(`\n${summaryText(reports)}\n(${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
  const jsonPath = arg(argv, "--json");
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), spec, reports }, null, 2), "utf8");
    process.stdout.write(`wrote ${jsonPath}\n`);
  }
  return reports.every((r) => r.ok) ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
