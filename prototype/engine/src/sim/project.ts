/**
 * The terminal project — the first way a run can END WELL, and the first demand the economy has ever
 * had (M5 task T87 · FR-STY-06 groundwork · GDD XVI "Legacy: the run resolves toward its ending —
 * hold, escape, sacrifice, or fall" · design review 2026-09-12 step 10).
 *
 * ## What the measurement found, because most of the brief is a description of a game that is not here
 *
 * The brief's diagnosis of the HOLE is exact and worth quoting, because it is the whole reason this
 * module exists: `runEndReason` offered **four ways to lose and zero ways to win**, and
 * `story.endingFlags` had **two non-comment mentions in the entire engine, both of them declarations**
 * — no writer, no reader, set in 0 of 40 measured runs. A field named for the endings it would
 * assemble, holding nothing, for ten milestones.
 *
 * Its prescribed CURE is a different matter. It asks for "a 3–4 stage project whose inputs are
 * deliberately the resources the economy over-produces and never spends", naming
 * `item.batteries`, `item.lighter`, `item.blanket` and `item.charcoal`. Measured
 * (`measure/t87.ts --surplus`, `--ceiling`, `--ledger-immortal`, 40 runs each):
 *
 * ```
 *   goal-directed settler, 40 runs      end day 3.0   (lastStand 33, dehydrated 5, infection 2)
 *     HELD at the end: scrap 0.93 · canned-food 1.70 · water 0.68 · charcoal 0.38 · cloth 0.38
 *                      batteries 0.20 · lighter 0.15 · fuel 0.05 · tools 0.00 · blanket 0.00
 *
 *   IMMORTAL settler (day 36.6 — the CEILING, not a bot artifact), everything gained per run:
 *     item.scrap   6.28  in 100% of runs      <- the only abundant thing in the game
 *     water 1.10 · bandage 1.03 · cloth 1.00 · canned 0.93 · charcoal 0.68 · lighter 0.67 ·
 *     batteries 0.56 · ... · fuel 0.03
 *     item.tools and item.blanket DO NOT APPEAR AT ALL, in 40 immortal runs.
 * ```
 *
 * **There is no surplus.** The economy over-produces exactly one thing, `item.scrap`, and even that is
 * spent on rooms the moment T85 gave it somewhere to go. `item.blanket`, `item.fuel` and `item.tools`
 * are not unspent surpluses — **they are not obtainable**: `residential` is searched in 0.9% of
 * searches and `industrial` in 7.2%, so their tables are very nearly never rolled. Their problem is
 * SUPPLY, not sink, and pricing a stage in them would re-create the T85 cistern defect exactly (a fix
 * priced out of the reach of the thing it fixes) one task later.
 *
 * And there is a deadline the brief did not know about. A bot that never moves and never searches
 * still watches the city empty itself on the wall clock (`--drain`): the-terraces and hillcrest reach
 * `loot` 0 on **day 4**, rivermouth and ironworks on **day 8**, downtown on **day 20**. A project
 * priced for a long haul is priced for a city that no longer exists.
 *
 * ## So the shape is different from the brief's, in three ways, each forced by a number
 *
 *   1. **This is not a sink for a surplus. It is the first DEMAND the economy has ever had** — and
 *      therefore the first reason to search the districts nobody searches. The dead items are dead
 *      because nothing ever wanted them; a stage that wants one is the fix.
 *   2. **A stage is paid with ANY ONE of a menu** ({@link ProjectStageDef.accepts}), not with a fixed
 *      bill of materials. The ledger is thin and wide — nine things at about one unit a run — so a
 *      conjunctive cost is unpayable while a disjunctive one is payable nine ways. That turns every
 *      named dead item into an ALTERNATE PAYMENT rather than a hard gate, which is both reachable and
 *      a decision ("spend the scrap you were saving for the cistern, or the lighter you will never
 *      otherwise use").
 *   3. **The two projects are exclusive.** Committing to the boat forecloses the block. That is the
 *      decision the late game never had, and it is why {@link commitChoices} offers both and
 *      {@link advanceChoices} offers one.
 *
 * ## Where the state lives: nowhere new
 *
 * Stage completion is a **boolean set**, and `story.endingFlags` is a `Flags` that has been in the save
 * since v1 holding nothing. So the project writes there — `project.<id>.committed`,
 * `project.<id>.<stageId>`, and on the last stage `ending.escaped` / `ending.held`. **Save stays v10,
 * no migration rung**, and the field finally means what its name says. `runEndReason` needs no graph
 * to read a flag, which is the reason the ending is a flag rather than a derivation over content
 * (the T79/T84/T85/T86 derive-don't-store rule bends here for exactly one reason: `runEndReason(state)`
 * takes no graph, and inventing a graph parameter for it would touch every caller in four packages).
 *
 * ## The gate
 *
 * Everything here is dark unless the content set authors projects ({@link projectsActive}) — the
 * T83 `claimable` / T84 `richness` / T85 `roomSlots` / T86 `graph?` discipline. A set that authors
 * none gets no verbs, no flags, no escalation and no new run-end reason, so every fixture and every
 * pre-T87 run is untouched.
 *
 * Pure, deterministic, integer-only (ADR-0001). **No RNG at all** — the project never draws, so it
 * cannot shift a stream and the T81 byte-identity hazard does not apply.
 */

import type { GameState, ContentId, Flags, RegionState } from "../state/types.js";
import type { RegionGraph } from "../map/types.js";
import type { Action, SceneChoice } from "../pipeline/contract.js";

// --- content shapes -------------------------------------------------------------------------------

/** One accepted payment for a stage: this many of this item. A stage lists several; you pay ONE. */
export interface ProjectIO {
  readonly item: ContentId;
  readonly qty: number;
}

/**
 * What finishing a stage does to the world. Every project stage carries one, because the brief's one
 * non-negotiable is that **building toward the ending makes the city harder** — "so the last week of a
 * run is a race rather than a wind-down".
 */
export interface ProjectEscalation {
  /** Points added to the region's `threat` (0–100 clamp). */
  readonly threat?: number;
  /** Points added to the region's `survivorActivity` — rivals notice a working engine. */
  readonly survivorActivity?: number;
  /** Points added to the region's `zombieDensity`. */
  readonly zombieDensity?: number;
  /** `"region"` (the shelter's region, the default) or `"city"` (every region). */
  readonly scope?: "region" | "city";
}

export interface ProjectStageDef {
  readonly id: string;
  /** The choice row ("Patch the hull"). */
  readonly label: string;
  /** What it does in the world, never a number ("The seams stop weeping. It will float."). */
  readonly worldEffect: string;
  /** Accepted payments — **any ONE** of these settles the stage. Ordered; the first affordable is used. */
  readonly accepts: readonly ProjectIO[];
  /** Hours the stage costs. > 0, so every stage is a resolved, world-advancing turn (FR-CORE-03). */
  readonly timeCost: number;
  /** Some stages are loud. Deposited at the node by pipeline stage 6 via `params.noise`, like a molotov. */
  readonly noise?: number;
  readonly escalation?: ProjectEscalation;
}

export interface ProjectDef {
  readonly id: string;
  /** Which ending this project resolves to. */
  readonly kind: "escape" | "holdout";
  readonly label: string;
  /** The commit row's prose — what you are choosing, in the world's words. */
  readonly premise: string;
  /** Ordered. A stage is available only once every earlier stage is done. */
  readonly stages: readonly ProjectStageDef[];
  /** The run's closing narration when the last stage lands. A scene, not a scoreboard (GDD IX rule 5). */
  readonly ending: string;
}

// --- the flag vocabulary --------------------------------------------------------------------------

/**
 * The two flag namespaces this module writes, as PREFIXES rather than suffixes.
 *
 * That shape is not cosmetic and it is the audit's second finding. A first cut wrote
 * `project.<id>.committed` for the commitment and `project.<id>.<stageId>` for a stage, and counted
 * stages by "starts with `project.` and does not end `.committed`". A stage whose id was literally
 * `committed` — which the schema's slug pattern permits — then produced a flag key **identical to the
 * commit flag**, so committing silently completed that stage (a free stage, a miscounted alarm, and on
 * a one-stage project a run permanently committed to something it could never finish and was never
 * told about). Any suffix rule has that failure mode somewhere, because ids are author-supplied.
 * Disjoint prefixes do not: no `project.stage.…` key can ever be a `project.commit.…` key, whatever
 * the content calls things.
 */
export const PROJECT_STAGE_FLAG_PREFIX = "project.stage.";
export const PROJECT_COMMIT_FLAG_PREFIX = "project.commit.";
/** Set the moment a project is chosen. Its presence is what makes the choice exclusive. */
export const projectCommitFlag = (projectId: string): string => `${PROJECT_COMMIT_FLAG_PREFIX}${projectId}`;
/** Set when a stage lands. */
export const projectStageFlag = (projectId: string, stageId: string): string =>
  `${PROJECT_STAGE_FLAG_PREFIX}${projectId}.${stageId}`;

/** The two terminal flags. `runEndReason` reads these and nothing else about the project. */
export const ENDING_FLAG_ESCAPED = "ending.escaped";
export const ENDING_FLAG_HELD = "ending.held";

// --- the dials ------------------------------------------------------------------------------------

/**
 * Points of drift anchor a *completed stage* adds to every region, for as long as the run lasts —
 * the standing half of "each stage raises something", on top of the one-shot
 * {@link ProjectEscalation} the stage itself carries.
 *
 * It rides {@link driftAnchor}'s `alarm` term exactly as T79's neglect rides its `neglect` term: read
 * off state every tick, never stored, bounded at both ends. A run with no completed stage supplies 0
 * and the anchor is byte-identical to T79's.
 *
 * **Set by measurement, not by feel** — see `measure/t87.ts --escal`. A first cut at 3/stage was worth
 * ~9 anchor points across a whole finished project, which the day ramp delivers on its own by day 9;
 * an escalation the calendar already provides is not an escalation.
 */
export const PROJECT_ALARM_PER_STAGE = 8;
/**
 * Hours committing costs. Non-zero deliberately: FR-CORE-03 says every offered action spends hours so
 * time always advances, and the one precedent for a free verb (`EQUIP_COST`, T18) is *pack management*,
 * which this is not — choosing what the base is for is the moment you tell the people in it.
 */
export const PROJECT_COMMIT_COST = 1;
/**
 * Ceiling on the standing lift.
 *
 * **This bounds CONTENT, not the shipped pair, and saying so is the point.** The schema lets a project
 * author up to six stages; six of them would be worth 48 anchor points, which is half the scale and
 * enough to drive every region to 100 on its own. The shipped projects have three stages each, so the
 * most a LIVE state can show is two stages' worth (16) — the third stage ends the run on the frame it
 * lands. So the cap never binds in the shipped game, exactly as the `neglect` and `bias` clamps inside
 * {@link driftAnchor} never bind on their own callers: it is a guard against a value arriving from
 * somewhere else, and the audit was right to ask, which is why it is written down rather than implied.
 */
export const PROJECT_ALARM_CAP = 20;

// --- reads ----------------------------------------------------------------------------------------

/** The registered project pool, or empty. */
export function projectPool(graph: RegionGraph | undefined): readonly ProjectDef[] {
  return graph?.projects ?? [];
}

/** Whether this content set authors any project — the **active-system gate** for the whole T87 layer. */
export function projectsActive(graph: RegionGraph | undefined): boolean {
  return projectPool(graph).length > 0;
}

const flagOn = (flags: Flags, key: string): boolean => flags[key] === true;

/** The project this run has committed to, or null. Scans the pool so the answer is always a real def. */
export function committedProject(state: GameState, graph: RegionGraph | undefined): ProjectDef | null {
  for (const def of projectPool(graph)) {
    if (flagOn(state.story.endingFlags, projectCommitFlag(def.id))) return def;
  }
  return null;
}

/**
 * Whether this run has committed to ANYTHING — answered from the flag set alone, with no reference to
 * the pool.
 *
 * `committedProject` can only recognise a commitment whose def is still in hand, so on its own it made
 * exclusivity a *pool-relative* invariant: retire or rename a project between builds and a save holding
 * its commit flag is offered the whole fork again, while the retired project's stage flags go on
 * funding {@link projectAlarm}. The flag keys are save data (the schema says so); the rule that rests on
 * them has to be answerable from the save.
 */
export function hasCommitted(state: GameState): boolean {
  for (const [key, on] of Object.entries(state.story.endingFlags)) {
    if (on === true && key.startsWith(PROJECT_COMMIT_FLAG_PREFIX)) return true;
  }
  return false;
}

/** Whether a given stage of a given project has landed. */
export function stageDone(state: GameState, projectId: string, stageId: string): boolean {
  return flagOn(state.story.endingFlags, projectStageFlag(projectId, stageId));
}

/** The next stage of `def` to work on, or null when the project is finished. Strictly in order. */
export function nextStage(state: GameState, def: ProjectDef): ProjectStageDef | null {
  for (const stage of def.stages) {
    if (!stageDone(state, def.id, stage.id)) return stage;
  }
  return null;
}

/**
 * How many project stages this run has completed, across every project.
 *
 * Counted off the flag set rather than off the content, so it is correct on a save loaded without a
 * graph — which is the case `driftRegions` is in when a client ticks the world before rebuilding the
 * pool. Commit flags are excluded: committing is a decision, not a stage of work, and it raises nothing.
 */
export function projectStagesDone(state: GameState): number {
  let n = 0;
  for (const [key, on] of Object.entries(state.story.endingFlags)) {
    if (on === true && key.startsWith(PROJECT_STAGE_FLAG_PREFIX)) n += 1;
  }
  return n;
}

/**
 * The standing drift lift the run's completed stages are worth — `stages x PER_STAGE`, capped.
 * 0 for every run that has finished no stage, which is what keeps the pre-T87 anchor byte-identical.
 */
export function projectAlarm(state: GameState): number {
  const done = projectStagesDone(state);
  if (done <= 0) return 0;
  return Math.min(PROJECT_ALARM_CAP, done * PROJECT_ALARM_PER_STAGE);
}

/**
 * The run's won ending, or null — the ONE thing `sim/survival.ts` reads from this module.
 *
 * Deliberately a flag read and not a content walk: `runEndReason(state)` takes no graph (it is called
 * from four packages and from `availableActions` itself), so the terminal condition has to be
 * answerable from state alone.
 */
export function wonEnding(state: GameState): "escaped" | "held" | null {
  if (flagOn(state.story.endingFlags, ENDING_FLAG_ESCAPED)) return "escaped";
  if (flagOn(state.story.endingFlags, ENDING_FLAG_HELD)) return "held";
  return null;
}

// --- payment --------------------------------------------------------------------------------------

/**
 * Units of `type` in the pack. Two deliberate exclusions:
 *
 *  - **the stash**, because you build with what you carry (the `craft` rule);
 *  - **tracked artifacts** (`itemId` present), because a durability instance lives in `state.items` and
 *    can be in `player.equipment`, and spending one as a stack would leave the record and the hand
 *    pointing at an item nobody carries. `dropArtifact` exists precisely because that needs three
 *    edits, not one. So a project is paid in STACKS; a weapon on an `accepts` menu is simply never
 *    affordable, which is the safe failure rather than the corrupting one.
 */
function carried(state: GameState, type: string): number {
  let n = 0;
  for (const e of state.player.inventory) if (e.type === type && e.itemId === undefined) n += e.quantity;
  return n;
}

/**
 * The first payment on a stage's menu the player can actually make, or null.
 *
 * Ordered, not cheapest-first: the content author decides which payment the stage would rather have,
 * and the player who wants to spend something else drops what they do not want to spend. Determinism
 * matters more than cleverness here — a "pick the least useful item" heuristic would be the engine
 * deciding what the player values.
 */
export function affordablePayment(state: GameState, stage: ProjectStageDef): ProjectIO | null {
  for (const io of stage.accepts) {
    // Truncated on the READ as well as on the debit: a fractional `qty` the schema would refuse must
    // not be able to charge 1 for a demand of 1.5.
    const want = Math.trunc(io.qty);
    if (want > 0 && carried(state, io.item) >= want) return { item: io.item, qty: want };
  }
  return null;
}

/** Debit `qty` of `type` from the pack, first stack first. Drops emptied stacks. Pure. */
function consume(state: GameState, type: string, qty: number): GameState["player"]["inventory"] {
  let left = Math.max(0, Math.trunc(qty));
  const out: { type: string; quantity: number; itemId?: string }[] = [];
  for (const e of state.player.inventory) {
    // `itemId` entries are tracked artifacts and are never payment — see `carried`.
    if (left <= 0 || e.type !== type || e.itemId !== undefined) { out.push({ ...e }); continue; }
    const take = Math.min(left, e.quantity);
    left -= take;
    const rest = e.quantity - take;
    if (rest > 0) out.push({ ...e, quantity: rest });
  }
  return out as GameState["player"]["inventory"];
}

// --- prose ----------------------------------------------------------------------------------------

const itemLabel = (type: string): string => {
  const tail = type.startsWith("item.") ? type.slice("item.".length) : type;
  return tail.replace(/-/g, " ").trim() || type;
};

/** Join a list into prose: "a, b or c". */
function orList(parts: readonly string[]): string {
  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]!}`;
}

/**
 * "2 scrap, 1 lighter or 1 batteries · 3h · loud" — the whole price of a stage, for the CHOICE ROW.
 *
 * Numbers belong here and only here: a choice row is the SCR-10 mono line, which is where the economy's
 * own `costClause` puts a price and where FR-UI-02's "words, not numbers" rule does not reach. The
 * narration counterpart is {@link needClause}, which carries the same information with the digits taken
 * out — the audit caught a first cut putting this string into `scene.narration`.
 */
function priceClause(stage: ProjectStageDef): string {
  const menu = orList(stage.accepts.map((io) => `${io.qty} ${itemLabel(io.item)}`));
  const tail = [`${stage.timeCost}h`];
  if ((stage.noise ?? 0) > 0) tail.push("loud");
  return `${menu} · ${tail.join(" · ")}`;
}

/** The same price with no digits in it — what the PROSE is allowed to say (FR-UI-02). */
function needClause(stage: ProjectStageDef): string {
  const seen: string[] = [];
  for (const io of stage.accepts) {
    const label = itemLabel(io.item);
    if (!seen.includes(label)) seen.push(label);
  }
  return orList(seen);
}

/**
 * The Scene's one sentence about the project, or "" when there is nothing to say.
 *
 * It exists because of T86's audit finding 4: a gate that removes a choice must REPLACE the silence
 * with the reason. A stage you cannot pay for does not appear in `availableActions` — so without this
 * line the base simply stops offering the project and the player is told nothing at all.
 */
export function projectLine(state: GameState, graph: RegionGraph | undefined): string {
  if (!projectsActive(graph)) return "";
  const def = committedProject(state, graph);
  const shelter = state.player.shelterId;
  if (def === null) {
    // Committed to something this build no longer carries. Rare (a content edit across a save), but it
    // must not be SILENT — the whole point of this line is that a verb which stops being offered still
    // owes the player a reason.
    if (hasCommitted(state)) return "The work you started is not something this place remembers how to finish.";
    if (shelter === null) return "";
    return state.player.location === shelter
      ? "There is work here bigger than another night. You could decide what this place is for."
      : "";
  }
  const stage = nextStage(state, def);
  if (stage === null) return "";
  // A base can be LOST after you commit — a siege breach or the abandon verb both clear `shelterId`
  // (`sim/siege.ts#releaseShelter`). The first cut fell through to "the work is at your base" and sent
  // the player to a building that is not theirs any more, which is the T86 finding-4 failure in its
  // worst form: a sentence that is not merely silent but wrong.
  if (shelter === null) return `${def.label} is where you left it. There is no base to work in until you hold somewhere again.`;
  if (state.player.location !== shelter) return `${def.label}: ${stage.label.toLowerCase()} — but the work is at your base.`;
  if (affordablePayment(state, stage) !== null) return "";
  return `${def.label}: ${stage.label.toLowerCase()} waits on ${needClause(stage)}.`;
}

// --- choices --------------------------------------------------------------------------------------

const PROJECT_COMMIT = "project-commit";
const PROJECT_ADVANCE = "project-advance";

/**
 * The project verbs offered here, in stable order. Empty unless the system is active and the player is
 * standing in their own base — the work is the base's, which is both the brief's ask ("a project the
 * base builds") and the T86 siting lesson: an occasion pinned to ONE authored node is stood on in 0–10%
 * of runs, and the shelter is the one node a run that has claimed anything is guaranteed to return to.
 */
export function projectChoices(state: GameState, graph: RegionGraph | undefined): readonly SceneChoice[] {
  if (!projectsActive(graph)) return [];
  const shelter = state.player.shelterId;
  if (shelter === null || state.player.location !== shelter) return [];

  const committed = committedProject(state, graph);
  if (committed === null) {
    // A commitment whose def has left the content set still forecloses the fork — the flags are the
    // save, and `hasCommitted` is the only reader that can see one. Without this the choice list and
    // the resolver disagree, which is how the audit's finding 4 became two projects in one run.
    if (hasCommitted(state)) return [];
    const out: SceneChoice[] = [];
    for (const def of [...projectPool(graph)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      if (def.stages.length === 0) continue;
      out.push({
        id: `${PROJECT_COMMIT}:${def.id}`,
        label: `${def.label} — ${def.premise}`,
        timeCost: PROJECT_COMMIT_COST,
        action: { type: PROJECT_COMMIT, choiceId: `${PROJECT_COMMIT}:${def.id}`, timeCost: PROJECT_COMMIT_COST, params: { project: def.id } },
      });
    }
    return out;
  }

  const stage = nextStage(state, committed);
  if (stage === null) return [];
  if (affordablePayment(state, stage) === null) return [];
  const noise = (stage.noise ?? 0) > 0 ? { noise: stage.noise } : {};
  return [{
    id: `${PROJECT_ADVANCE}:${committed.id}:${stage.id}`,
    label: `${stage.label} — ${stage.worldEffect} (${priceClause(stage)})`,
    timeCost: stage.timeCost,
    action: {
      type: PROJECT_ADVANCE,
      choiceId: `${PROJECT_ADVANCE}:${committed.id}:${stage.id}`,
      timeCost: stage.timeCost,
      params: { project: committed.id, stage: stage.id, ...noise },
    },
  }];
}

/** Whether an action is one this module owns (validation + stage-3 dispatch). */
export function isProjectAction(action: Action): boolean {
  return action.type === PROJECT_COMMIT || action.type === PROJECT_ADVANCE;
}

// --- resolution -----------------------------------------------------------------------------------

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.trunc(n)));

/**
 * Apply one stage's one-shot escalation. Pure; returns the same reference when nothing moved.
 *
 * `"region"` means the **shelter's** region, read off `player.shelterId` rather than off wherever the
 * player happens to be standing. The two are the same once the resolver's siting guard is in place, but
 * the schema and this module's own doc both promise "the shelter's own region", and a scoping rule
 * should not quietly depend on a guard in another function to be true.
 */
function escalate(state: GameState, stage: ProjectStageDef): GameState {
  const esc = stage.escalation;
  if (esc === undefined) return state;
  const dThreat = Math.trunc(esc.threat ?? 0);
  const dActivity = Math.trunc(esc.survivorActivity ?? 0);
  const dDensity = Math.trunc(esc.zombieDensity ?? 0);
  // A FAST PATH, not a rule — and the mutation sweep proved it: deleting this line leaves behaviour
  // identical, because an all-zero escalation leaves `changed` false below and the function returns
  // `state` anyway. Kept because an authored `{ "threat": 0 }` (which `minProperties: 1` permits)
  // should not allocate six region objects to decide it did nothing. EQUIVALENT MUTANT, with the proof
  // here rather than a test that cannot exist.
  if (dThreat === 0 && dActivity === 0 && dDensity === 0) return state;

  // EQUIVALENT MUTANT, proof: `resolveProjectAction` — the only caller — returns early unless
  // `shelterId !== null` and `location === shelterId`, so reading either one gives the same region
  // today. This is written the way the schema and this doc PROMISE it works rather than the way the
  // caller happens to make true, so the scope rule does not silently become wrong the day a second
  // caller appears. The sweep flagged it; that is the right answer, not a defect.
  const shelter = state.player.shelterId;
  const hereRegion = shelter === null ? undefined : state.nodes[shelter]?.regionId;
  const scope = esc.scope ?? "region";
  const regions: Record<string, RegionState> = {};
  let changed = false;
  for (const [id, region] of Object.entries(state.regions)) {
    if (scope === "region" && id !== hereRegion) { regions[id] = region; continue; }
    const next: RegionState = {
      ...region,
      threat: clampPct(region.threat + dThreat),
      survivorActivity: clampPct(region.survivorActivity + dActivity),
      zombieDensity: clampPct(region.zombieDensity + dDensity),
    };
    if (next.threat !== region.threat || next.survivorActivity !== region.survivorActivity || next.zombieDensity !== region.zombieDensity) changed = true;
    regions[id] = next;
  }
  return changed ? { ...state, regions } : state;
}

/** Stamp + append a Living-History beat (append-only; never rewritten). Pure. */
function appendBeat(state: GameState, type: string, subjects: readonly string[], data: Record<string, string | number | boolean | null>): GameState {
  const { day, hour, turn } = state.meta;
  return { ...state, history: [...state.history, { day, hour, turn, type, subjects: [...subjects], data }] };
}

const withFlags = (state: GameState, add: Record<string, boolean>): GameState => ({
  ...state,
  story: { ...state.story, endingFlags: { ...state.story.endingFlags, ...add } },
});

/**
 * Resolve a project action (pipeline stage 3). Unknown ids and an already-committed second commit are
 * no-ops that return the same state, which is what keeps a forged action from mattering.
 */
export function resolveProjectAction(state: GameState, graph: RegionGraph | undefined, action: Action): GameState {
  if (!projectsActive(graph)) return state;
  // The module owns exactly two verbs and answers to nothing else, even when called directly.
  if (!isProjectAction(action)) return state;
  // **The siting rule is enforced HERE, not only in `projectChoices`.** Pipeline stage 1 runs
  // `assertLegal` only for an action carrying a `choiceId`, and `assertLegal` compares that string and
  // nothing else — so a resolver that trusts the offered list is a resolver with no rule at all. A first
  // cut checked exclusivity, stage order and payment here but left siting to the choice list, and the
  // audit walked a committed player into another district and finished the entire project there, at
  // `timeCost` 0, escalating a region that was not the base's. The work is at the base; this is where
  // that is true.
  const shelter = state.player.shelterId;
  if (shelter === null || state.player.location !== shelter) return state;
  const projectId = action.params?.["project"];
  if (typeof projectId !== "string") return state;
  const def = projectPool(graph).find((p) => p.id === projectId);
  if (def === undefined || def.stages.length === 0) return state;

  if (action.type === PROJECT_COMMIT) {
    // Exclusive by construction: a run that has already chosen cannot choose again, and the choice is
    // not offered once one is made. Checked here as well as in `projectChoices` so the rule survives a
    // client that submits an action it was not offered.
    // Read off the FLAG SET, not the pool: a commitment to a project that has since left the content set
    // is still a commitment (see `hasCommitted`).
    if (hasCommitted(state)) return state;
    const committed = withFlags(state, { [projectCommitFlag(def.id)]: true });
    return appendBeat(committed, "project.committed", ["player", def.id], { project: def.id, kind: def.kind });
  }

  const stageId = action.params?.["stage"];
  if (typeof stageId !== "string") return state;
  // Only the run's own committed project advances, and only its NEXT stage — no skipping, no working
  // on the road not taken.
  if (committedProject(state, graph)?.id !== def.id) return state;
  const stage = nextStage(state, def);
  if (stage === undefined || stage === null || stage.id !== stageId) return state;

  const payment = affordablePayment(state, stage);
  if (payment === null) return state;

  const inventory = consume(state, payment.item, payment.qty);
  let next: GameState = { ...state, player: { ...state.player, inventory } };
  next = withFlags(next, { [projectStageFlag(def.id, stage.id)]: true });
  next = escalate(next, stage);
  next = appendBeat(next, "project.stage", ["player", def.id, stage.id], {
    project: def.id, stage: stage.id, paid: payment.item, qty: payment.qty,
  });

  // The last stage is the ending. The flag is what `runEndReason` reads; the beat is what T61 will
  // assemble the ending FROM.
  if (nextStage(next, def) === null) {
    const flag = def.kind === "escape" ? ENDING_FLAG_ESCAPED : ENDING_FLAG_HELD;
    next = withFlags(next, { [flag]: true });
    next = appendBeat(next, "project.complete", ["player", def.id], { project: def.id, kind: def.kind });
  }
  return next;
}

/**
 * The closing narration for a won run, from the content that won it. Falls back to a plain line when
 * the pool is gone (a save loaded without a graph, or a project deleted from the set between builds) —
 * a run that ended well must never render as an empty string.
 */
export function winNarration(state: GameState, graph: RegionGraph | undefined, reason: "escaped" | "held"): string {
  const def = committedProject(state, graph);
  if (def !== null && def.ending.trim() !== "") return def.ending;
  return reason === "escaped"
    ? "You went out past the last of it and did not look back. Whatever the city is now, it is behind you."
    : "The night came apart against what you had built, and when it was over the walls were still standing, and so were you.";
}
