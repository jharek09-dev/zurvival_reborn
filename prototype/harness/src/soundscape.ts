/**
 * The soundscape — the client-side Audio Director, rendered as text (M4 task T55 · FR-AUD-01/02/06 ·
 * AUDIO §13.2 · GDD Part XVIII).
 *
 * In a text-forward game **the soundtrack is the graphics** (AUDIO §1): the world the prose only names
 * is made a place by what the player *hears*, and the most important survival information — a distant
 * shot, a nearing horde, a Screamer's shriek, your own heart in your ears — arrives through sound. This
 * module is the AUDIO bible's client-side **Audio Director** (§13.2): a pure `(state, graph) => mix`
 * that reads the simulation and produces the five adaptively-mixed layers (§3). The text client renders
 * that mix as **sound-captions** — and those captions are the non-audio equivalent a deaf/HoH player
 * plays by (FR-AUD-06, Must), so they are the *primary* channel here, not a retrofit (AUDIO §11).
 *
 * Determinism boundary (AUDIO §13.3, the load-bearing rule): audio is **downstream and
 * side-effect-only** — it reads state, it never writes `GameState`, it draws no RNG and reads no clock.
 * So this whole module is a total function of `(state, graph)`: rendering the same turn twice is
 * byte-identical, and a client with the soundscape shown or hidden resolves the same run. Nothing in the
 * engine is touched (the strongest byte-identity story — the T54 shape).
 *
 * The Golden Rule (AUDIO §2.1) governs every layer: **when in doubt, take it out.** The default readout
 * is sparse — a quiet, safe turn is the ambient bed and your own body, nothing more; the informational
 * cues surface loudly only when the world puts them there. Silence is authored (§4.1), so level-0 music
 * renders as *no* tone line and the heartbeat is what remains (§6.4, "the last thing standing").
 *
 * No number ever leaks (FR-UI-02): Fear is a heartbeat in words, never the 0–100 int; the sickness is a
 * symptom and a stage-level distortion, never `progression`; proximity is a distance word, never a
 * float; the music intensity is a mood word, never `2/4`. The unreliable-audio model (§9.2) is surfaced
 * as *the player being told they can't trust their hearing* rather than a fabricated concrete cue, so it
 * never hides required information unfairly (the AUDIO §9.2/§11 fairness rule).
 */

import {
  neighborsOf,
  isDiscovered,
  isRunOver,
  isWounded,
  worstWound,
  ZOMBIE_WALKER,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  ZOMBIE_FRESH,
  ZOMBIE_CRAWLER,
  ZOMBIE_BLOATED,
  ZOMBIE_RIOT,
  WEATHER_RAIN,
  WEATHER_STORM,
  WEATHER_FOG,
  WEATHER_SNOW,
  WEATHER_WIND,
  REPATH_NOISE,
  type GameState,
  type RegionGraph,
  type NodeId,
  type NodeState,
  type ContentId,
} from "../../engine/src/index.js";

// ---------------------------------------------------------------------------
// The mix — the five layers (AUDIO §3)
// ---------------------------------------------------------------------------

/**
 * One turn's soundscape, decomposed into the AUDIO bible's five layers (§3). Each is text: the sparse,
 * words-only realization of what a Web Audio / FMOD client (§13.4) would mix from the same read.
 */
export interface Soundscape {
  /** Ambient bed — region × phase × weather × interior/shelter (§5). Always one line; the floor of the mix. */
  readonly bed: string;
  /** Environmental one-shots tied to node state — fire, the dead, your barricades, a dead grid (§6.7). */
  readonly environmental: readonly string[];
  /** The informational layer (§6.1/§6.2, FR-AUD-02): positioned noise, zombie signatures, hordes. */
  readonly dynamic: readonly string[];
  /** The body — heartbeat (Fear), breath, footsteps, the infection distortion (§6.4/§9). Always ≥ 1 line. */
  readonly body: readonly string[];
  /** The Director's music read as a mood word + intensity (§4); null at level-0 (silence, the heartbeat carries it). */
  readonly tone: string | null;
}

// ---------------------------------------------------------------------------
// Earshot — distance & direction over the node graph (the text form of §11's positional captions)
// ---------------------------------------------------------------------------

/** How far a node is from the player (hops) and the first step of the path to it (for direction). */
interface Reach {
  readonly hops: number;
  /** The neighbour of the player's node that begins the shortest path here; null at the player's node. */
  readonly via: NodeId | null;
}

/** How many hops out the player can hear at all. Loud cues (a shriek, a horde) still attenuate to nothing beyond this. */
export const EARSHOT_MAX = 3;
/** A positioned world-noise spike loses this much per hop (a gunshot travels; a footstep does not — §6.1). */
const NOISE_ATTEN_PER_HOP = 18;
/** Rain/fog/storm/snow pull detail back (§5.3): a masking penalty on how far faint sound carries. */
const WEATHER_MASK = 12;
/** The faintest attenuated off-node spike still worth a caption. */
const NOISE_HEARD_MIN = 18;

/**
 * Breadth-first earshot from the player's node out to `maxHops`, recording each node's hop distance and
 * the first step of the path to it. Deterministic (neighbours walked in sorted order). Uses a transient
 * `Map` — fine in a pure function; only `GameState` must be plain JSON, and this writes none.
 */
function earshot(graph: RegionGraph, from: NodeId, maxHops: number): Map<NodeId, Reach> {
  const reach = new Map<NodeId, Reach>([[from, { hops: 0, via: null }]]);
  let frontier: NodeId[] = [from];
  for (let d = 1; d <= maxHops; d++) {
    const next: NodeId[] = [];
    for (const cur of frontier) {
      const curVia = reach.get(cur)!.via;
      for (const nb of [...neighborsOf(graph, cur)].sort()) {
        if (reach.has(nb)) continue;
        reach.set(nb, { hops: d, via: curVia ?? nb }); // d===1 ⇒ the neighbour itself is the first step
        next.push(nb);
      }
    }
    frontier = next;
  }
  return reach;
}

/** Distance in words — the text form of §11's positional captions. */
function distanceWord(hops: number): string {
  if (hops <= 0) return "here";
  if (hops === 1) return "close";
  if (hops === 2) return "near";
  return "in the distance";
}

/**
 * Direction in words, and *fair to the fog*: the bearing is named only through a place the player already
 * knows (a discovered neighbour). You can tell a sound is close and roughly which way, but hearing it
 * never spells out an unvisited building — so a caption never leaks the map (respects FR-MAP fog).
 */
function bearingWord(state: GameState, graph: RegionGraph | undefined, e: Reach): string {
  if (graph === undefined || e.hops <= 0 || e.via === null) return "";
  const viaNode = graph.nodes[e.via];
  const viaState = state.nodes[e.via];
  if (viaNode !== undefined && viaState !== undefined && isDiscovered(viaState)) return `toward ${viaNode.name}`;
  return ""; // an unknown direction — the distance stands alone, out of sight
}

/** A located caption: `[label — close, toward the Corner Store]` (or just `[label — here]`). */
function locate(label: string, state: GameState, graph: RegionGraph | undefined, e: Reach): string {
  const dir = bearingWord(state, graph, e);
  return `[${label} — ${dir ? `${distanceWord(e.hops)}, ${dir}` : distanceWord(e.hops)}]`;
}

// ---------------------------------------------------------------------------
// Layer 1 — the ambient bed (AUDIO §5)
// ---------------------------------------------------------------------------

const isNight = (s: GameState): boolean => s.meta.phase === "night";
const atOwnShelter = (s: GameState): boolean =>
  s.player.shelterId !== null && s.player.shelterId === s.player.location;

/** The weather's informational tell (§5.3) — what it does to what you can hear, not just its texture. */
function weatherBed(weather: ContentId): string {
  switch (weather) {
    case WEATHER_RAIN: return "rain steady on the roofs, blurring everything else";
    case WEATHER_STORM: return "the storm swallowing the world — you'd hear a horde late";
    case WEATHER_FOG: return "fog closing it all in, muffled and near";
    case WEATHER_SNOW: return "a high, hushed stillness over the snow";
    case WEATHER_WIND: return "the wind gusting and falling, hiding what it wants to";
    default: return "";
  }
}

/**
 * The bed: region identity coloured by phase and threat, plus the weather tell and the shelter/grid
 * frame. One line, assembled from parts so any combination resolves without authoring the product of
 * all of them (§5). A region darkens as its danger rises — worded as *wrongness*, never a number.
 */
function buildBed(state: GameState, graph: RegionGraph | undefined): string {
  const here = state.nodes[state.player.location];
  const regionId = here?.regionId;
  const regionName = (regionId && graph?.regions[regionId]?.name) || "the district";
  const region = regionId ? state.regions[regionId] : undefined;
  const onEdge = (region?.threat ?? 0) >= 55 || state.world.globalThreat >= 60;

  const timeWord = isNight(state)
    ? "the late-night hush, and it feels wrong"
    : state.meta.phase === "evening"
      ? "the light going, the quiet thickening"
      : "a low, worn quiet";
  const head = atOwnShelter(state)
    ? isNight(state)
      ? `Inside your walls, the shelter's night-tone holds — the quiet a night attack would break`
      : `Inside your walls, the room tone is close and familiar`
    : `${regionName} sits in ${timeWord}${onEdge ? ", something in it on edge" : ""}`;

  const parts = [head];
  const w = weatherBed(state.world.weather);
  if (w) parts.push(w);
  if (state.world.powerGrid <= 20 && !atOwnShelter(state)) parts.push("no hum of power anywhere");
  return `${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Layer 2 — environmental one-shots (AUDIO §6.7)
// ---------------------------------------------------------------------------

/** Positioned one-shots read from the node/region — real state only, never invented; sparse by nature. */
function buildEnvironmental(state: GameState): string[] {
  const here = state.nodes[state.player.location];
  if (here === undefined) return [];
  const region = state.regions[here.regionId];
  const out: string[] = [];
  if ((region?.fire ?? 0) >= 40) out.push("the crackle and pop of a fire somewhere near, and the reek of smoke");
  if (here.corpses > 0) out.push("the drone of flies over the dead here");
  if (atOwnShelter(state) && here.barricades > 0) out.push("your barricades ticking and settling");
  if (here.damage >= 60) out.push("the building groaning on a broken frame");
  return out;
}

// ---------------------------------------------------------------------------
// Layer 3 — the dynamic / informational layer (AUDIO §6.1/§6.2 · FR-AUD-02)
// ---------------------------------------------------------------------------

/** Each distinct zombie type's authored *tell* (§6.2) — the signature the player learns to fear. */
const ZOMBIE_TELL: { readonly [id: ContentId]: string } = {
  [ZOMBIE_WALKER]: "the slow, wet drag of walkers",
  [ZOMBIE_FRESH]: "a ragged, sprinting breath, something fresh and fast",
  [ZOMBIE_CRAWLER]: "a low scrape of nails on concrete, a crawler down at ankle height",
  [ZOMBIE_BLOATED]: "a wet, straining gurgle, a bloated one you don't want to be near when it goes",
  [ZOMBIE_RIOT]: "the clank of armour on something that will not go down",
  [ZOMBIE_SCREAMER]: "a restless, building rasp, a screamer not screaming yet",
};

const isRoused = (st: NodeState["zombieState"]): boolean => st === "investigating" || st === "chasing";
/** Walkers/dead present enough to make a collective moan. Tolerant of a malformed node (crash-safe). */
const hasDead = (n: NodeState): boolean => n.walkers > 0 || (n.zombieTypes ?? []).length > 0;

/** The collective moan of loitering dead, by count (§6.2 horde bed at node scale). */
function walkerMoan(n: NodeState): string | null {
  if (n.walkers >= 5) return "a knot of the dead, moaning";
  if (n.walkers >= 2) return "a few of the dead, shifting and moaning";
  if (n.walkers === 1) return "one of the dead, shifting";
  return null;
}

/** A horde's size in words (§6.2 — the collective bed's size is a parameter). */
function sizeWord(size: number): string {
  if (size >= 20) return "a great mass";
  if (size >= 8) return "a pack";
  return "a handful";
}

/**
 * One informational cue, kept structured so ordering, the sparsity cap, the Fear read, and the music
 * intensity all key off *real* urgency & proximity — not off string-matching the rendered text.
 */
interface Cue {
  readonly text: string;
  /** Higher renders first and is never dropped by the cap (a shriek/chase/on-you outranks an ambient tell). */
  readonly urgency: number;
  /** 0–1 danger closeness feeding Fear + music (a chase on your node ≈ 1, a far tell ≈ 0.3). */
  readonly proximity: number;
}

/** Proximity 0–1 from hop distance — the continuous read the Fear and Danger layers build on (§4.3). */
function proximityOf(hops: number): number {
  if (hops <= 0) return 1;
  if (hops === 1) return 0.7;
  if (hops === 2) return 0.5;
  return 0.3;
}

/**
 * The informational layer as structured cues (§6.1/§6.2): positioned world-noise, zombie signatures,
 * behavioural state reads, and the horde collective bed — everything the player learns to *listen* for.
 * Each cue carries an urgency (ordering + the cap) and a proximity (Fear + music). Directional and
 * distanced via the graph; node-local when no graph is available. Reads only state — never mutates it.
 */
function buildDynamicCues(state: GameState, graph: RegionGraph | undefined): Cue[] {
  const cues: Cue[] = [];
  const hereId = state.player.location;
  const here = state.nodes[hereId];
  const masked = [WEATHER_RAIN, WEATHER_STORM, WEATHER_FOG, WEATHER_SNOW].includes(state.world.weather);
  const mask = masked ? WEATHER_MASK : 0;

  const reach = graph ? earshot(graph, hereId, EARSHOT_MAX) : new Map<NodeId, Reach>([[hereId, { hops: 0, via: null }]]);
  const scan = [...reach.entries()].sort((a, b) => a[1].hops - b[1].hops || (a[0] < b[0] ? -1 : 1));

  // 1. Screamer shriek — the region woke (§6.2/§8). Region-scale, so it carries, but reads closer if it is.
  for (const [id, e] of scan) {
    const n = state.nodes[id];
    if (n && (n.zombieTypes ?? []).includes(ZOMBIE_SCREAMER) && isRoused(n.zombieState)) {
      cues.push({ text: `${locate("a shriek splits the air", state, graph, e)} — the whole area just woke`, urgency: 100, proximity: Math.max(0.5, proximityOf(e.hops)) });
      break; // one shriek is the event; don't stack them
    }
  }

  // 2. Hordes — the collective bed, swelling by distance (§6.2). A horde on your node is dire, and sized.
  for (const h of [...(state.hordes ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const e = reach.get(h.pos);
    if (e === undefined) continue;
    cues.push(
      e.hops === 0
        ? { text: `[the dead are on you — ${sizeWord(h.size)} of them, right here]`, urgency: 95, proximity: 1 }
        : { text: locate(`${sizeWord(h.size)} of the dead, moving`, state, graph, e), urgency: 50 + (EARSHOT_MAX - e.hops) * 6, proximity: proximityOf(e.hops) },
    );
  }

  // 3. The player's own node — the immediate read: what's here and what it's doing.
  if (here) {
    if (here.zombieState === "chasing") cues.push({ text: "[something here is coming — the sound tightens]", urgency: 90, proximity: 0.9 });
    else if (here.zombieState === "investigating") cues.push({ text: "[something here has turned toward you]", urgency: 66, proximity: 0.7 });
    else if (here.zombieState === "feeding") cues.push({ text: "the wet sounds of feeding — occupied, for now", urgency: 38, proximity: 0.3 });
    for (const t of here.zombieTypes ?? []) {
      if (t === ZOMBIE_SCREAMER && isRoused(here.zombieState)) continue; // already shrieked above
      if (t === ZOMBIE_STALKER) continue; // handled as the night wrongness below
      const tell = ZOMBIE_TELL[t];
      if (tell) cues.push({ text: `[${tell} — here]`, urgency: 55, proximity: 0.6 });
    }
    // A collective moan only when the node is not already reading a clearer state (no double-statement) and unnamed.
    const moan = walkerMoan(here);
    if (moan && (here.zombieTypes ?? []).length === 0 && !isRoused(here.zombieState) && here.zombieState !== "feeding") {
      cues.push({ text: `[${moan} — here]`, urgency: 32, proximity: 0.3 });
    }
    // The node is loud right now — that pulls things toward you (§6.1). Honest about the *place*, not who made it.
    if (here.noise >= REPATH_NOISE) cues.push({ text: "It's loud here right now — the kind of loud that pulls things toward you.", urgency: 42, proximity: 0.4 });
  }

  // 4. Off-node sound — positioned world-noise spikes and the nearest ambient signatures.
  for (const [id, e] of scan) {
    if (e.hops === 0 || !graph) continue;
    const n = state.nodes[id];
    if (n === undefined) continue;
    // A noise spike, attenuated by distance and masked by weather (§6.1). A gunshot carries; a step does not.
    const heard = n.noise - e.hops * NOISE_ATTEN_PER_HOP - mask;
    if (heard >= NOISE_HEARD_MIN) {
      const label = heard >= 45 ? "a sharp crack of sound" : heard >= 28 ? "a clatter of movement" : "a faint scuff of sound";
      cues.push({ text: locate(label, state, graph, e), urgency: heard >= 45 ? 58 : heard >= 28 ? 44 : 30, proximity: proximityOf(e.hops) * 0.5 });
    }
    // Adjacent ambient signatures — you're basically next to them (a roused special carries one hop further).
    if (hasDead(n)) {
      const carry = e.hops === 1 || (isRoused(n.zombieState) && e.hops <= 2);
      if (carry) {
        for (const t of n.zombieTypes ?? []) {
          if (t === ZOMBIE_SCREAMER || t === ZOMBIE_STALKER) continue; // shriek/wrongness handled elsewhere
          const tell = ZOMBIE_TELL[t];
          if (tell) cues.push({ text: locate(tell, state, graph, e), urgency: 34, proximity: proximityOf(e.hops) * 0.7 });
        }
        const moan = walkerMoan(n);
        if (moan && (n.zombieTypes ?? []).length === 0) cues.push({ text: locate(moan, state, graph, e), urgency: 24, proximity: proximityOf(e.hops) * 0.5 });
      }
    }
  }

  // 5. The Stalker — near-silence and a single displaced sound at night; wrongness in the quiet, not a loud cue (§6.2).
  if (isNight(state)) {
    for (const [id, e] of scan) {
      if (e.hops > 1) continue;
      const n = state.nodes[id];
      if (n && (n.zombieTypes ?? []).includes(ZOMBIE_STALKER)) {
        cues.push({ text: "A single sound, displaced — behind you, and nothing there when you turn.", urgency: 68, proximity: 0.7 });
        break;
      }
    }
  }

  return cues;
}

/**
 * Render the cues to text, **most-urgent first**, capped so a chaotic node stays legible (§2.1). The cap
 * drops the least-urgent *tail* — never a shriek/chase/on-you. Deterministic (stable by urgency, then order).
 */
function renderCues(cues: readonly Cue[]): string[] {
  return cues
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.urgency - a.c.urgency || a.i - b.i)
    .slice(0, 8)
    .map((x) => x.c.text);
}

/** The closest/most-dangerous heard cue (0 when nothing is audible) — the continuous Fear/music read (§4.3). */
function dangerProximity(cues: readonly Cue[]): number {
  return cues.reduce((m, c) => Math.max(m, c.proximity), 0);
}

// ---------------------------------------------------------------------------
// Layer 4 — the player body (AUDIO §6.4 / §9)
// ---------------------------------------------------------------------------

/**
 * Fear, composited (§6.4): the hidden Mind stress (the prototype's Fear proxy) raised by the *real*
 * danger — the nearest audible threat's closeness (a chase, a horde bearing down), an active fight, a
 * horde on your tile, darkness, an untended wound, being surrounded, and the region's ambient dread.
 * A 0–3 band, never the number. A fight is never "steady" (a floor). Kept internal; only the *heartbeat
 * words* it selects are shown. Reads the pre-cap cue set so the Fear read can never be muted by the cap.
 */
function fearBand(state: GameState, cues: readonly Cue[]): number {
  const loc = state.player.location;
  let f = state.player.condition.mind.stress;
  f += Math.round(60 * dangerProximity(cues)); // the nearest threat's real closeness (a chase ≈ +54)
  if (state.combat !== null) f += 35;
  if ((state.hordes ?? []).some((h) => h.pos === loc)) f += 25; // a mass on your own tile
  if (isNight(state)) f += 12;
  else if (state.meta.phase === "evening") f += 6;
  const w = worstWound(state.player.condition);
  if (w && w.treated < 100 && w.severity >= 40) f += 15;
  const here = state.nodes[loc];
  if (here && here.walkers >= 3) f += 8;
  const region = here ? state.regions[here.regionId] : undefined;
  f += Math.round(Math.max(region?.threat ?? 0, state.world.globalThreat) / 10); // ambient dread (0–10)
  if (state.combat !== null) f = Math.max(f, 55); // a fight is at least "heart loud", never steady/mere-pulse
  if (f >= 75) return 3;
  if (f >= 50) return 2;
  if (f >= 27) return 1;
  return 0;
}

const HEARTBEAT: readonly string[] = [
  "Under it all, your own heartbeat — steady.",
  "Your pulse has picked up.",
  "Your heart is loud in your ears.",
  "Your heartbeat slams — you're on the edge of panic.",
];

/**
 * The intimate layer: the heartbeat (always present — the level-0 floor, §6.4), breath from
 * fatigue/wounds, a footstep-surface cost you can hear (§6.1), and the infection distortion by *stage*
 * (§9.2), surfaced fairly (you are told your hearing can't be trusted, never fed a fabricated cue).
 */
function buildBody(state: GameState, cues: readonly Cue[]): string[] {
  const stage = state.player.condition.infection.stage;
  // Terminal strips the world to breath and heart (§9.2) — it *is* the body layer.
  if (stage === "terminal") {
    return ["The world has pulled back to your breath and your heartbeat, and little else."];
  }

  const out: string[] = [HEARTBEAT[fearBand(state, cues)]!];

  const fatigue = state.player.condition.needs.fatigue;
  const wounded = isWounded(state.player.condition);
  if (fatigue >= 60 && wounded) out.push("Your breath comes heavy, and catches on the wound.");
  else if (fatigue >= 60) out.push("Your breath comes heavy.");
  else if (wounded) out.push("Each breath catches on the wound.");

  if (state.world.weather === WEATHER_SNOW && !atOwnShelter(state)) {
    out.push("Your footsteps crunch — loud in the snow, a cost you can hear.");
  }

  if (stage === "symptomatic") out.push("A fever-hum sits under every sound.");
  else if (stage === "advanced") out.push("Sounds swim and double — you can't trust your ears now.");

  return out;
}

// ---------------------------------------------------------------------------
// Layer 5 — music / tone (AUDIO §4 · FR-AUD-01)
// ---------------------------------------------------------------------------

/** The six themes (§4.1) — a derived readout of the Director's moment, never a track name. */
type Tone = "survival" | "exploration" | "danger" | "loss" | "hope" | "home";

/** Word the theme + its 0–4 intensity (§4.2). Level-0 is silence — the caller renders no tone line then. */
const TONE_WORDS: { readonly [t in Tone]: readonly string[] } = {
  // index by intensity 0..4; index 0 is never rendered (silence).
  survival: ["", "A low unease threads the quiet.", "A sustained dread has settled in.", "The dread is driving now.", "It crests — nowhere is safe."],
  exploration: ["", "A thin, curious quiet — room to breathe, for a moment.", "Space, and the pull to look further.", "", ""],
  danger: ["", "The air pulls taut.", "The air has gone taut — this is turning bad.", "Everything's driving now — this is a bad one.", "It all crests — nowhere left to hide."],
  home: ["", "The shelter's own low tone holds — home, for now.", "Home, but the walls feel thin tonight.", "", ""],
  hope: ["", "A warmth you haven't heard in a while.", "Something like hope, holding.", "", ""],
  loss: ["", "Everything falls away to a single held note.", "Everything falls away to a single held note.", "Everything falls away to a single held note.", "Everything falls away to a single held note."],
};

/**
 * Map the Director's read to a theme and an intensity 0–4 (§4.2), then to a mood line. Priority: a loss
 * one-shot, then danger (information wins the mix, §10.2), then home, then exploration/survival. Returns
 * null at level-0 — silence is a state, and the heartbeat carries it (§4.1/§6.4).
 */
function buildTone(state: GameState, cues: readonly Cue[]): string | null {
  const here = state.nodes[state.player.location];
  const region = here ? state.regions[here.regionId] : undefined;
  // Proximity is continuous from the nearest threat (§4.3), with a floor for an active fight.
  const proximity = Math.max(dangerProximity(cues), state.combat !== null ? 0.75 : 0);
  const acute = proximity >= 0.85; // a chase / a horde on you
  const anyThreatHeard = state.combat !== null || cues.some((c) => c.proximity >= 0.4);
  const tension = Math.max(region?.threat ?? 0, state.world.globalThreat) / 100;
  const fear = fearBand(state, cues) / 3;
  const intensity = Math.round(4 * Math.max(proximity, fear, tension));

  let tone: Tone;
  let level: number;
  if (isRunOver(state)) {
    tone = "loss";
    level = 2;
  } else if (state.combat !== null || acute || (anyThreatHeard && fear >= 0.5)) {
    tone = "danger";
    // Reserve L4 (the Last Stand, §4.2) for a threat truly on top of you or a desperate fight; else it builds 2→3.
    const peak = proximity >= 0.95 || (state.combat !== null && fear >= 0.85);
    level = Math.min(peak ? 4 : 3, Math.max(2, intensity));
  } else if (atOwnShelter(state)) {
    tone = "home";
    level = isNight(state) && tension >= 0.5 ? 2 : 1;
  } else if (anyThreatHeard || tension >= 0.3 || fear >= 0.34) {
    tone = "survival";
    level = Math.min(4, Math.max(1, intensity));
  } else if (here !== undefined && here.searchPct < 100) {
    tone = "exploration";
    level = 1;
  } else {
    tone = "survival";
    level = 0; // the quiet holds — no music; the heartbeat is the level-0 track
  }

  const line = TONE_WORDS[tone][Math.min(4, Math.max(0, level))] ?? "";
  return line.length > 0 ? line : null;
}

// ---------------------------------------------------------------------------
// The Audio Director — assemble the mix, and render it as captions
// ---------------------------------------------------------------------------

/**
 * The client-side Audio Director (§13.2): read the Scene state (and, when available, the graph for
 * direction & distance) and produce the five-layer mix. Pure — no writes, no RNG, no clock. `graph` is
 * optional so a pre-graph caller degrades to the node-local bed/body/tone (still deterministic); the
 * interactive clients and the transcript pass it for the full positional read.
 */
export function describeSoundscape(state: GameState, graph?: RegionGraph): Soundscape {
  const cues = buildDynamicCues(state, graph);
  return {
    bed: buildBed(state, graph),
    environmental: buildEnvironmental(state),
    dynamic: renderCues(cues),
    body: buildBody(state, cues),
    tone: buildTone(state, cues),
  };
}

/**
 * The soundscape as sparse text lines — the non-audio equivalent a sound-off player reads (FR-AUD-06).
 * Order: the ambient bed, then any environmental one-shots, then the informational cues, then the body,
 * then the mood line (omitted at level-0). Always ≥ 2 lines (the bed and the heartbeat), so the region
 * is never empty; a quiet, safe turn is just those two — the Golden Rule made literal (§2.1).
 */
export function soundscapeCaptions(state: GameState, graph?: RegionGraph): string[] {
  const s = describeSoundscape(state, graph);
  const lines = [s.bed, ...s.environmental, ...s.dynamic, ...s.body];
  if (s.tone !== null) lines.push(s.tone);
  return lines;
}
