/**
 * The FR-AUD-06 cue-redundancy matrix (M4 task T56 pt 2 · ACCESSIBILITY §10.4/§12 · AUDIO §11).
 *
 * FR-AUD-06 (Must): "a non-audio equivalent for every meaningful sound cue." The T55 soundscape already
 * makes the whole audio mix TEXT — the captions ARE the non-audio channel, and there is no separate audio
 * channel in this client — so the redundancy is *structural*. What this matrix adds is the tracked,
 * enumerated PROOF: every meaningful sound cue **the T55 soundscape emits**, cross-referenced to its AUDIO
 * section, its soundscape layer, and the exact text a sound-off player reads instead. `cueMatrix.test.ts`
 * proves each entry actually SURFACES (not silently dropped) AND — the drift guard — that every line the
 * soundscape produces maps to a `CUE_MATRIX` row (so a new cue can't slip in untracked).
 *
 * Honest scope: this covers what the soundscape produces TODAY. The AUDIO bible names further meaningful
 * cues the soundscape does not yet emit (hearing-damage/tinnitus, radio speech, combat/weapon SFX, Dynamic
 * Audio Memory, the Hope theme) — those are recorded in {@link DEFERRED_CUES} (→ M5), so FR-AUD-06 *tracks*
 * the gap rather than silently omitting it. `renderCueMatrix()` emits both tables to
 * `docs/reference/AUDIO_CUE_MATRIX.md`.
 *
 * Pure data + a pure renderer — no state, no engine touch (the T54/T55 byte-identity-by-construction shape).
 */

/** The five soundscape layers a cue can live in (AUDIO §3). */
export type CueChannel = "bed" | "environmental" | "dynamic" | "body" | "tone";

/** One meaningful sound cue and its non-audio (text) equivalent. */
export interface CueMatrixEntry {
  /** Stable id (used by the acceptance test to key its triggering scenario). */
  readonly id: string;
  /** The SOUND itself — what a hearing player would hear. */
  readonly sound: string;
  /** AUDIO-bible section reference. */
  readonly audioRef: string;
  /** Which soundscape layer produces the text equivalent. */
  readonly channel: CueChannel;
  /** A distinctive fragment of the text caption a sound-off player reads (the non-audio equivalent). */
  readonly text: string;
  /**
   * Extra caption fragments the SAME cue emits at other intensities / counts / loudnesses (e.g. a noise
   * spike's clatter-vs-crack, a moan by count, a theme's higher levels). Not shown in the doc table (the
   * representative `text` is); used by the drift guard so every line the soundscape can emit is tracked.
   */
  readonly alt?: readonly string[];
}

/**
 * Every meaningful sound cue → its text equivalent. Grouped by layer; each `text` is a verbatim fragment of
 * what `soundscapeCaptions` emits when the cue fires (the acceptance test asserts exactly that).
 */
export const CUE_MATRIX: readonly CueMatrixEntry[] = [
  // --- Layer 1: ambient bed (AUDIO §5) — region identity, phase, threat, weather masks, shelter, grid ---
  { id: "bed.day", sound: "the low room-tone of a district by day", audioRef: "§5", channel: "bed", text: "a low, worn quiet" },
  { id: "bed.evening", sound: "the light going, the ambient tone thickening", audioRef: "§5", channel: "bed", text: "the light going, the quiet thickening" },
  { id: "bed.night", sound: "the wrong hush of late night", audioRef: "§5", channel: "bed", text: "the late-night hush, and it feels wrong" },
  { id: "bed.onEdge", sound: "the bed darkening as the district's danger rises", audioRef: "§5", channel: "bed", text: "something in it on edge" },
  { id: "bed.shelterDay", sound: "the close room-tone inside your own walls", audioRef: "§5.4/§8", channel: "bed", text: "the room tone is close and familiar" },
  { id: "bed.shelterNight", sound: "the shelter's signed night-tone", audioRef: "§5.4/§8", channel: "bed", text: "the shelter's night-tone holds" },
  { id: "bed.rain", sound: "rain on the roofs masking other sound", audioRef: "§5.3", channel: "bed", text: "rain steady on the roofs, blurring everything else" },
  { id: "bed.storm", sound: "a storm swallowing the soundscape", audioRef: "§5.3", channel: "bed", text: "the storm swallowing the world" },
  { id: "bed.fog", sound: "fog muffling and closing in the sound", audioRef: "§5.3", channel: "bed", text: "fog closing it all in, muffled and near" },
  { id: "bed.snow", sound: "the high hush of snowfall", audioRef: "§5.3", channel: "bed", text: "a high, hushed stillness over the snow" },
  { id: "bed.wind", sound: "gusting wind hiding intermittent sound", audioRef: "§5.3", channel: "bed", text: "the wind gusting and falling" },
  { id: "bed.powerOut", sound: "the absence of the mains hum after a grid failure", audioRef: "§5/§6.7", channel: "bed", text: "no hum of power anywhere" },

  // --- Layer 2: environmental one-shots (AUDIO §6.7) — positioned, node-state driven ---
  { id: "env.fire", sound: "the crackle of a nearby fire", audioRef: "§6.7", channel: "environmental", text: "the crackle and pop of a fire" },
  { id: "env.corpses", sound: "flies droning over the dead", audioRef: "§6.7", channel: "environmental", text: "the drone of flies over the dead here" },
  { id: "env.barricades", sound: "your barricades ticking as they settle", audioRef: "§6.7", channel: "environmental", text: "your barricades ticking and settling" },
  { id: "env.damage", sound: "a damaged building groaning on its frame", audioRef: "§6.7", channel: "environmental", text: "the building groaning on a broken frame" },

  // --- Layer 3: the informational layer (AUDIO §6.1/§6.2 · FR-AUD-02) ---
  { id: "dyn.screamer", sound: "a Screamer's shriek rousing the whole area", audioRef: "§6.2/§8", channel: "dynamic", text: "the whole area just woke" },
  { id: "dyn.hordeOnYou", sound: "a horde's collective roar right on your tile", audioRef: "§6.2", channel: "dynamic", text: "the dead are on you" },
  { id: "dyn.hordeDistant", sound: "a horde's collective bed, located and sized by distance", audioRef: "§6.2", channel: "dynamic", text: "of the dead, moving" },
  { id: "dyn.chasing", sound: "the sound of something here turning to a chase", audioRef: "§6.2", channel: "dynamic", text: "the sound tightens" },
  { id: "dyn.investigating", sound: "a sound here turning toward you", audioRef: "§6.2", channel: "dynamic", text: "has turned toward you" },
  { id: "dyn.feeding", sound: "the wet sounds of the dead feeding", audioRef: "§6.2", channel: "dynamic", text: "the wet sounds of feeding" },
  { id: "dyn.tell.walker", sound: "the slow wet drag of a Walker", audioRef: "§6.2", channel: "dynamic", text: "the slow, wet drag of walkers" },
  { id: "dyn.tell.fresh", sound: "a Fresh one's ragged sprint", audioRef: "§6.2", channel: "dynamic", text: "a ragged, sprinting breath" },
  { id: "dyn.tell.crawler", sound: "a Crawler's nails on concrete, low and below", audioRef: "§6.2", channel: "dynamic", text: "a low scrape of nails on concrete" },
  { id: "dyn.tell.bloated", sound: "a Bloated one's straining gurgle", audioRef: "§6.2", channel: "dynamic", text: "a wet, straining gurgle" },
  { id: "dyn.tell.riot", sound: "the clank of a Riot one's armour", audioRef: "§6.2", channel: "dynamic", text: "the clank of armour" },
  { id: "dyn.tell.screamerLatent", sound: "a Screamer's building rasp before it screams", audioRef: "§6.2", channel: "dynamic", text: "a screamer not screaming yet" },
  { id: "dyn.stalkerNight", sound: "a Stalker's single displaced sound in the night quiet", audioRef: "§6.2", channel: "dynamic", text: "A single sound, displaced" },
  { id: "dyn.walkerMoan", sound: "the collective moan of loitering dead", audioRef: "§6.2", channel: "dynamic", text: "moaning", alt: ["one of the dead, shifting"] },
  { id: "dyn.nodeLoud", sound: "the node ringing loud, pulling things toward you", audioRef: "§6.1", channel: "dynamic", text: "It's loud here right now" },
  { id: "dyn.noiseSpike", sound: "a positioned world-noise spike (a shot, a clatter) by direction & distance", audioRef: "§6.1", channel: "dynamic", text: "a sharp crack of sound", alt: ["a clatter of movement", "a faint scuff of sound"] },

  // --- Layer 4: the player body (AUDIO §6.4/§9) ---
  { id: "body.heartbeat0", sound: "a steady heartbeat under it all (calm — Fear band 0)", audioRef: "§6.4", channel: "body", text: "your own heartbeat — steady" },
  { id: "body.heartbeat1", sound: "the pulse picking up (Fear band 1)", audioRef: "§6.4", channel: "body", text: "Your pulse has picked up" },
  { id: "body.heartbeat2", sound: "the heart loud in the ears (Fear band 2)", audioRef: "§6.4", channel: "body", text: "Your heart is loud in your ears" },
  { id: "body.heartbeat3", sound: "the heartbeat slamming, on the edge of panic (Fear band 3)", audioRef: "§6.4", channel: "body", text: "Your heartbeat slams" },
  { id: "body.breath", sound: "heavy breath from fatigue/wounds", audioRef: "§6.4", channel: "body", text: "Your breath comes heavy" },
  { id: "body.breathWound", sound: "the breath catching on a wound", audioRef: "§6.4", channel: "body", text: "catches on the wound" },
  { id: "body.footstepsSnow", sound: "your own footsteps crunching loud in snow (a Safety cost you can hear)", audioRef: "§6.1", channel: "body", text: "Your footsteps crunch" },
  { id: "body.infectSymptomatic", sound: "the fever-hum under every sound (symptomatic)", audioRef: "§9.2", channel: "body", text: "A fever-hum sits under every sound" },
  { id: "body.infectAdvanced", sound: "sound swimming and doubling — hearing no longer trustworthy (advanced)", audioRef: "§9.2", channel: "body", text: "you can't trust your ears now" },
  { id: "body.infectTerminal", sound: "the world stripped to breath and heart (terminal)", audioRef: "§9.2", channel: "body", text: "pulled back to your breath and your heartbeat" },

  // --- Layer 5: music / tone (AUDIO §4 · FR-AUD-01) — a mood word + intensity; level-0 is silence ---
  { id: "tone.survival", sound: "the survival theme (dread building)", audioRef: "§4", channel: "tone", text: "A low unease threads the quiet", alt: ["A sustained dread has settled in", "The dread is driving now", "It crests — nowhere is safe"] },
  { id: "tone.exploration", sound: "the exploration theme (room to breathe)", audioRef: "§4", channel: "tone", text: "room to breathe" },
  { id: "tone.danger", sound: "the danger theme, driving under a chase", audioRef: "§4", channel: "tone", text: "Everything's driving now", alt: ["nowhere left to hide"] },
  { id: "tone.home", sound: "the home theme inside your shelter", audioRef: "§4", channel: "tone", text: "home, for now", alt: ["the walls feel thin tonight"] },
  { id: "tone.loss", sound: "the loss one-shot when the run ends", audioRef: "§4", channel: "tone", text: "a single held note" },
  { id: "tone.silence", sound: "authored silence at level-0 (no music; the heartbeat is the level-0 track)", audioRef: "§4.1/§6.4", channel: "tone", text: "(no tone line — the heartbeat carries the silence)" },
];

/** A meaningful AUDIO-bible cue the soundscape does NOT yet emit — tracked so the gap is recorded, not implied away. */
export interface DeferredCue {
  readonly id: string;
  readonly sound: string;
  readonly audioRef: string;
  /** Why it isn't emitted yet / where it's tracked. */
  readonly why: string;
}

/**
 * Cues the AUDIO bible names as meaningful but the T55 soundscape does not yet produce. FR-AUD-06 requires a
 * text equivalent for every *emitted* cue (all in `CUE_MATRIX`); these are recorded so the requirement TRACKS
 * the remaining gap rather than silently omitting it. Each earns a caption when its underlying system lands.
 */
export const DEFERRED_CUES: readonly DeferredCue[] = [
  { id: "def.hearingDamage", sound: "hearing-damage / tinnitus — a close blast drops the world into muffle + ring, deaf to threat cues", audioRef: "§6.4", why: "a PLAYED perception mechanic (it changes what the player can hear) → an engine concern, not this pure-presentation pass; its visual equivalent lands with it (PL-M4-52)" },
  { id: "def.radioSpeech", sound: "diegetic radio speech / a voice going silent mid-sentence", audioRef: "§6.6/§11", why: "needs speech subtitles/captions; the soundscape notes a station gone dark but not spoken words (PL-M4-50)" },
  { id: "def.combatSfx", sound: "combat / weapon SFX — a shot's crack + tail, a dry-fire click, a dropped-weapon clatter", audioRef: "§6.3", why: "a combat-audio pass; the informational noise spike carries a shot's POSITION, not its weapon texture" },
  { id: "def.dynamicMemory", sound: "Dynamic Audio Memory — a formative event's cue returning on a Quiet Screen / in a dream", audioRef: "§8", why: "needs the FR-UI-06 Quiet Screen + a presentation-memory store (PL-M4-49)" },
  { id: "def.hopeTheme", sound: "the Hope theme (rescue / cure / relief)", audioRef: "§4.1", why: "authored in the tone table but buildTone never selects it — needs a rescue/cure/radio event to drive it (M5 wiring)" },
  { id: "def.extraOneShots", sound: "further environmental one-shots — a dripping pipe, a gas hiss, a car alarm, thunder (some double as gameplay)", audioRef: "§6.7", why: "the soundscape emits the state-driven set (fire / the dead / barricades / dead grid); the rest are content-authoring polish" },
];

/** The layers, in render order — used by the completeness guard and the rendered table. */
export const CUE_CHANNELS: readonly CueChannel[] = ["bed", "environmental", "dynamic", "body", "tone"];

const CHANNEL_TITLE: { readonly [c in CueChannel]: string } = {
  bed: "Ambient bed (§5)",
  environmental: "Environmental one-shots (§6.7)",
  dynamic: "Informational layer (§6.1/§6.2 · FR-AUD-02)",
  body: "Player body (§6.4/§9)",
  tone: "Music / tone (§4 · FR-AUD-01)",
};

/**
 * Render the matrix as a Markdown document (`docs/reference/AUDIO_CUE_MATRIX.md`). Pure — deterministic for a
 * given `CUE_MATRIX`, so it can be regenerated and diffed. Grouped by layer, one row per cue: the sound, its
 * AUDIO reference, and the text a sound-off player reads instead.
 */
export function renderCueMatrix(): string {
  const lines: string[] = [
    "# FR-AUD-06 — Cue-redundancy matrix",
    "",
    "**Every meaningful sound cue has a non-audio (text) equivalent (FR-AUD-06, Must).** In this text client",
    "the captions ARE the only channel — there is no separate audio track — so a sound-off (deaf / hard-of-",
    "hearing) player reads exactly what a hearing player hears. This matrix is the tracked proof: each row is",
    "a meaningful sound from the AUDIO bible, cross-referenced to its section and the soundscape layer, with the",
    "text caption that carries it. Generated from `prototype/harness/src/cueMatrix.ts`; every row is asserted to",
    "actually surface by `prototype/harness/test/cueMatrix.test.ts`.",
    "",
    `**${CUE_MATRIX.length} cues** across the five adaptively-mixed layers (AUDIO §3).`,
    "",
  ];
  for (const channel of CUE_CHANNELS) {
    const rows = CUE_MATRIX.filter((c) => c.channel === channel);
    lines.push(`## ${CHANNEL_TITLE[channel]}`, "");
    lines.push("| Sound cue | AUDIO ref | Non-audio (text) equivalent |");
    lines.push("| --- | --- | --- |");
    for (const c of rows) {
      lines.push(`| ${c.sound} | ${c.audioRef} | ${c.text.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }
  lines.push("*A sound-off player is never at a mechanical disadvantage: threat direction, distance, and type all", "arrive in the text (FR-AUD-02), and no cue rides on audio alone (FR-AUD-06 · NFR-ACC-01).*", "");
  lines.push(
    "## Deferred — named in the AUDIO bible, not yet emitted by the soundscape (→ M5)",
    "",
    "Tracked so FR-AUD-06 records the remaining gap rather than implying none. Each earns its text equivalent",
    "when the underlying system lands.",
    "",
    "| Sound cue | AUDIO ref | Why deferred |",
    "| --- | --- | --- |",
  );
  for (const d of DEFERRED_CUES) lines.push(`| ${d.sound} | ${d.audioRef} | ${d.why} |`);
  lines.push("");
  return lines.join("\n");
}
