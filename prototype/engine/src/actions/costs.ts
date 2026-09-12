/**
 * The one place the core action time costs live (T72 rebalance; extracted T77).
 *
 * These sat in `actions/coreActions.ts`, which is fine until something *below* the action layer needs
 * to be defined in terms of them. T77 needs exactly that: `SLIP_COST` must stay one hour dearer than
 * `MOVE_COST` (avoidance is not free at the margin), and `combat.ts` sits under `coreActions.ts` in
 * the import graph — `coreActions` imports the combat layer to build its choice list, so the combat
 * layer cannot import back without closing a cycle.
 *
 * So the constants move here, a leaf module with no imports at all, and both layers read them from
 * one definition. `coreActions.ts` re-exports them, so every existing importer is untouched.
 *
 * Pure data. No imports, no cycle, nothing to tick.
 */

/** Time cost, in in-game hours, of each core action (FR-CORE-03). Rebalanced T72 (playtest time-economy pass). */
export const MOVE_COST = 2;
export const SEARCH_COST = 2; // T72: 3→2 (a node still takes 3 searches to strip clean ⇒ 6h, was 9h)
export const REST_COST = 4; // T72: 6→4 (the away-from-base rest; "Sleep until morning" is the in-base recovery)
/** Managing the pack costs no in-game time (T18). */
export const DROP_COST = 0;
