# Web client — taking a turn

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

A choice is taken from the keyboard. Written against selectors both the pre-T63 page and the T63 page have, so the same script is evidence before and after. What must hold: the choice button's name carries its cost in words; after Enter, focus is on the NEW scene's heading (the button pressed no longer exists) and Orca speaks one ordered digest ending in the choice count; the scene can then be walked by heading.

### Tab to the second choice

keys: `Tab`

focus → button[data-choice=2] — "Travel to Collapsed Overpass, 2 hours"
- PASS focus matches `#choices > li:nth-child(2) > .choice, #choices > .choice:nth-child(2)`

Orca said:

> 🔊 tab
> 🔊 Travel to Collapsed Overpass, 2 hours push button.

- PASS said `Travel to Collapsed Overpass, 2 hours push button`
- PASS never said `1 hours`

### Enter takes it

keys: `Return`

focus → h2#scene-title — "Day 1, dawn 08:00 — at Collapsed Overpass"
- PASS focus matches `#scene-title`

Orca said:

> 🔊 return
> 🔊 leaving region.
> 🔊 Day 1, dawn 08:00 — at Collapsed Overpass heading level 2 clickable.
> 🔊 You hear: [a few of the dead, shifting and moaning — close, toward Gridlock Bridge] [a few of the dead, shifting and moaning — close, toward Harbor Rail Yard] Three of them have the overpass sewn up — a chain across the on-ramp, a burned-out cruiser for cover, a woman with a fire axe doing the talking. "Toll's a can of something, or you turn around. Your call, friend." The sky is washed and clear. A section of raised highway sheared onto the street below. You can pick a path over the rubble, slowly, in the open — or turn back. 2 choices.

- PASS said `Day 1, dawn 08:00 — at Collapsed Overpass`
- PASS said `/\d+ choices?\./`
- PASS never said `WHAT YOU HEAR`
- PASS never said `What you hear What you hear`
- PASS never said `region Day`

_The scene section was a region named by its own heading in the first T63 build, and Orca then spoke the day, time and place twice on every turn ('region Day 1 …' then the heading); it is no longer a named region._

### Orca H — next heading

keys: `h`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 h
> 🔊 Your condition heading level 3.

- PASS said `Your condition heading level 3`

### Orca H

keys: `h`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 h
> 🔊 What you hear heading level 3.

- PASS said `What you hear heading level 3`

### Orca H

keys: `h`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 h
> 🔊 The story heading level 3.

- PASS said `The story heading level 3`

### Orca H

keys: `h`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 h
> 🔊 What do you do? heading level 2.

- PASS said `What do you do? heading level 2`

### Orca Down — the first choice

keys: `Down`

focus → button[data-choice=1] — "Bluff — tell them your people are right behind you, 1 hour"

Orca said:

> 🔊 List with 2 items.
> 🔊 Bluff — tell them your people are right behind you, 1 hour push button.

- PASS said `/list with \d+ items|push button/`

### Orca B — next button

keys: `b`

focus → button[data-choice=2] — "Refuse and stand your ground, 1 hour"

Orca said:

> 🔊 b
> 🔊 Refuse and stand your ground, 1 hour push button.

- PASS said `push button`
- PASS never said `1 hours`

---

**All expectations held.**
