# Web client — a dialog keeps the keyboard (runs unchanged on the pre-T63 page)

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

Written against selectors both the pre-T63 page and the T63 page have, so the SAME script is evidence before and after: open the Companions screen from the depth-screen bar, read on with the browse cursor, Tab three times, press Escape. What must hold: the dialog is announced; after reading on with Down, Tab still lands inside the dialog; Escape closes it and focus is back on the button that opened it.

### Enter on Companions

keys: `Return`

focus → button — "Close"

Orca said:

> 🔊 return
> 🔊 dialog
> 🔊 Close push button.

- PASS said `dialog`
- PASS said `Close push button`

### Orca Down

keys: `Down`

focus → body — "Day 1 · dawn · clear · 06:00 · turn 0\n      \n        New\n   "

Orca said:

> 🔊 — Companions — the people with you — condition, trust, orders
> 


### Orca Down

keys: `Down`

focus → body — "Day 1 · dawn · clear · 06:00 · turn 0\n      \n        New\n   "

Orca said:

> 🔊 blank.


### Tab

keys: `Tab`

focus → button#btn-new — "New"
- **FAIL** focus matches `dialog *, [role=dialog] *`

Orca said:

> 🔊 tab
> 🔊 banner
> 🔊 New push button.
> 🔊 Start a new run (N)


### Tab

keys: `Tab`

focus → button#btn-save — "Save"
- **FAIL** focus matches `dialog *, [role=dialog] *`

Orca said:

> 🔊 tab
> 🔊 Save push button.
> 🔊 Save this run.


### Tab

keys: `Tab`

focus → button#btn-load — "Load"
- **FAIL** focus matches `dialog *, [role=dialog] *`

Orca said:

> 🔊 tab
> 🔊 Load push button.
> 🔊 Load a saved run.

- PASS never said `Address and search bar`
- PASS never said `Skip to`

### Escape

keys: `Escape`

focus → button — "C Companions"
- PASS focus matches `#screens button:nth-child(2)`

Orca said:

> 🔊 escape
> 🔊 leaving banner.
> 🔊 navigation Depth screens
> 🔊 Companions push button.
> 🔊 the people with you — condition, trust, orders.

- PASS said `Companions push button`
- PASS never said `You hear:`

---

**3 expectation(s) FAILED.**
