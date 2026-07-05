# 0003 — Save storage & versioning

- **Status:** accepted
- **Date:** 2026-07-05 (accepted 2026-07-05 by Jharek)

## Context

M1 is the first milestone that writes real saves: the loop autosaves at every resolved turn
boundary (PRD FR-CORE-07, "safe-to-stop") and quit/resume at any boundary must be lossless
(M1 DoD; NFR-SAVE-01). The save *format* already exists from M0 — T7 built a versioned
`SaveFile` envelope (`format` + `saveSchemaVersion` + one-line `summary` + `state`) with a
pure, forward-only migration ladder hook that is empty at v1. What is **not** yet decided, and
what this ADR resolves before the loop starts persisting runs, is: (1) the storage *target* —
where bytes actually live, and local vs. optional cloud sync; (2) the on-disk *layout* — slots,
autosave behaviour, crash-safety; (3) the migration *policy* that governs how the schema is
allowed to evolve. Save-schema churn is a standing risk retired "M1 onward" via versioned saves
from the first format (PRD risk table; status.json). Selection criteria drawn from existing
commitments:

1. **Lossless, engine-stays-pure (NFR-SAVE-01, ADR-0001).** The engine core is dependency-free
   and I/O-free — a save is a pure function of `GameState` (T7). Whatever we choose, reading and
   writing bytes stays the *client's* job; the core only turns state ⇄ string.
2. **Zero save-corruption at launch (PRD §Stability, NFR-SAVE-02).** Autosaving on every turn
   means many small writes; a crash mid-write must never destroy a run. "No silent corruption"
   is a hard target.
3. **Web-first, short-burst play (ADR-0004, PRD persona "play in short bursts on my phone").**
   The first shipping client is web; the M1 client is the Node terminal harness. Storage must be
   reachable from both without server infrastructure standing between the player and their run.
4. **A save is a bug report (DESIGN §9).** Runs are reproducible from a seed + action log, so a
   save must be portable — exportable as text and re-importable — for debugging and support.
5. **Migratable from the first release (NFR-SAVE-02).** The schema *will* change across M1–M5;
   old saves must keep loading through a documented path, never load half-valid.

## Options considered

### Storage target

**Local-first, client-owned I/O (recommended).** The engine emits the save string; each client
persists it to the most appropriate local store — the M1 harness and any native client to a
file under the OS app-data directory, the web client to **IndexedDB** (not `localStorage`,
which is a synchronous ~5 MB string store that a growing `GameState` would eventually blow).
No server, no account, no network on the hot path — a turn boundary autosave is a local write.
Satisfies criteria 1–3 directly and keeps M1 shippable with zero backend.

**Cloud-sync-first / server-authoritative saves.** Would give cross-device continuity but
demands accounts, a sync protocol, conflict resolution, and a backend to build and secure —
all of it competing with proving the loop is fun (the actual M1 goal), and none of it required
to persist a run. Rejected for now.

**Optional cloud sync layered on local (deferred, not vetoed).** Because a save is a
self-contained versioned string, cloud sync can later be added as a *transport* that ships that
same string to a store and back — an additive, non-blocking change. Explicitly deferred to
post-launch alongside ADR-0004 platform ordering and the cross-run-memory question (PRD Open
Questions 4 & 6). Naming it here reserves the seam without paying for it in M1.

### On-disk layout & crash-safety

**Single rolling autosave slot per run, written atomically, with one `.bak` (recommended).**
Autosave overwrites one slot at each turn boundary (matches "autosave at turn boundaries",
DESIGN §9). Every write is **write-to-temp-then-atomic-rename**, and the previous slot contents
are retained as a single `.bak` before the swap — so an interrupted write can lose at most the
*last* turn, never the run, and a torn file always has an intact predecessor. Directly answers
criterion 2. Manual named saves and multiple slots are a thin later addition over the same
primitive; not needed for the M1 loop.

**Append-only / journalled saves.** Overkill for a snapshot model where the whole game is one
serializable object — the atomic-rename + `.bak` pair already gives crash-safety without a log
to compact.

### Migration policy

**Forward-only ladder keyed by source version (recommended).** Continue the T7 mechanism:
`SAVE_SCHEMA_VERSION` is a single integer starting at 1; it is bumped **only** on a breaking
change to the persisted `GameState` shape, and each bump ships **exactly one** migration entry
`N → N+1` that is pure and total. On load, a save runs up the ladder from its own version to the
build's; a version *newer* than the build is refused ("update the game to load it"); a version
older than the build with a missing rung throws `SaveError` rather than loading half-valid; a
foreign or corrupt blob throws. Save-schema version and content version are checked
independently at load (DESIGN §9). This is the mechanism already coded and unit-tested in T7 —
this ADR ratifies it as policy rather than inventing anything new.

## Decision

**Local-first, client-owned storage** of the existing T7 `SaveFile` envelope, serialized as a
compact JSON string. The **dependency-free engine core keeps doing zero I/O**: it only produces
and consumes the save string. Clients persist it locally — the M1 terminal harness and native
clients to an atomically-written file under the OS app-data directory (a project-local `saves/`
during dev), the web client to **IndexedDB**. Persistence uses a **single rolling autosave slot
per run**, written **write-temp-then-atomic-rename** with a retained **`.bak`** so no crash can
corrupt more than the most recent turn (NFR-SAVE-02, zero-corruption target). Saves are
**exportable/importable as text** so a save doubles as a bug report (DESIGN §9). **Migration is
the T7 forward-only ladder**: one integer `SAVE_SCHEMA_VERSION` (currently 1), bumped only on a
breaking state-shape change, one pure/total `N → N+1` rung per bump, newer-than-build refused,
missing-rung and corrupt/foreign blobs throw `SaveError`; content version validated separately.
**Optional cloud sync is deferred to post-launch** as an additive transport over the same
string, reserved here but not built.

## Consequences

Easier: M1 ships persistence with **no backend and no accounts** — a turn-boundary autosave is
one local atomic write; the engine's purity and determinism (ADR-0001) are untouched because
I/O never enters the core; crash-safety is structural (atomic rename + `.bak`), so the
zero-corruption target is met by construction rather than by testing luck; the same save string
works identically across harness, web, and future native clients, and drops straight into a bug
report; the migration story is the code already proven in T7, so the first breaking change in
M2+ is a single ladder entry, not a redesign.

Harder: no cross-device continuity until cloud sync is built post-launch (accepted — it is
additive and off the M1 critical path); every breaking `GameState` change now carries the
discipline of writing and testing a migration rung and bumping the version deliberately (this
is the *point* — it is what retires the save-churn risk); the web client must implement an
IndexedDB wrapper rather than a one-line `localStorage` call (accepted — `localStorage` cannot
hold a growing run and offers no atomicity).

If accepted: unblocks T11+ to autosave real runs and satisfies the M1 DoD lossless quit/resume
gate; fixes the M1 storage contract as *engine emits string → client persists locally,
atomically, one rolling slot + `.bak`*. If vetoed: re-run against the same five criteria within
the M1 time-box before the loop writes its first real save.
