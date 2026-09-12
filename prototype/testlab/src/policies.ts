/**
 * Policies — how the autoplayer picks a choice each turn.
 *
 * Every policy returns one of the choices the engine actually OFFERED this turn (`availableActions`), so a
 * policy can never submit an illegal action; the engine validates by choice id and would throw otherwise.
 * Policies are deliberately simple probes of the game, not models of skilled play — the point is to reach
 * many different states cheaply and let the checks look at each one.
 *
 * Randomness for a policy comes from its OWN tiny PRNG seeded from the run seed (the `policyRng` shape of
 * `harness/measure/t77.ts`), never from the engine's named streams, so the bot's choices are reproducible
 * from the seed and the engine's determinism is not perturbed.
 */

import type { GameState, SceneChoice } from "../../engine/src/index.js";

export type PolicyName = "random" | "careful" | "greedy" | "fighter";
export const POLICY_NAMES: readonly PolicyName[] = ["random", "careful", "greedy", "fighter"];

export const POLICY_INFO: { readonly [P in PolicyName]: { readonly title: string; readonly gloss: string } } = {
  random: { title: "Random", gloss: "Uniform over every offered choice — the fuzzer. Reaches states no sensible player would." },
  careful: { title: "Careful", gloss: "Treats, drinks, eats and rests when needed; avoids fights; scavenges and moves." },
  greedy: { title: "Greedy", gloss: "Searches first, moves second, never treats — the player who ignores everything." },
  fighter: { title: "Fighter", gloss: "Careful, but takes every fight offered — exercises combat and wounds." },
};

/** What a policy sees when it picks. */
export interface PolicyContext {
  readonly state: GameState;
  readonly choices: readonly SceneChoice[];
  readonly rng: () => number;
  /** How many consecutive zero-cost picks preceded this one (guards against free-verb ping-pong). */
  readonly zeroCostStreak: number;
}

export type Policy = (ctx: PolicyContext) => SceneChoice;

/** The verb of a choice id: `move:node.x` -> `move`, `event:enc:choice` -> `event`. */
export const kindOf = (id: string): string => id.split(":")[0] ?? id;

/** Verbs that resolve without advancing the clock (`meta.turn` unchanged). */
export const ZERO_COST_KINDS: ReadonlySet<string> = new Set(["drop", "stash-deposit", "stash-withdraw", "order", "assign-job", "clear-job"]);

/** Verbs that are an escape from a threat (overrun, combat, contested node). */
export const ESCAPE_KINDS: ReadonlySet<string> = new Set(["flee", "retreat", "slip"]);
/** Verbs that engage a threat. */
export const FIGHT_KINDS: ReadonlySet<string> = new Set(["fight", "strike", "fire"]);

/** A tiny string-seeded PRNG (mulberry32 over an FNV-ish hash) for the POLICY only. */
export function policyRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const byKind = (choices: readonly SceneChoice[], kind: string): SceneChoice[] => choices.filter((c) => kindOf(c.id) === kind);
const byKinds = (choices: readonly SceneChoice[], kinds: ReadonlySet<string>): SceneChoice[] => choices.filter((c) => kinds.has(kindOf(c.id)));
const first = (choices: readonly SceneChoice[]): SceneChoice => choices[0]!;

/** After two free picks in a row, only costed choices are eligible (if any exist). */
function costedIfStreak(ctx: PolicyContext): readonly SceneChoice[] {
  if (ctx.zeroCostStreak < 2) return ctx.choices;
  const costed = ctx.choices.filter((c) => c.timeCost > 0);
  return costed.length > 0 ? costed : ctx.choices;
}

/** Of the offered escapes, the one whose destination has the fewest known walkers (ties broken at random). */
function calmestEscape(ctx: PolicyContext, escapes: readonly SceneChoice[]): SceneChoice {
  const walkersAt = (c: SceneChoice): number => {
    const to = c.id.slice(c.id.indexOf(":") + 1);
    const node = ctx.state.nodes[to];
    return node === undefined || !node.discovered ? 1 : node.walkers;
  };
  const best = Math.min(...escapes.map(walkersAt));
  return pick(ctx.rng, escapes.filter((c) => walkersAt(c) === best));
}

const random: Policy = (ctx) => pick(ctx.rng, costedIfStreak(ctx));

/** The exit-gate survival priority, extended with the threat verbs. `fightFirst` turns it into the fighter. */
function survivalPolicy(fightFirst: boolean): Policy {
  return (ctx) => {
    const choices = costedIfStreak(ctx);
    const needs = ctx.state.player.condition.needs;
    const one = (kind: string): SceneChoice | undefined => byKind(choices, kind)[0];

    if (fightFirst) {
      const fights = byKinds(choices, FIGHT_KINDS);
      if (fights.length > 0) {
        // Prefer the quiet blow; a gun is loud and burns ammo, so only sometimes.
        const quiet = fights.filter((c) => kindOf(c.id) !== "fire");
        if (quiet.length > 0) return pick(ctx.rng, quiet);
        if (ctx.rng() < 0.3) return pick(ctx.rng, fights);
      }
    }
    const escapes = byKinds(choices, ESCAPE_KINDS);
    if (escapes.length > 0) {
      // A contested node offers only fight/slip, so a bot that always slips can starve mid-flight. When a
      // need is critical and the node is lightly held, clear it instead — then the survival verbs return.
      const here = ctx.state.nodes[ctx.state.player.location];
      const critical = needs.thirst >= 70 || needs.hunger >= 75;
      const fight = one("fight");
      if (critical && fight && here !== undefined && here.walkers <= 2 && ctx.state.combat === null) return fight;
      return calmestEscape(ctx, escapes);
    }
    const hold = one("hold");
    if (hold) return hold;

    // A critical need beats wound care — a bandaged corpse is still a corpse.
    const drink = one("drink");
    const eat = one("eat");
    if (drink && needs.thirst >= 60) return drink;
    if (eat && needs.hunger >= 60) return eat;
    const cure = one("treat-infection");
    if (cure) return cure;
    const diagnose = one("diagnose");
    if (diagnose) return diagnose;
    const treat = one("treat");
    if (treat) return treat;
    if (drink && needs.thirst >= 40) return drink;
    if (eat && needs.hunger >= 45) return eat;
    const sleep = one("sleep");
    if (sleep && needs.fatigue >= 85) return sleep;
    const rest = one("rest");
    if (rest && needs.fatigue >= 70) return rest;

    const events = byKind(choices, "event");
    if (events.length > 0) return pick(ctx.rng, events);
    const search = one("search");
    if (search && ctx.rng() < 0.35) return search;
    const moves = byKind(choices, "move");
    if (moves.length > 0) return pick(ctx.rng, moves);
    if (search) return search;
    if (rest) return rest;
    return first(choices);
  };
}

const careful: Policy = survivalPolicy(false);
const fighter: Policy = survivalPolicy(true);

/** Search > move > rest; never treats, never drinks unless nothing else is offered. */
const greedy: Policy = (ctx) => {
  const choices = costedIfStreak(ctx);
  const search = byKind(choices, "search")[0];
  if (search) return search;
  const moves = byKind(choices, "move");
  if (moves.length > 0) return pick(ctx.rng, moves);
  const escapes = byKinds(choices, ESCAPE_KINDS);
  if (escapes.length > 0) return calmestEscape(ctx, escapes);
  const rest = byKind(choices, "rest")[0];
  if (rest) return rest;
  return first(choices);
};

const POLICIES: { readonly [P in PolicyName]: Policy } = { random, careful, greedy, fighter };

export function policyFor(name: PolicyName): Policy {
  return POLICIES[name];
}

export function isPolicyName(s: string): s is PolicyName {
  return (POLICY_NAMES as readonly string[]).includes(s);
}
