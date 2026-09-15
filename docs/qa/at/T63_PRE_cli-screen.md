# Terminal client — a turn and a depth screen

Screen reader: Orca (46.1) · client: terminal client in xfce4-terminal (VTE) · 2026-09-15

The terminal client under Orca in a VTE terminal; runs unchanged on the pre-T63 client. What must hold: a turn is spoken in reading order; opening a depth screen speaks the whole screen, title line first, and then STOPS (before T63 the title line was dropped and the whole scene ran straight on after the screen); a bare Enter returns to the story.

### launch

keys: `—`

Orca said:

> 🔊 
> 
> 🔊 Day 1 · dawn · clear · 06:00 · turn 0
> You feel steady.
> Pack: 12/40.
> Rivermouth District sits in a low, worn quiet.
> Under it all, your own heartbeat — steady.
> A low unease threads the quiet.
> (Day 1, dawn 06:00 — at Transit Plaza.)
> The sky is washed and clear. A cracked bus concourse open to the sky.
> Dead departure boards, a jackknifed coach, and two streets leading off into the haze.
> What do you do?
> 1. Travel to Corner Store  (2h)
> 2. Travel to Collapsed Overpass  (2h)
> 3. Search Transit Plaza  (1h)
> 4. Scout the surrounding blocks  (1h)
> 5. Note on the map: "worth another look"  (free)
> 6. Rest and recover  (4h)
> [choice number · screens: I inventory · C companions · B shelter · M map & journal · L codex · S save · Q quit]
> > 

- PASS said `What do you do?`
- PASS said `Travel to Corner Store`

### type 2, Enter

keys: `type "2" Return`

Orca said:

> 🔊 2
> 🔊 return
> 🔊 Day 1 · dawn · clear · 08:00 · turn 1
> You feel steady.
> Pack: 12/40.
> Rivermouth District sits in a low, worn quiet.
> [a few of the dead, shifting and moaning — close, toward Gridlock Bridge]
> [a few of the dead, shifting and moaning — close, toward Harbor Rail Yard]
> Under it all, your own heartbeat — steady.
> A low unease threads the quiet.
> (Day 1, dawn 08:00 — at Collapsed Overpass.)
> Three of them have the overpass sewn up — a chain across the on-ramp, a burned-out cruiser for cover, a woman with a fire axe doing the talking.
> "Toll's a can of something, or you turn around. Your call, friend."
> The sky is washed and clear. A section of raised highway sheared onto the street below.
> You can pick a path over the rubble, slowly, in the open — or turn back.
> What do you do?
> 1. Bluff — tell them your people are right behind you  (1h)
> 2. Refuse and stand your ground  (1h)
> [choice number · screens: I inventory · C companions · B shelter · M map & journal · L codex · S save · Q quit]
> > 

- PASS said `at Collapsed Overpass`
- PASS said `What do you do?`

### type I, Enter — the inventory

keys: `type "I" Return`

Orca said:

> 🔊 left shift
> 🔊 return
> 🔊 Pack: 12/40 weight — room to spare.
> Food & water:
> - water ×2  (6 wt)
> - canned food ×2  (6 wt)
> There is no level here — a better tool and a full pack are the only progress.
> Equip · use · drop appear in your choices when you're standing still.
> [any other key returns to the story]
> Day 1 · dawn · clear · 08:00 · turn 1
> You feel steady.
> Pack: 12/40.
> Rivermouth District sits in a low, worn quiet.
> [a few of the dead, shifting and moaning — close, toward Gridlock Bridge]
> [a few of the dead, shifting and moaning — close, toward Harbor Rail Yard]
> Under it all, your own heartbeat — steady.
> A low unease threads the quiet.
> (Day 1, dawn 08:00 — at Collapsed Overpass.)
> Three of them have the overpass sewn up — a chain across the on-ramp, a burned-out cruiser for cover, a woman with a fire axe doing the talking.
> "Toll's a can of something, or you turn around. Your call, friend."
> The sky is washed and clear. A section of raised highway sheared onto the street below.
> You can pick a path over the rubble, slowly, in the open — or turn back.
> What do you do?
> 1. Bluff — tell them your people are right behind you  (1h)
> 2. Refuse and stand your ground  (1h)
> [choice number · screens: I inventory · C companions · B shelter · M map & journal · L codex · S save · Q quit]
> > 

- **FAIL** said `— Inventory — your pack`
- PASS said `Pack: 12/40 weight`
- **FAIL** said `Enter returns to the story`
- **FAIL** never said `What do you do?`

### Enter — back to the story

keys: `Return`

Orca said:

> 🔊 return
> 🔊 
> (type a number 1–2, a screen key (I/C/B/M/L), S, or Q)
> > 

- **FAIL** said `What do you do?`
- **FAIL** never said `type a number`

---

**5 expectation(s) FAILED.**
