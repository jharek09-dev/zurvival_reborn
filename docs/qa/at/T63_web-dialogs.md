# Web client — depth screens and dialogs

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

A depth screen is opened, read, tabbed and closed; then a second one. What must hold: EVERY dialog is announced as a dialog on open (in the first T63 build only the first dialog a page opened was — see the note on step 'Enter on Codex'), its content reads as a heading, sub-headings and lists, Tab never leaves it, Escape closes it with focus back on the button that opened it, and closing re-reads NOTHING from the page behind. Orca does not repeat the dialog's NAME on open because the button just pressed carries the same name ('has same name as priorObj' in its log) — the description is spoken instead.

### Enter on Companions

keys: `Return`

focus → button — "Close"
- PASS focus matches `#modal-root dialog .head button`

Orca said:

> 🔊 return
> 🔊 dialog the people with you — condition, trust, orders
> 🔊 Close push button.

- PASS said `dialog the people with you — condition, trust, orders`
- PASS said `Close push button`

### Orca Down — read on

keys: `Down`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 Companions heading level 2.

- PASS said `Companions heading level 2`

### Orca Down

keys: `Down`

focus → dialog — "CloseCompanionsthe people with you — condition, trust, order"

Orca said:

> 🔊 the people with you — condition, trust, orders.
> 🔊 Companions the people with you — condition, trust, orders 0 with you · 0 at home · 0/3 in your party. You travel alone. Survivors you meet can be recruited once you have earned their trust — talk, share, keep your word. Press Escape or Close to return to the story. Opening a screen spends no time. clickable.
> 🔊 the people with you — condition, trust, orders.

- PASS said `the people with you`

### Orca Down

keys: `Down`

focus → dialog — "CloseCompanionsthe people with you — condition, trust, order"

Orca said:

> 🔊 the people with you — condition, trust, orders.

- PASS said `with you`

### Tab

keys: `Tab`

focus → button — "Close"
- PASS focus matches `#modal-root dialog *`

Orca said:

> 🔊 tab
> 🔊 Close push button.


### Shift+Tab

keys: `shift+Tab`

focus → button — "Close"
- PASS focus matches `#modal-root dialog *`

Orca said:

> 🔊 left shift


### Escape closes; focus returns

keys: `Escape`

focus → button — "C Companions"
- PASS focus matches `[data-screen=companions]`

Orca said:

> 🔊 escape
> 🔊 navigation Depth screens
> 🔊 Companions push button.

- PASS said `Companions push button`
- PASS never said `You hear:`
- PASS never said `choices.`

### Enter on Codex — the SECOND dialog is announced too

keys: `Return`

focus → button — "Close"
- PASS focus matches `#modal-root dialog .head button`

Orca said:

> 🔊 return
> 🔊 dialog lore, the radio, rumors, and the memorial
> 🔊 Close push button.

- PASS said `dialog lore, the radio, rumors, and the memorial`
- PASS said `Close push button`

_Before the Close button was moved ahead of the heading in DOM order, Chromium placed its text caret in the dialog's heading before firing focus; Orca took the caret as the locus, found the Close button inside the same dialog, and announced no dialog at all._

### Orca H — the dialog's title

keys: `h`

focus → body — "Skip to the scene\nSkip to your choices\n\n  \n    \n      Zurviv"

Orca said:

> 🔊 h
> 🔊 Codex dialog lore, the radio, rumors, and the memorial
> 🔊 Codex heading level 2.

- PASS said `Codex heading level 2`

### Orca H — first section

keys: `h`

focus → dialog — "CloseCodexlore, the radio, rumors, and the memorialThe story"

Orca said:

> 🔊 h
> 🔊 Codex dialog lore, the radio, rumors, and the memorial
> 🔊 This run heading level 3.
> 🔊 Codex lore, the radio, rumors, and the memorial The story you uncover, and the people you couldn't keep. This run • Survivor — The intended balance — always a little short; every trip out costs more than it pays. Lore (nothing yet) Radio You have no working radio — the airwaves are silent to you. Rumors (nothing yet) Memorial (nothing yet) Fragments accumulate here as you play — they are the record the next run can inherit. Press Escape or Close to return to the story. Opening a screen spends no time. clickable.
> 🔊 lore, the radio, rumors, and the memorial.

- PASS said `heading level 3`

### Orca L — next list

keys: `l`

focus → dialog — "CloseCodexlore, the radio, rumors, and the memorialThe story"

Orca said:

> 🔊 l
> 🔊 List with 1 item
> 🔊 Codex dialog lore, the radio, rumors, and the memorial
> 🔊 List with 1 item.
> 🔊 • Survivor — The intended balance — always a little short; every trip out costs more than it pays.

- PASS said `/list with \d+ items?/i`

### Escape

keys: `Escape`

focus → button — "L Codex"
- PASS focus matches `[data-screen=codex]`

Orca said:

> 🔊 escape
> 🔊 leaving list.
> 🔊 navigation Depth screens
> 🔊 Codex push button.

- PASS said `Codex push button`
- PASS never said `You hear:`
- PASS never said `choices.`

---

**All expectations held.**
