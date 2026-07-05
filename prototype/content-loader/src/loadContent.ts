/**
 * Content loader + schema gate (M0 task T6 · DESIGN §8 · ADR-0002).
 *
 * Reads the `content/` tree, validates every entry against its JSON Schema (2020-12) with
 * Ajv, and returns an in-memory registry indexed by content id. This is the single door
 * through which data enters the engine: the dependency-free engine core only ever receives
 * *already-validated plain objects*, so malformed content can never corrupt a run (FR-CNT-02).
 * The same function backs the CI schema gate (T8) — there it simply throws on any issue.
 *
 * Ajv is a *loader/tooling* dependency and lives only here, never in `engine/` (ADR-0001).
 *
 * Rules enforced (DESIGN §8, content/README):
 *   - Schema first: a content type that has files but no schema is an error.
 *   - One entity per file; every entry carries a unique `id` within its type.
 *   - All problems are collected and reported together, not one-at-a-time.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

/** One thing wrong with the content set. */
export interface ContentIssue {
  /** Content type (folder name), or "" for tree-level problems. */
  readonly type: string;
  /** Offending file path, or "" when not file-specific. */
  readonly file: string;
  readonly message: string;
}

/** Thrown when any content fails to load or validate; carries every issue found. */
export class ContentValidationError extends Error {
  readonly issues: readonly ContentIssue[];
  constructor(issues: readonly ContentIssue[]) {
    const lines = issues.map((i) => `  [${i.type}] ${i.file}: ${i.message}`).join("\n");
    super(`Content validation failed with ${issues.length} issue(s):\n${lines}`);
    this.name = "ContentValidationError";
    this.issues = issues;
  }
}

/** A validated content entry — a plain JSON object with at least a string `id`. */
export type ContentEntry = { readonly id: string; readonly [key: string]: unknown };

/** type → (id → entry). The shape the engine references by id at runtime. */
export type ContentRegistry = {
  readonly [type: string]: { readonly [id: string]: ContentEntry };
};

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

/**
 * Load and validate every content entry under `rootDir`. On any problem, throws a single
 * `ContentValidationError` listing all issues. Otherwise returns the frozen registry.
 */
export function loadContent(rootDir: string): ContentRegistry {
  const schemasDir = join(rootDir, "schemas");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const issues: ContentIssue[] = [];
  const registry: Record<string, Record<string, ContentEntry>> = {};

  if (!isDir(rootDir)) {
    throw new ContentValidationError([
      { type: "", file: rootDir, message: "content root directory does not exist" },
    ]);
  }

  const typeDirs = readdirSync(rootDir).filter(
    (name) => name !== "schemas" && isDir(join(rootDir, name)),
  );

  for (const type of typeDirs) {
    const dir = join(rootDir, type);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) continue; // empty type dir (only .gitkeep) — nothing to load yet

    // Schema-first: a populated type must have a schema. Content folders are plural
    // (`regions/`) while schemas are named for the singular entity (`region.schema.json`),
    // so accept either `<type>.schema.json` or its trailing-"s"-stripped singular.
    const schemaPath = resolveSchemaPath(schemasDir, type);
    let validate: ValidateFunction | undefined;
    if (schemaPath === undefined) {
      issues.push({
        type,
        file: join(schemasDir, `${type}.schema.json`),
        message: "no schema for a populated content type (schema-first, DESIGN §8)",
      });
    } else {
      try {
        const schema: unknown = JSON.parse(readFileSync(schemaPath, "utf8"));
        validate = ajv.compile(schema as object);
      } catch (err) {
        issues.push({ type, file: schemaPath, message: `invalid schema: ${errMsg(err)}` });
      }
    }

    const byId: Record<string, ContentEntry> = {};
    for (const file of files) {
      const path = join(dir, file);
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(path, "utf8"));
      } catch (err) {
        issues.push({ type, file: path, message: `invalid JSON: ${errMsg(err)}` });
        continue;
      }

      if (validate) {
        if (!validate(data)) {
          for (const e of validate.errors ?? []) {
            issues.push({ type, file: path, message: `${e.instancePath || "/"} ${e.message}` });
          }
          continue; // don't index an entry that failed its schema
        }
      } else {
        continue; // schema missing/broken — already reported; skip indexing
      }

      const entry = data as ContentEntry;
      if (byId[entry.id] !== undefined) {
        issues.push({ type, file: path, message: `duplicate id "${entry.id}"` });
        continue;
      }
      byId[entry.id] = Object.freeze(entry);
    }
    registry[type] = Object.freeze(byId);
  }

  if (issues.length > 0) throw new ContentValidationError(issues);
  return Object.freeze(registry);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** First existing schema file for a content type, trying plural then singular; else undefined. */
function resolveSchemaPath(schemasDir: string, type: string): string | undefined {
  const candidates = [`${type}.schema.json`];
  if (type.endsWith("s")) candidates.push(`${type.slice(0, -1)}.schema.json`);
  for (const name of candidates) {
    const p = join(schemasDir, name);
    if (existsSync(p)) return p;
  }
  return undefined;
}
