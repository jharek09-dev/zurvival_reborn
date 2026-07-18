# FR-AUD-06 — Cue-redundancy matrix

**Every meaningful sound cue has a non-audio (text) equivalent (FR-AUD-06, Must).** In this text client
the captions ARE the only channel — there is no separate audio track — so a sound-off (deaf / hard-of-
hearing) player reads exactly what a hearing player hears. This matrix is the tracked proof: each row is
a meaningful sound from the AUDIO bible, cross-referenced to its section and the soundscape layer, with the
text caption that carries it. Generated from `prototype/harness/src/cueMatrix.ts`; every row is asserted to
actually surface by `prototype/harness/test/cueMatrix.test.ts`.

**48 cues** across the five adaptively-mixed layers (AUDIO §3).

## Ambient bed (§5)

| Sound cue | AUDIO ref | Non-audio (text) equivalent |
| --- | --- | --- |
| the low room-tone of a district by day | §5 | a low, worn quiet |
| the light going, the ambient tone thickening | §5 | the light going, the quiet thickening |
| the wrong hush of late night | §5 | the late-night hush, and it feels wrong |
| the bed darkening as the district's danger rises | §5 | something in it on edge |
| the close room-tone inside your own walls | §5.4/§8 | the room tone is close and familiar |
| the shelter's signed night-tone | §5.4/§8 | the shelter's night-tone holds |
| rain on the roofs masking other sound | §5.3 | rain steady on the roofs, blurring everything else |
| a storm swallowing the soundscape | §5.3 | the storm swallowing the world |
| fog muffling and closing in the sound | §5.3 | fog closing it all in, muffled and near |
| the high hush of snowfall | §5.3 | a high, hushed stillness over the snow |
| gusting wind hiding intermittent sound | §5.3 | the wind gusting and falling |
| the absence of the mains hum after a grid failure | §5/§6.7 | no hum of power anywhere |

## Environmental one-shots (§6.7)

| Sound cue | AUDIO ref | Non-audio (text) equivalent |
| --- | --- | --- |
| the crackle of a nearby fire | §6.7 | the crackle and pop of a fire |
| flies droning over the dead | §6.7 | the drone of flies over the dead here |
| your barricades ticking as they settle | §6.7 | your barricades ticking and settling |
| a damaged building groaning on its frame | §6.7 | the building groaning on a broken frame |

## Informational layer (§6.1/§6.2 · FR-AUD-02)

| Sound cue | AUDIO ref | Non-audio (text) equivalent |
| --- | --- | --- |
| a Screamer's shriek rousing the whole area | §6.2/§8 | the whole area just woke |
| a horde's collective roar right on your tile | §6.2 | the dead are on you |
| a horde's collective bed, located and sized by distance | §6.2 | of the dead, moving |
| the sound of something here turning to a chase | §6.2 | the sound tightens |
| a sound here turning toward you | §6.2 | has turned toward you |
| the wet sounds of the dead feeding | §6.2 | the wet sounds of feeding |
| the slow wet drag of a Walker | §6.2 | the slow, wet drag of walkers |
| a Fresh one's ragged sprint | §6.2 | a ragged, sprinting breath |
| a Crawler's nails on concrete, low and below | §6.2 | a low scrape of nails on concrete |
| a Bloated one's straining gurgle | §6.2 | a wet, straining gurgle |
| the clank of a Riot one's armour | §6.2 | the clank of armour |
| a Screamer's building rasp before it screams | §6.2 | a screamer not screaming yet |
| a Stalker's single displaced sound in the night quiet | §6.2 | A single sound, displaced |
| the collective moan of loitering dead | §6.2 | moaning |
| the node ringing loud, pulling things toward you | §6.1 | It's loud here right now |
| a positioned world-noise spike (a shot, a clatter) by direction & distance | §6.1 | a sharp crack of sound |

## Player body (§6.4/§9)

| Sound cue | AUDIO ref | Non-audio (text) equivalent |
| --- | --- | --- |
| a steady heartbeat under it all (calm — Fear band 0) | §6.4 | your own heartbeat — steady |
| the pulse picking up (Fear band 1) | §6.4 | Your pulse has picked up |
| the heart loud in the ears (Fear band 2) | §6.4 | Your heart is loud in your ears |
| the heartbeat slamming, on the edge of panic (Fear band 3) | §6.4 | Your heartbeat slams |
| heavy breath from fatigue/wounds | §6.4 | Your breath comes heavy |
| the breath catching on a wound | §6.4 | catches on the wound |
| your own footsteps crunching loud in snow (a Safety cost you can hear) | §6.1 | Your footsteps crunch |
| the fever-hum under every sound (symptomatic) | §9.2 | A fever-hum sits under every sound |
| sound swimming and doubling — hearing no longer trustworthy (advanced) | §9.2 | you can't trust your ears now |
| the world stripped to breath and heart (terminal) | §9.2 | pulled back to your breath and your heartbeat |

## Music / tone (§4 · FR-AUD-01)

| Sound cue | AUDIO ref | Non-audio (text) equivalent |
| --- | --- | --- |
| the survival theme (dread building) | §4 | A low unease threads the quiet |
| the exploration theme (room to breathe) | §4 | room to breathe |
| the danger theme, driving under a chase | §4 | Everything's driving now |
| the home theme inside your shelter | §4 | home, for now |
| the loss one-shot when the run ends | §4 | a single held note |
| authored silence at level-0 (no music; the heartbeat is the level-0 track) | §4.1/§6.4 | (no tone line — the heartbeat carries the silence) |

*A sound-off player is never at a mechanical disadvantage: threat direction, distance, and type all
arrive in the text (FR-AUD-02), and no cue rides on audio alone (FR-AUD-06 · NFR-ACC-01).*

## Deferred — named in the AUDIO bible, not yet emitted by the soundscape (→ M5)

Tracked so FR-AUD-06 records the remaining gap rather than implying none. Each earns its text equivalent
when the underlying system lands.

| Sound cue | AUDIO ref | Why deferred |
| --- | --- | --- |
| hearing-damage / tinnitus — a close blast drops the world into muffle + ring, deaf to threat cues | §6.4 | a PLAYED perception mechanic (it changes what the player can hear) → an engine concern, not this pure-presentation pass; its visual equivalent lands with it (PL-M4-52) |
| diegetic radio speech / a voice going silent mid-sentence | §6.6/§11 | needs speech subtitles/captions; the soundscape notes a station gone dark but not spoken words (PL-M4-50) |
| combat / weapon SFX — a shot's crack + tail, a dry-fire click, a dropped-weapon clatter | §6.3 | a combat-audio pass; the informational noise spike carries a shot's POSITION, not its weapon texture |
| Dynamic Audio Memory — a formative event's cue returning on a Quiet Screen / in a dream | §8 | needs the FR-UI-06 Quiet Screen + a presentation-memory store (PL-M4-49) |
| the Hope theme (rescue / cure / relief) | §4.1 | authored in the tone table but buildTone never selects it — needs a rescue/cure/radio event to drive it (M5 wiring) |
| further environmental one-shots — a dripping pipe, a gas hiss, a car alarm, thunder (some double as gameplay) | §6.7 | the soundscape emits the state-driven set (fire / the dead / barricades / dead grid); the rest are content-authoring polish |
