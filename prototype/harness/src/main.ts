/**
 * Terminal harness entry (M0 task T9). The one place that touches stdout and the exit code;
 * all logic lives in `runEmptyTurn.ts` so it stays testable.
 *
 * Usage:
 *   npm start                 # fixed seed — reproducible demo output
 *   npm start -- <seed>       # choose the run seed
 *
 * Exit code is 0 only if the empty turn resolved AND both M0 exit proofs hold (determinism +
 * lossless save round-trip), so `npm start` doubles as a CI smoke check.
 */

import { runEmptyTurn } from "./runEmptyTurn.js";

/** Fixed defaults keep `npm start` output byte-stable for CI and golden diffs. */
const DEFAULT_SEED = "harness-demo";
const DEFAULT_CREATED_AT = "2026-07-05T06:00:00.000Z";

function main(argv: readonly string[]): number {
  const seed = argv[2] ?? DEFAULT_SEED;
  // A client may read the clock; a chosen seed still gets the fixed timestamp so a named
  // run is fully reproducible. The default demo is deterministic end to end.
  const createdAt = DEFAULT_CREATED_AT;

  const result = runEmptyTurn({ seed, createdAt });
  for (const line of result.lines) process.stdout.write(`${line}\n`);

  const ok = result.deterministic && result.saveRoundTrips;
  if (!ok) {
    process.stderr.write("\nM0 exit check FAILED — the skeleton is not deterministic/lossless.\n");
  }
  return ok ? 0 : 1;
}

process.exit(main(process.argv));
