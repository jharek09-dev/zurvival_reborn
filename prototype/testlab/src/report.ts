/**
 * Report — fold run reports into a batch summary, a plain-text readout, and reproduce lines.
 */

import { CHECK_IDS, checkInfo, type CheckId } from "./checks.js";
import { percentile, type Failure } from "./checks.js";
import type { RunReport } from "./runner.js";

export interface BatchSummary {
  readonly runs: number;
  readonly passed: number;
  readonly failed: number;
  readonly crashed: number;
  readonly failures: number;
  readonly byCheck: { readonly [id: string]: number };
  readonly ends: { readonly [end: string]: number };
  readonly perfP95: number;
  readonly perfMax: number;
  readonly meanEndDay: number;
  readonly totalActions: number;
  readonly deepestInfection: string;
  readonly combatsEntered: number;
  readonly encountersFired: number;
  readonly verbatimRepeatRateMax: number;
  readonly historyPerTurnMax: number;
  readonly saveBytesMax: number;
}

export function summarize(reports: readonly RunReport[]): BatchSummary {
  const byCheck: { [id: string]: number } = {};
  const ends: { [end: string]: number } = {};
  const stages = ["none", "incubating", "symptomatic", "advanced", "terminal"];
  let deepest = 0;
  for (const r of reports) {
    for (const f of r.failures) byCheck[f.id] = (byCheck[f.id] ?? 0) + 1;
    ends[r.end] = (ends[r.end] ?? 0) + 1;
    deepest = Math.max(deepest, stages.indexOf(r.coverage.deepestInfection));
  }
  const allMs = reports.flatMap((r) => r.timeline.map((p) => p.ms));
  return {
    runs: reports.length,
    passed: reports.filter((r) => r.ok).length,
    failed: reports.filter((r) => !r.ok).length,
    crashed: reports.filter((r) => r.end === "crashed").length,
    failures: reports.reduce((a, r) => a + r.failures.length, 0),
    byCheck,
    ends,
    perfP95: percentile(allMs, 95),
    perfMax: allMs.length === 0 ? 0 : Math.max(...allMs),
    meanEndDay: reports.length === 0 ? 0 : reports.reduce((a, r) => a + r.endDay, 0) / reports.length,
    totalActions: reports.reduce((a, r) => a + r.actions, 0),
    deepestInfection: stages[deepest] ?? "none",
    combatsEntered: reports.reduce((a, r) => a + r.coverage.combatsEntered, 0),
    encountersFired: reports.reduce((a, r) => a + r.coverage.encountersFired, 0),
    verbatimRepeatRateMax: reports.reduce((a, r) => Math.max(a, r.repetition.verbatimRepeatRate), 0),
    historyPerTurnMax: reports.reduce((a, r) => Math.max(a, r.historyPerTurn), 0),
    saveBytesMax: reports.reduce((a, r) => Math.max(a, r.saveBytes), 0),
  };
}

/** The exact settings that reproduce a run (and, optionally, the step to stop at). */
export function reproLine(r: RunReport, step?: number): string {
  const s = r.spec;
  const parts = [
    `seed=${s.seed}`,
    `policy=${s.policy}`,
    `stocked=${s.stocked ? "yes" : "no"}`,
    `turns=${s.turns}`,
    ...(s.difficulty ? [`difficulty=${s.difficulty}`] : []),
    ...(s.ironman ? ["ironman=yes"] : []),
    ...(step !== undefined ? [`stop-at-step=${step}`] : []),
  ];
  return parts.join(" ");
}

/** The CLI form of {@link reproLine}. */
export function reproCommand(r: RunReport): string {
  const s = r.spec;
  return [
    "npm run check --",
    `--seed ${s.seed}`,
    `--policy ${s.policy}`,
    s.stocked ? "--stocked" : "--unstocked",
    `--turns ${s.turns}`,
    ...(s.difficulty ? [`--difficulty ${s.difficulty}`] : []),
    ...(s.ironman ? ["--ironman"] : []),
  ].join(" ");
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const num = (n: number, d = 1): string => n.toFixed(d);

/** One line per run, then the failures, then the totals — what the CLI prints and the app's "Copy summary" copies. */
export function summaryText(reports: readonly RunReport[]): string {
  const lines: string[] = [];
  lines.push(`${pad("seed", 12)} ${pad("policy", 8)} ${pad("stock", 5)} ${pad("acts", 5)} ${pad("turns", 5)} ${pad("end", 11)} ${pad("day", 4)} ${pad("fail", 5)} ${pad("p95ms", 7)} ${pad("maxms", 7)} kinds`);
  for (const r of reports) {
    lines.push(
      `${pad(r.spec.seed, 12)} ${pad(r.spec.policy, 8)} ${pad(r.spec.stocked ? "yes" : "no", 5)} ${pad(r.actions, 5)} ${pad(r.resolvedTurns, 5)} ${pad(r.end, 11)} ${pad(r.endDay, 4)} ${pad(r.failures.length, 5)} ${pad(num(r.perf.p95), 7)} ${pad(num(r.perf.max), 7)} ${Object.keys(r.coverage.kinds).length}`,
    );
  }
  const s = summarize(reports);
  const failing = reports.filter((r) => !r.ok);
  if (failing.length > 0) {
    lines.push("", "FAILURES");
    for (const id of CHECK_IDS) {
      const n = s.byCheck[id];
      if (!n) continue;
      lines.push(`  ${id} × ${n} — ${checkInfo(id as CheckId).title}`);
      for (const r of failing) {
        for (const f of r.failures.filter((x) => x.id === id).slice(0, 3)) {
          lines.push(`    ${reproLine(r, f.step ?? undefined)} · turn ${f.turn}${f.action ? ` · after ${f.action}` : ""}: ${f.detail}`);
        }
      }
    }
    lines.push("", "REPRODUCE");
    for (const r of failing) lines.push(`  ${reproCommand(r)}`);
  }
  lines.push(
    "",
    `${s.runs} runs · ${s.passed} passed · ${s.failed} failed · ${s.crashed} crashed · ${s.failures} failures`,
    `ends ${JSON.stringify(s.ends)} · mean end day ${num(s.meanEndDay)} · ${s.totalActions} actions`,
    `perf p95 ${num(s.perfP95)} ms · max ${num(s.perfMax)} ms · history ≤ ${num(s.historyPerTurnMax, 2)} entries/turn · save ≤ ${(s.saveBytesMax / 1024).toFixed(1)} KiB`,
    `coverage: deepest infection ${s.deepestInfection} · ${s.combatsEntered} combats · ${s.encountersFired} encounters · verbatim repeats ≤ ${(s.verbatimRepeatRateMax * 100).toFixed(1)}%`,
  );
  return lines.join("\n");
}

/** Group a report's failures by check id, in canonical order. */
export function groupFailures(failures: readonly Failure[]): { readonly id: CheckId; readonly items: readonly Failure[] }[] {
  return CHECK_IDS.map((id) => ({ id, items: failures.filter((f) => f.id === id) })).filter((g) => g.items.length > 0);
}
