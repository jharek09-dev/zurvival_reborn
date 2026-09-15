# Web client — taking a turn

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

A choice is taken from the keyboard. Written against selectors both the pre-T63 page and the T63 page have, so the same script is evidence before and after. What must hold: the choice button's name carries its cost in words; after Enter, focus is on the NEW scene's heading (the button pressed no longer exists) and Orca speaks one ordered digest ending in the choice count; the scene can then be walked by heading.

### Tab to the second choice

keys: `Tab`

focus → button — "2. Travel to Collapsed Overpass, 2 hours"
- PASS focus matches `#choices > li:nth-child(2) > .choice, #choices > .choice:nth-child(2)`

Orca said:

> 🔊 tab
> 🔊 2. Travel to Collapsed Overpass, 2 hours push button.

- PASS said `Travel to Collapsed Overpass, 2 hours push button`
- PASS never said `1 hours`

### Enter takes it

keys: `Return`

focus → body — "Day 1 · dawn · clear · 08:00 · turn 1\n      \n        New\n   "
- **FAIL** focus matches `#scene-title`

Orca said:

> 🔊 return
> 🔊 (Day 1, dawn 08:00 — at Collapsed Overpass.)
> 🔊 Pack: 12/40.
> 🔊 Zurvival Reborn — Playable Beta - Chromium
> 🔊 Zurvival Reborn — Playable Beta document web.
> 🔊 What you hear WHAT YOU HEARRivermouth District sits in a low, worn quiet. [a few of the dead, shifting and moaning — close, toward Gridlock Bridge] [a few of the dead, shifting and moaning — close, toward Harbor Rail Yard] Under it all, your own heartbeat — steady. A low unease threads the quiet.
> 🔊 What do you do?
> 🔊 The sky is washed and clear. A section of raised highway sheared onto the street below.
> 🔊 Rivermouth District sits in a low, worn quiet.
> 🔊 A low unease threads the quiet.
> 🔊 "Toll's a can of something, or you turn around. Your call, friend."
> 🔊 You feel steady.
> 🔊 [a few of the dead, shifting and moaning — close, toward Gridlock Bridge]
> 🔊 Three of them have the overpass sewn up — a chain across the on-ramp, a burned-out cruiser for cover, a woman with a fire axe doing the talking.
> 🔊 [a few of the dead, shifting and moaning — close, toward Harbor Rail Yard]
> 🔊 Under it all, your own heartbeat — steady.
> 🔊 You can pick a path over the rubble, slowly, in the open — or turn back.

- PASS said `Day 1, dawn 08:00 — at Collapsed Overpass`
- **FAIL** said `/\d+ choices?\./`
- **FAIL** never said `WHAT YOU HEAR`
- PASS never said `What you hear What you hear`
- PASS never said `region Day`

_The scene section was a region named by its own heading in the first T63 build, and Orca then spoke the day, time and place twice on every turn ('region Day 1 …' then the heading); it is no longer a named region._

### Orca H — next heading

keys: `h`

focus → body — "Day 1 · dawn · clear · 08:00 · turn 1\n      \n        New\n   "

Orca said:

> 🔊 h
> 🔊 No more headings.

- **FAIL** said `Your condition heading level 3`

### Orca H

keys: `h`

focus → body — "Day 1 · dawn · clear · 08:00 · turn 1\n      \n        New\n   "

Orca said:

> 🔊 h
> 🔊 No more headings.

- **FAIL** said `What you hear heading level 3`

### Orca H

keys: `h`

focus → body — "Day 1 · dawn · clear · 08:00 · turn 1\n      \n        New\n   "

Orca said:

> 🔊 h
> 🔊 No more headings.

- **FAIL** said `The story heading level 3`

### Orca H

keys: `h`

focus → body — "Day 1 · dawn · clear · 08:00 · turn 1\n      \n        New\n   "

Orca said:

> 🔊 h
> 🔊 No more headings.

- **FAIL** said `What do you do? heading level 2`

### Orca Down — the first choice

keys: `Down`

focus → button#btn-new — "New"

Orca said:

> 🔊 New push button.
> 🔊 Start a new run (N)
> 🔊 Save push button.
> 🔊 Load push button.
> 🔊 Toggle high contrast push button.
> 🔊 Cycle larger text push button.

- PASS said `/list with \d+ items|push button/`

### Orca B — next button

keys: `b`

focus → button#btn-save — "Save"

Orca said:

> 🔊 b
> 🔊 Save push button.
> 🔊 Save this run.

- PASS said `push button`
- PASS never said `1 hours`

---

**7 expectation(s) FAILED.**
