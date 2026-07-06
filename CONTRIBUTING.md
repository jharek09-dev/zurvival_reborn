# Contributing to Zurvival Reborn

The project is in the design phase. Most contribution right now is **design and content**,
not code.

## Golden rule for all content

Before anything enters the game — a location, an item, an encounter, an NPC — it must pass
the five-question test from the GDD (Part XIV):

1. **Why does it exist?**
2. **What decision does it create?**
3. **Which systems does it affect?**
4. **Does it tell a story?**
5. **Can the player remember it?**

If a thing creates no decision and no memory, it does not belong in the game.

## Working with the documents

- `docs/specs/GDD.md` and `docs/specs/PRD.md` are the **source of truth**. Edit the Markdown.
- The `.docx` copies in `docs/specs/` are **generated exports** for sharing. Do not hand-edit
  them; regenerate from the Markdown when the source changes.
- Keep prose clear and concrete. Prefer a specific example over an abstract description.

## Working with content data

- Add game data under `content/` in the matching subfolder.
- Every content type should have a schema in `content/schemas/` before it is populated at
  scale, so data can be validated automatically.
- One file per meaningful entity (a region, a named survivor) keeps diffs readable.

## Commits

- Write present-tense, descriptive commit subjects (e.g. "Add Downtown region definition").
- Group related changes; keep design-doc edits separate from content data where practical.

## Decisions

Significant, hard-to-reverse choices (engine language, save format, platform priorities)
get an Architecture Decision Record in `design/decisions/`. See the README there.
