/**
 * On-demand depth screens (M4 task T54 · FR-UI-04 · GDD Part XVII "Secondary screens").
 *
 * The primary play screen (T19) holds the single decision; everything else is a *drill-down* the
 * player summons on demand and dismisses back to the story (GDD XVII principle 3, "Information on
 * demand"). This module is that drill-down layer: five purpose-built, read-only views —
 * **inventory, companions, shelter, map/journal, codex** — each a pure `(state, graph) => lines`
 * function, so a depth screen adds *no* turn, spends *no* time, and mutates *no* state. Opening one
 * is byte-neutral by construction: it only reads the engine's public selectors.
 *
 * Accessibility is first-cut, not a retrofit (NFR-ACC-01/02, the T20 discipline extended):
 * - **Words, never color or glyph alone.** Every fact is stated in text — a locked affordance names
 *   its gate ("needs their trust"), a threat is a word, infection is a symptom and never a number
 *   (FR-UI-02). The bullet/marker glyphs are decoration; the sentence beside them carries the meaning.
 * - **Zero ANSI.** `render*` emit plain text; a screen reader or a pipe gets everything.
 * - **Stable, labelled structure.** Each screen renders a title, then labelled sections in a fixed
 *   order, then a back hint — the same order every time, so assistive tech and muscle memory hold.
 * - **Keyboard-reachable.** Each screen has a single mnemonic key (see {@link DEPTH_SCREENS}); the
 *   primary screen's `parseCommand` routes those keys, and the footer advertises them (nothing is
 *   reachable only by pointer or discoverable only by accident).
 *
 * The M4 component-library states (design/wireframes.html §03 — default / pressed / focus halo /
 * trust-locked) map onto text affordances here: **pressed/active** is the title bar naming the screen
 * you are in; **focus** is a `>` marker on the row that is the natural next action, always paired with
 * words; **locked** states its gate in words ("[locked — …]"), never a mystery grey. The *actions*
 * themselves (equip/use/drop, give an order, assign a job, travel, add a note) stay on the primary
 * Scene where the engine offers them — the depth screens inform the one decision, they don't replace
 * it (FR-UI-01). Purpose-built views, one intent at a time (SCR-03..07).
 */

import {
  // inventory (SCR-03)
  itemName,
  itemWeight,
  inventoryWeight,
  CARRY_CAPACITY,
  PACK_HEAVY,
  carriedArtifacts,
  economyActive,
  FRESH_FOOD_ITEM,
  SPOILED_FOOD_ITEM,
  // companions (SCR-04)
  companionIds,
  companionName,
  orderOf,
  companionOrderChoices,
  PARTY_CAP,
  ORDER_TRUST_MIN,
  // social axes (SCR-04 / SCR-05)
  socialActive,
  trustTier,
  attitudeRead,
  companionUnease,
  shelterMoodRead,
  // shelter (SCR-05)
  MAX_FORTIFICATION,
  shelterLine,
  stashUnits,
  jobIdOf,
  jobOf,
  buildableJobs,
  recipePool,
  craftable,
  type RecipeDef,
  // map/journal (SCR-06)
  discoveredNodeIds,
  isVisited,
  neighborsOf,
  // codex (SCR-07)
  audibleSignals,
  hasRadio,
  humanityBand,
  // condition
  isWounded,
  worstWound,
  type GameState,
  type RegionGraph,
  type Survivor,
  type NPCState,
  type CharacterState,
  type InventoryEntry,
  type HistoryEvent,
  type NodeId,
  type ItemInstance,
} from "../../engine/src/index.js";

// ---------------------------------------------------------------------------
// Screen registry — the five FR-UI-04 depth screens, each with a mnemonic key
// ---------------------------------------------------------------------------

/** The five FR-UI-04 depth screens. */
export type ScreenId = "inventory" | "companions" | "shelter" | "map" | "codex";

/** One depth screen's identity: its id, the single key that opens it, and its billing. */
export interface DepthScreen {
  readonly id: ScreenId;
  /** The lowercase mnemonic key that opens it from the primary screen (never a reserved key). */
  readonly key: string;
  readonly title: string;
  /** One-line billing shown in the screen's title bar and (abbreviated) in the footer legend. */
  readonly summary: string;
}

/**
 * The registry, in a fixed order. Keys are chosen to be mnemonic and to avoid the reserved primary
 * keys (`s` save, `q` quit) and digit choices: **i**nventory, **c**ompanions, **b**ase (shelter),
 * **m**ap, **l**ore (codex). `b` and `l` sidestep the taken `s`/`c`-adjacent letters while staying
 * memorable ("base", "lore/log").
 */
export const DEPTH_SCREENS: readonly DepthScreen[] = [
  { id: "inventory", key: "i", title: "Inventory", summary: "your pack — weight, categories, artifacts" },
  { id: "companions", key: "c", title: "Companions", summary: "the people with you — condition, trust, orders" },
  { id: "shelter", key: "b", title: "Shelter", summary: "your base — walls, rooms, jobs, the daily report" },
  { id: "map", key: "m", title: "Map & Journal", summary: "the city you know — fog, node memory, your notes" },
  { id: "codex", key: "l", title: "Codex", summary: "lore, the radio, rumors, and the memorial" },
] as const;

/** The reserved lowercase keys the depth screens must never claim (primary-screen verbs). */
export const RESERVED_KEYS: readonly string[] = ["s", "q"] as const;

/** Lowercase keys that open a depth screen, in registry order. */
export const SCREEN_KEYS: readonly string[] = DEPTH_SCREENS.map((s) => s.key);

/** The depth screen a key opens, or `undefined`. Case-insensitive. */
export function screenForKey(key: string): DepthScreen | undefined {
  const k = key.trim().toLowerCase();
  return DEPTH_SCREENS.find((s) => s.key === k);
}

/** The depth screen with this id (total over {@link ScreenId}). */
export function screenById(id: ScreenId): DepthScreen {
  return DEPTH_SCREENS.find((s) => s.id === id)!;
}

// ---------------------------------------------------------------------------
// Small shared, word-only describers (no number leaks, no color)
// ---------------------------------------------------------------------------

/** Join a list into readable prose: "a", "a and b", "a, b, and c". */
function conjoin(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** A pressing need in words, or null when it isn't worth surfacing (mirrors the T19 status seam). */
function needWord(kind: "hunger" | "thirst" | "fatigue", value: number): string | null {
  const scale: Record<typeof kind, readonly [string, string, string]> = {
    hunger: ["hungry", "ravenous", "starving"],
    thirst: ["thirsty", "parched", "dangerously dry"],
    fatigue: ["tired", "weary", "exhausted"],
  };
  if (value >= 85) return scale[kind][2];
  if (value >= 60) return scale[kind][1];
  if (value >= 34) return scale[kind][0];
  return null;
}

/** A survivor's pressing needs in words, or "steady" when none bites. */
function needsPhrase(needs: CharacterState["needs"]): string {
  const pressing = (["hunger", "thirst", "fatigue"] as const)
    .map((k) => needWord(k, needs[k]))
    .filter((s): s is string => s !== null);
  return pressing.length > 0 ? conjoin(pressing) : "steady";
}

/** Humanise a wound/content id tail: "wound.laceration" → "laceration", "item.canned-food" → "canned food". */
function humanId(id: string): string {
  const tail = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
  return tail.replace(/[._-]/g, " ").trim() || id;
}

/** Capitalise the first letter (for a name drawn from a humanised id in the memorial). */
function cap(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * Infection as a *symptom word*, never a number (FR-UI-02). Null while healthy or asymptomatic
 * (incubating) — the clock is hidden and running, nothing to perceive yet.
 */
function infectionWord(condition: CharacterState): string | null {
  switch (condition.infection.stage) {
    case "symptomatic":
      return "feverish";
    case "advanced":
      return "failing — hallucinating";
    case "terminal":
      return "near the end";
    default:
      return null; // none / incubating: not yet perceptible
  }
}

/** A survivor's worst wound in words, or null. */
function woundWord(condition: CharacterState): string | null {
  if (!isWounded(condition)) return null;
  const w = worstWound(condition);
  if (!w) return null;
  const care = w.treated > 0 ? "half-tended" : "untreated";
  return `a ${humanId(w.type)} on the ${w.site} (${care})`;
}

/** A region threat value (0–100) as a word, never a bar. */
function threatWord(threat: number): string {
  if (threat >= 75) return "deadly";
  if (threat >= 50) return "dangerous";
  if (threat >= 25) return "uneasy";
  return "quiet";
}

/** How picked-over a node is, in words. */
function searchWord(searchPct: number): string {
  if (searchPct >= 80) return "stripped";
  if (searchPct >= 34) return "picked over";
  if (searchPct > 0) return "barely touched";
  return "untouched";
}

/** A radio signal's transmitter status + your reception, combined into one readable phrase. */
function signalPhrase(status: string, strength: string): string {
  if (status === "dead") return "off the air";
  const reception = strength === "live" ? "clear" : strength === "faint" ? "faint" : "barely reaching you";
  const transmit = status === "failing" ? "breaking up" : status === "faint" ? "weak" : null;
  return transmit ? `${transmit}, ${reception}` : reception;
}

/** A shelter's barricade integrity (0–100) as a word, never a bar. */
function wallsWord(barricades: number): string {
  const pct = Math.round((barricades / MAX_FORTIFICATION) * 100);
  if (pct >= 75) return "sturdy";
  if (pct >= 50) return "holding";
  if (pct >= 25) return "thin";
  return "breached";
}

/** A blank line only if the previous line wasn't already blank (keeps sections cleanly separated). */
function section(lines: string[], header: string, body: readonly string[]): void {
  if (lines.length > 0) lines.push("");
  lines.push(`${header}:`);
  if (body.length === 0) lines.push("  (nothing yet)");
  else lines.push(...body);
}

// ---------------------------------------------------------------------------
// Screen frame — a stable, labelled shell every depth screen shares (NFR-ACC-02)
// ---------------------------------------------------------------------------

/** The back-hint that closes every depth screen (a screen never traps you). */
export const SCREEN_BACK_HINT = "[any other key returns to the story]";

/**
 * Wrap a screen body in the shared frame: a title bar naming the active screen (the "pressed" state,
 * in words), the body, and the back hint. The title/back regions are constant across screens so the
 * navigable structure never shifts (NFR-ACC-02).
 */
function frame(screen: DepthScreen, body: readonly string[]): readonly string[] {
  return [`— ${screen.title} — ${screen.summary}`, "", ...body, "", SCREEN_BACK_HINT];
}

// ---------------------------------------------------------------------------
// SCR-03 · Inventory — weight, categories, artifact histories (FR-PLR-03 / GDD X)
// ---------------------------------------------------------------------------

/** The category a carried item belongs to, for the SCR-03 filter groups. Keyword-driven, total. */
function itemCategory(type: string): "Medical" | "Food & water" | "Weapons" | "Materials" | "Other" {
  const t = type.toLowerCase();
  if (/(antibiotic|antiseptic|bandage|painkiller|medkit|diagnos)/.test(t)) return "Medical";
  if (/(food|water|ration|canned)/.test(t)) return "Food & water";
  if (/(pistol|rifle|gun|ammo|molotov|blade|knife|axe|bat|weapon)/.test(t)) return "Weapons";
  if (/(scrap|cloth|charcoal|fuel|batter|tool|lighter|blanket|clothing|torch|radio|blueprint|wire|tape|component|part)/.test(t))
    return "Materials";
  return "Other";
}

/** A readable item name — fixing the few compounds `itemName` would invert ("food fresh" → "fresh food"). */
function niceItemName(type: string): string {
  const fixes: { readonly [t: string]: string } = {
    "item.food-fresh": "fresh food",
    "item.food-spoiled": "spoiled food",
    "item.water-dirty": "dirty water",
    "item.warm-clothing": "warm clothing",
    "item.tool-reinforced": "reinforced tool",
  };
  return fixes[type] ?? itemName(type);
}

/** Whether a tracked instance actually carries provenance — the test for the "artifact" label (not mere durability). */
function hasProvenance(item: ItemInstance): boolean {
  const m = item.metadata;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const o = m as { readonly [k: string]: unknown };
    return (
      typeof o.origin === "string" ||
      typeof o.foundAt === "string" ||
      typeof o.history === "string" ||
      Array.isArray(o.history) ||
      typeof o.note === "string" ||
      (typeof o.repairs === "number" && o.repairs > 0)
    );
  }
  return false;
}

/** A one-line provenance for a tracked artifact, drawn from its instance metadata (open, content-shaped). */
function artifactProvenance(item: ItemInstance): string {
  const meta = item.metadata;
  const bits: string[] = [];
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as { readonly [k: string]: unknown };
    if (typeof m.origin === "string") bits.push(m.origin);
    if (typeof m.foundAt === "string") bits.push(`found at ${m.foundAt}`);
    if (typeof m.history === "string") bits.push(m.history);
    if (Array.isArray(m.history)) bits.push(m.history.filter((h) => typeof h === "string").join("; "));
    if (typeof m.repairs === "number" && m.repairs > 0) bits.push(m.repairs === 1 ? "repaired once" : `repaired ${m.repairs} times`);
    if (typeof m.note === "string") bits.push(m.note);
  }
  if (item.durability !== null) bits.push(item.durability >= 66 ? "well-kept" : item.durability >= 33 ? "worn" : "barely holding");
  return bits.length > 0 ? bits.join(" · ") : "carries a history";
}

/** SCR-03 · Pack. Weight is the pressure; categories keep it to one intent; artifacts carry their story. */
export function renderInventory(state: GameState, graph?: RegionGraph): readonly string[] {
  const inv = state.player.inventory;
  const weight = inventoryWeight(inv);
  const load =
    weight >= CARRY_CAPACITY ? "full — you must leave something behind to take more" : weight >= PACK_HEAVY ? "getting heavy" : "room to spare";
  const body: string[] = [`Pack: ${weight}/${CARRY_CAPACITY} weight — ${load}.`];

  // Artifacts = tracked instances that actually carry provenance (origin/history/note/repairs) — not
  // every durability item (a plain worn pistol is not an "artifact"). Losing one hurts (SCR-03 note 3).
  const artifacts = (graph ? carriedArtifacts(state) : []).filter((a) => hasProvenance(a.item));
  const artifactIds = new Set(artifacts.map((a) => a.entry.itemId));

  // Everything else, grouped by category (SCR-03 filter chips → labelled groups).
  const groups: Record<string, string[]> = { Medical: [], "Food & water": [], Weapons: [], Materials: [], Other: [] };
  for (const e of inv) {
    if (e.itemId !== undefined && artifactIds.has(e.itemId)) continue; // shown under Artifacts
    const each = itemWeight(e.type);
    const qty = e.quantity > 1 ? ` ×${e.quantity}` : "";
    groups[itemCategory(e.type)]!.push(`  - ${niceItemName(e.type)}${qty}  (${each * Math.max(1, e.quantity)} wt)`);
  }

  if (artifacts.length > 0) {
    section(
      body,
      "Artifacts",
      artifacts.map((a) => `  - ${niceItemName(a.entry.type)} [artifact] — ${artifactProvenance(a.item)}`),
    );
  }
  for (const cat of ["Medical", "Food & water", "Weapons", "Materials", "Other"] as const) {
    if (groups[cat]!.length > 0) section(body, cat, groups[cat]!);
  }
  if (inv.length === 0) body.push("", "Your pack is empty.");

  // The economy's two carried facts, when the system is live (FR-ECO-05 spoilage; learned recipes).
  if (economyActive(graph)) {
    const extra: string[] = [];
    const fresh = state.player.economy.freshness;
    if (fresh !== null) extra.push(`  - fresh food will spoil in about ${fresh}h (then it turns to ${humanId(SPOILED_FOOD_ITEM)}).`);
    else if (inv.some((e) => e.type === FRESH_FOOD_ITEM)) extra.push("  - fresh food is still keeping.");
    const learned = state.player.economy.blueprints;
    if (learned.length > 0) extra.push(`  - recipes you have learned: ${conjoin(learned.map(humanId))}.`);
    if (extra.length > 0) section(body, "Crafting", extra);
  }

  body.push("", "There is no level here — a better tool and a full pack are the only progress.");
  body.push("Equip · use · drop appear in your choices when you're standing still.");
  return frame(screenById("inventory"), body);
}

// ---------------------------------------------------------------------------
// SCR-04 · Companions — condition, mood, trust (per-person), orders (FR-NPC-03/04)
// ---------------------------------------------------------------------------

/**
 * A companion's standing orders exactly as the engine offers them (T54). The active order is stated on
 * the "currently" line; each switchable order (hold/scavenge/guard) is shown as available only when
 * `companionOrderChoices` actually offers it, and otherwise **locked with the real gate in words** —
 * scavenge needs their trust AND a claimed base; guard needs their trust. Mirroring the engine's offer
 * means the screen can never promise an order the engine would refuse (no false-available).
 */
function orderReadout(state: GameState, c: Survivor): string[] {
  const active = orderOf(c);
  const offered = new Set(
    companionOrderChoices(state)
      .filter((ch) => ch.id.startsWith(`order:${c.id}:`))
      .map((ch) => ch.id.slice(`order:${c.id}:`.length)),
  );
  const trust = c.trust ?? 0;
  const hasBase = state.player.shelterId !== null;
  const rows: string[] = [`  currently: ${active}.`];
  for (const ord of ["hold", "scavenge", "guard"] as const) {
    if (ord === active) continue; // already stated on the "currently" line
    if (offered.has(ord)) {
      rows.push(`  - ${ord} (available)`);
      continue;
    }
    // withheld → state the real gate in words (only the dangerous orders are ever gated).
    let reason: string | null = null;
    if (ord === "scavenge") reason = trust < ORDER_TRUST_MIN ? "needs their trust" : !hasBase ? "needs a base to scavenge for" : null;
    else if (ord === "guard") reason = trust < ORDER_TRUST_MIN ? "needs their trust" : null;
    if (reason) rows.push(`  ✗ ${ord}  [locked — ${reason}]`);
  }
  return rows;
}

/** One companion block: name, condition, mood, trust tier, and their standing orders. */
function companionBlock(state: GameState, c: Survivor, where: string, graph?: RegionGraph): string[] {
  const lines: string[] = [`${companionName(c)} — ${where}`];
  const cond: string[] = [needsPhrase(c.condition.needs)];
  const wound = woundWord(c.condition);
  if (wound) cond.push(wound);
  const infl = infectionWord(c.condition);
  if (infl) cond.push(infl);
  lines.push(`  condition: ${conjoin(cond)}.`);

  const moodBits: string[] = [];
  const unease = companionUnease(c);
  if (unease) moodBits.push(unease);
  const attitude = socialActive(graph) ? attitudeRead(c) : null;
  if (attitude) moodBits.push(attitude);
  lines.push(`  mood: ${moodBits.length > 0 ? conjoin(moodBits) : "even"}; trust — ${trustTier(c.trust ?? 0)}.`);

  lines.push("  orders:");
  for (const r of orderReadout(state, c)) lines.push(`  ${r}`);
  return lines;
}

/** SCR-04 · People. Handcrafted survivors; trust is per-person and earned; everyone is a mouth and a risk. */
export function renderCompanions(state: GameState, graph?: RegionGraph): readonly string[] {
  const ids = companionIds(state);
  const here = state.player.location;
  const home = state.player.shelterId;
  const party = ids.map((id) => state.actors[id]!).filter(Boolean);

  const withYou = party.filter((c) => c.location === here);
  const atHome = party.filter((c) => c.location === home && c.location !== here);
  const elsewhere = party.filter((c) => c.location !== here && c.location !== home);

  const body: string[] = [
    `${withYou.length} with you · ${atHome.length} at home · ${party.length}/${PARTY_CAP} in your party.`,
  ];

  if (party.length === 0) {
    body.push(
      "",
      "You travel alone.",
      "Survivors you meet can be recruited once you have earned their trust — talk, share, keep your word.",
    );
    return frame(screenById("companions"), body);
  }

  const emit = (label: string, group: readonly Survivor[], place: string): void => {
    if (group.length === 0) return;
    body.push("", `${label}:`);
    for (const c of group) {
      for (const l of companionBlock(state, c, place, graph)) body.push(`  ${l}`);
      body.push("");
    }
    if (body[body.length - 1] === "") body.pop();
  };
  emit("With you", withYou, "here, at your side");
  emit("At home", atHome, "holding the shelter");
  emit("Elsewhere", elsewhere, "out in the city");

  body.push("", "Sharing supplies and giving orders appear in your choices when you stand with them.");
  return frame(screenById("companions"), body);
}

// ---------------------------------------------------------------------------
// SCR-05 · Shelter — walls, morale, rooms, jobs, the daily report (FR-SHL-03/04)
// ---------------------------------------------------------------------------

/** Residents of the base right now (companions standing on the shelter node). */
function residentsAtShelter(state: GameState, shelterId: NodeId): readonly Survivor[] {
  return companionIds(state)
    .map((id) => state.actors[id]!)
    .filter((c): c is Survivor => Boolean(c) && c.location === shelterId);
}

/** SCR-05 · Home. One home, evolving; it lives while you're away; the daily report tells you the cost. */
export function renderShelter(state: GameState, graph?: RegionGraph): readonly string[] {
  const sid = state.player.shelterId;
  if (!sid) {
    return frame(screenById("shelter"), [
      "You have not claimed a base yet.",
      "",
      "A defensible node — the kind you can barricade and come back to — can become one.",
      "The claim option appears in your choices when you stand somewhere claimable.",
    ]);
  }
  const node = state.nodes[sid];
  const name = graph?.nodes[sid]?.name ?? humanId(sid);
  const body: string[] = [`${name} — your base.`];

  // Vital signs, in words (never bars).
  const vitals: string[] = [`walls: ${wallsWord(node?.barricades ?? 0)}`];
  const mood = socialActive(graph) ? shelterMoodRead(state) : null;
  vitals.push(`morale: ${mood ?? "quiet"}`);
  vitals.push(`stores: ${stashUnits(state.player.stash)} supplies banked`);
  body.push(`  ${conjoin(vitals)}.`);

  // Rooms — built (glow) vs. the real "+ build" slots: unbuilt room recipes (not already-built ones).
  const built = node?.rooms ?? [];
  const builtRows = built.length > 0 ? built.map((r) => `  - ${humanId(r)} (built)`) : ["  (only the bare walls so far)"];
  section(body, "Rooms", builtRows);
  const unbuilt = recipePool(graph).filter((r) => r.installsRoom !== undefined && !built.includes(r.installsRoom));
  if (unbuilt.length > 0) {
    section(
      body,
      "Could build",
      unbuilt.map((r) => `  - ${humanId(r.installsRoom!)} — ${r.worldEffect}${craftable(state, graph, r) ? " (you have what it takes)" : ""}`),
    );
  }

  // Jobs — who's assigned, plus the jobs your *built* rooms now allow (buildableJobs = room-built jobs).
  const residents = residentsAtShelter(state, sid);
  const jobRows: string[] = [];
  for (const c of residents) {
    const jid = jobIdOf(c);
    const job = jid ? jobOf(graph, jid) : undefined;
    jobRows.push(`  - ${companionName(c)}: ${job ? job.label : "unassigned"}`);
  }
  if (residents.length === 0) jobRows.push("  (no one is home right now)");
  const assignable = buildableJobs(state, graph);
  if (assignable.length > 0) jobRows.push(`  jobs your rooms allow: ${conjoin(assignable.map((j) => j.label.toLowerCase()))}.`);
  section(body, `Jobs (${residents.length} home)`, jobRows);

  // The standing status, then the persisted daily report — what your absence cost, from the append-only
  // Living History (the this-turn `jobLine` alone is gone one action later, so scan the log instead, F4).
  const sLine = shelterLine(state);
  if (sLine) body.push("", sLine);
  const REPORTABLE = new Set([
    "shelter.weakened",
    "shelter.fortified",
    "social.deserted",
    "social.betrayed",
    "social.confided",
    "companion.died",
    "npc.died",
  ]);
  const baseNews = state.history.filter((e) => REPORTABLE.has(e.type)).slice(-4).reverse();
  section(body, "Recent at the base", baseNews.map(historyLine));

  body.push("", "Claim, fortify, assign jobs, and rest appear in your choices at the base.");
  return frame(screenById("shelter"), body);
}

// ---------------------------------------------------------------------------
// SCR-06 · Map & Journal — fog of war, node memory, player notes, history (FR-MAP)
// ---------------------------------------------------------------------------

/** Render one Living-History event as a short past-tense line (the map's auto-annotation). */
export function historyLine(ev: HistoryEvent): string {
  // Normalise once so every case is safe even against a hand-built event missing `subjects`/`data`.
  const e = { ...ev, subjects: ev.subjects ?? [], data: ev.data ?? {} };
  const when = `Day ${e.day}, ${String(e.hour).padStart(2, "0")}:00`;
  const data = e.data as { readonly [k: string]: unknown };
  const nameOf = (fallback: string): string => (typeof data.name === "string" ? data.name : fallback);
  let what: string;
  switch (e.type) {
    case "weather.change":
      what = `the sky turned to ${humanId(String(data.to ?? "weather"))}`;
      break;
    case "nightfall":
      what = "night fell";
      break;
    case "horde.move":
      what = "a horde shifted through the streets";
      break;
    case "route.change":
      what = `a route between ${e.subjects.map(humanId).join(" and ")} changed`;
      break;
    case "combat.cleared":
      what = `you put down ${humanId(String(e.subjects[0] ?? "an attacker"))}`;
      break;
    case "npc.met":
      what = `you met ${nameOf(humanId(e.subjects[0] ?? "someone"))}`;
      break;
    case "npc.died":
      what = `${nameOf(humanId(e.subjects[0] ?? "someone"))} died`;
      break;
    case "companion.recruited":
      what = `${humanId(e.subjects[0] ?? "someone")} joined you`;
      break;
    case "companion.died":
      what = `${humanId(e.subjects[0] ?? "a companion")} was lost`;
      break;
    case "shelter.claimed":
      what = "you claimed a base";
      break;
    case "shelter.fortified":
      what = "you shored up the walls";
      break;
    case "infection.staged":
      what = "the sickness took a turn";
      break;
    case "social.confided":
      what = `${humanId(e.subjects[0] ?? "someone")} confided in you`;
      break;
    case "social.deserted":
      what = `${humanId(e.subjects[0] ?? "someone")} slipped away in the night`;
      break;
    case "social.betrayed":
      what = `${humanId(e.subjects[0] ?? "someone")} betrayed you and took what they could`;
      break;
    case "run.ended":
      what = "the run ended";
      break;
    case "begin":
    case "run.begin":
    case "run.started":
      what = "the run began";
      break;
    case "encounter.begin":
      what = "something happened on the street";
      break;
    case "encounter.end":
    case "encounter.followup":
      what = "an encounter played out";
      break;
    case "encounter.left":
      what = "you walked away from a situation";
      break;
    case "radio.tuned":
      what = "you tuned the radio and listened";
      break;
    case "radio.broadcast":
      what = "you put your voice out on the air";
      break;
    case "shelter.weakened":
      what = "your walls took damage";
      break;
    case "story.arc":
    case "story.beat":
      what = "the story turned";
      break;
    default:
      // Humanise the whole type key ("shelter.tick" → "shelter tick") — never a bare, contextless word.
      what = e.type.replace(/[._-]/g, " ");
  }
  return `  ${when} — ${what}.`;
}

/** SCR-06 · Map. Nodes with memory, fog of war, your own handwriting; travel always has a price. */
export function renderMap(state: GameState, graph?: RegionGraph): readonly string[] {
  const total = graph ? Object.keys(graph.nodes).length : Object.keys(state.nodes).length;
  const known = discoveredNodeIds(state.nodes);
  const pct = total > 0 ? Math.round((known.length / total) * 100) : 0;
  const here = state.player.location;
  const home = state.player.shelterId;

  const body: string[] = [`${known.length} of ${total} places known — fog over ${100 - pct}% of the city.`];

  // Here and home, up front.
  const hereName = graph?.nodes[here]?.name ?? humanId(here);
  const hereRegion = graph?.nodes[here]?.regionId;
  const hereThreat = hereRegion ? threatWord(state.regions[hereRegion]?.threat ?? 0) : "unknown";
  body.push(`  You are at: ${hereName} (${hereThreat}).`);
  if (home) body.push(`  Home: ${graph?.nodes[home]?.name ?? humanId(home)}.`);

  // Known nodes, grouped by region, each with its memory.
  const byRegion = new Map<string, string[]>();
  for (const id of known) {
    const node = state.nodes[id];
    if (!node) continue;
    const regionId = node.regionId;
    const regionName = graph?.regions[regionId]?.name ?? humanId(regionId);
    const tags: string[] = [];
    if (id === here) tags.push("you are here");
    if (id === home) tags.push("home");
    tags.push(isVisited(node) ? searchWord(node.searchPct) : "not yet entered");
    if (node.walkers > 0) tags.push(node.walkers === 1 ? "1 walker" : `${node.walkers} walkers`);
    const discoveries = node.discoveries ?? [];
    if (discoveries.length > 0) tags.push(`found: ${conjoin(discoveries.map(humanId))}`);
    const row = `  - ${graph?.nodes[id]?.name ?? humanId(id)} (${threatWord(state.regions[regionId]?.threat ?? 0)}) — ${conjoin(tags)}`;
    const arr = byRegion.get(regionName) ?? [];
    arr.push(row);
    // Player's own notes pinned here (their handwriting).
    for (const note of node.playerNotes ?? []) arr.push(`      your note: "${note}"`);
    byRegion.set(regionName, arr);
  }
  for (const [region, rows] of byRegion) section(body, region, rows);

  // The fog edge: undiscovered neighbours of where you stand read as "?".
  if (graph) {
    const unknownNeighbours = neighborsOf(graph, here).filter((n) => !state.nodes[n]?.discovered);
    if (unknownNeighbours.length > 0) {
      section(body, "Onward (unknown)", unknownNeighbours.map(() => "  - ? — an unexplored way out"));
    }
  }

  // Auto-annotated history — the last handful of notable events.
  const recent = state.history.slice(-6).reverse();
  if (recent.length > 0) section(body, "Recent history", recent.map(historyLine));

  body.push("", "Travel (with its time and noise) and add-a-note appear in your choices.");
  return frame(screenById("map"), body);
}

// ---------------------------------------------------------------------------
// SCR-07 · Codex — lore, radio, rumors, and the memorial (FR-STY / GDD XIII)
// ---------------------------------------------------------------------------

/** SCR-07 · Journal. Three layers at your pace; the radio is alive; the memorial remembers by name and how. */
export function renderCodex(state: GameState, graph?: RegionGraph): readonly string[] {
  const body: string[] = ["The story you uncover, and the people you couldn't keep."];

  // Lore — discovered fragments.
  const lore = state.story.lore;
  section(body, "Lore", lore.length > 0 ? lore.map((id) => `  - ${humanId(id)}`) : []);

  // Radio — the signals you can actually receive (you need a radio to hear anything), alive and ageing.
  if (hasRadio(state) && graph) {
    const signals = audibleSignals(state, graph);
    section(
      body,
      "Radio",
      signals.map((s) => `  - ${s.def.label} (${humanId(s.def.signalType)}) — ${signalPhrase(s.status, s.strength)}`),
    );
  } else {
    section(body, "Radio", ["  You have no working radio — the airwaves are silent to you."]);
  }

  // Rumors — leads confided, mysteries open. Confided leads come through the Living History.
  const rumorRows: string[] = [];
  for (const e of state.history) {
    if (e.type === "social.confided") {
      const subj = (e.subjects ?? [])[0];
      const who = typeof (e.data as { name?: unknown })?.name === "string" ? (e.data as { name: string }).name : cap(humanId(subj ?? "someone"));
      rumorRows.push(`  - ${who} told you something worth chasing.`);
    }
  }
  for (const [mystery, stateKey] of Object.entries(state.story.mysteries)) rumorRows.push(`  - ${humanId(mystery)}: ${humanId(stateKey)}`);
  section(body, "Rumors", rumorRows);

  // Memorial — the dead and the departed, by name and by how (from the append-only history).
  const memorial: string[] = [];
  for (const e of state.history) {
    const data = (e.data ?? {}) as { readonly name?: unknown };
    const subj = (e.subjects ?? [])[0];
    const named = typeof data.name === "string" ? data.name : cap(humanId(subj ?? "someone"));
    if (e.type === "companion.died") memorial.push(`  † ${cap(humanId(subj ?? "a companion"))} — Day ${e.day}, fell at your side.`);
    else if (e.type === "npc.died") memorial.push(`  † ${named} — Day ${e.day}, did not make it.`);
    else if (e.type === "social.deserted") memorial.push(`  ↳ ${cap(humanId(subj ?? "someone"))} — Day ${e.day}, left in the night.`);
    else if (e.type === "social.betrayed") memorial.push(`  ↳ ${cap(humanId(subj ?? "someone"))} — Day ${e.day}, betrayed the base and ran.`);
  }
  section(body, "Memorial", memorial);

  // The run's moral shape, felt not counted (never a number). `humanityBand` is already a full,
  // second-person sentence ending in "." — surface it as its own line, no external frame (F5).
  const humanity = humanityBand(state);
  if (humanity) body.push("", humanity);

  body.push("", "Fragments accumulate here as you play — they are the record the next run can inherit.");
  return frame(screenById("codex"), body);
}

// ---------------------------------------------------------------------------
// Dispatch — render any depth screen by id (total over ScreenId)
// ---------------------------------------------------------------------------

/**
 * Render a depth screen by id. Pure and read-only: identical `(id, state, graph)` always yields the
 * same lines, and rendering never mutates state or advances the clock (opening a screen is free).
 */
export function renderDepthScreen(id: ScreenId, state: GameState, graph?: RegionGraph): readonly string[] {
  switch (id) {
    case "inventory":
      return renderInventory(state, graph);
    case "companions":
      return renderCompanions(state, graph);
    case "shelter":
      return renderShelter(state, graph);
    case "map":
      return renderMap(state, graph);
    case "codex":
      return renderCodex(state, graph);
  }
}

/** The footer legend advertising the depth-screen keys (discoverability — nothing missable, NFR-ACC). */
export function screenLegend(): string {
  return DEPTH_SCREENS.map((s) => `${s.key.toUpperCase()} ${s.title.toLowerCase()}`).join(" · ");
}
