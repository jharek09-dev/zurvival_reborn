import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ContentValidationError, loadContent } from "../src/index.js";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The real repository content tree (present when the package sits inside the repo). */
const repoContent = fileURLToPath(new URL("../../../content", import.meta.url));
const repoContentExists = existsSync(repoContent) && statSync(repoContent).isDirectory();

describe("Content loader + schema gate (T6, DESIGN §8, ADR-0002)", () => {
  it("loads valid content and indexes entries by id", () => {
    const reg = loadContent(fixture("valid"));
    expect(Object.keys(reg.regions!)).toStrictEqual(["region.alpha", "region.beta"]);
    expect(reg.regions!["region.alpha"]).toMatchObject({ name: "Alpha", baseline: { loot: 90 } });
  });

  it("returns already-validated PLAIN objects (engine never sees anything else)", () => {
    const reg = loadContent(fixture("valid"));
    const entry = reg.regions!["region.alpha"]!;
    expect(JSON.parse(JSON.stringify(entry))).toStrictEqual(entry);
  });

  it("rejects out-of-range values (integer 0-100 discipline)", () => {
    expect(() => loadContent(fixture("bad-range"))).toThrow(ContentValidationError);
  });

  it("rejects entries missing a required field", () => {
    expect(() => loadContent(fixture("missing-field"))).toThrow(ContentValidationError);
  });

  it("rejects malformed JSON with a useful issue", () => {
    try {
      loadContent(fixture("bad-json"));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ContentValidationError);
      expect((err as ContentValidationError).issues[0]!.message).toMatch(/invalid JSON/);
    }
  });

  it("rejects duplicate ids within a type", () => {
    try {
      loadContent(fixture("dup-id"));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ContentValidationError).issues.some((i) => /duplicate id/.test(i.message))).toBe(
        true,
      );
    }
  });

  it("enforces schema-first: a populated type with no schema fails", () => {
    try {
      loadContent(fixture("no-schema"));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ContentValidationError).issues.some((i) => /no schema/.test(i.message))).toBe(
        true,
      );
    }
  });

  it("throws for a non-existent root", () => {
    expect(() => loadContent(fixture("does-not-exist"))).toThrow(ContentValidationError);
  });

  it.skipIf(!repoContentExists)("validates the real repo content, incl. the throwaway region", () => {
    const reg = loadContent(repoContent);
    expect(reg.regions!["region.test-downtown"]).toMatchObject({
      id: "region.test-downtown",
      baseline: { threat: 40, loot: 70 },
    });
  });
});
