/**
 * Node-only content loader for the CLI and the tests — reads the shipped `content/` pools exactly as
 * `harness/src/playCli.ts` does (raw JSON, one array per pool, `signals` <- content/radio), sorted by
 * filename so the pool order is stable across filesystems. Not part of the browser bundle (`entry.ts`);
 * the page gets the same pools inlined by `web/build.mjs`.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Content } from "./boot.js";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = join(here, "..", "..", "..", "content");

export function loadContent(dir: string = CONTENT_DIR): Content {
  const pool = <T>(sub: string): T[] =>
    readdirSync(join(dir, sub))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, sub, f), "utf8")) as T);
  return {
    regions: pool("regions"),
    nodes: pool("nodes"),
    npcs: pool("npcs"),
    encounters: pool("encounters"),
    signals: pool("radio"),
    recipes: pool("recipes"),
    jobs: pool("jobs"),
    factions: pool("factions"),
    weapons: pool("weapons"),
    projects: pool("projects"),
    endings: pool("endings"),
  };
}
