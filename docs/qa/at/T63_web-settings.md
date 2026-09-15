# Web client — reader settings

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

The Settings dialog is operated with a screen reader. What must hold: each option is announced inside the setting it belongs to, Space selects it and the page's text really does grow, and closing the dialog replays nothing (in the first T63 build closing it re-read the last turn's whole digest).

### Enter on Settings — focus lands on the first setting, in its group

keys: `Return`

focus → input#set-scale-1 — ""
- PASS focus matches `#set-scale-1`

Orca said:

> 🔊 return
> 🔊 dialog
> 🔊 Text size panel.
> 🔊 100%
> 🔊 selected radio button

- PASS said `dialog`
- PASS said `Text size panel`
- PASS said `/100% ‖ selected radio button/`

### Right arrow

keys: `Right`

focus → input#set-scale-125 — ""

Orca said:

> 🔊 125%
> 🔊 not selected

- PASS said `125%`

### Space selects 125%

keys: `space`

focus → input#set-scale-125 — ""
- PASS focus matches `#set-scale-125`

Orca said:

> 🔊 space
> 🔊 selected

- PASS said `/(^|[^t] )selected/`
- PASS page check `window.__ZURV_UI.settings.scale === 1.25 && getComputedStyle(document.documentElement).fontSize === '20px'`

### Tab to Contrast

keys: `Tab`

focus → input#set-contrast-auto — ""

Orca said:

> 🔊 tab
> 🔊 Contrast panel.
> 🔊 Follow my system.
> 🔊 selected radio button

- PASS said `Contrast panel`
- PASS said `Follow my system`

### Escape closes, nothing replays

keys: `Escape`

focus → button#btn-settings — "Settings"
- PASS focus matches `#btn-settings`

Orca said:

> 🔊 escape
> 🔊 leaving panel.
> 🔊 banner
> 🔊 Settings push button.

- PASS said `Settings push button`
- PASS never said `You hear:`
- PASS never said `choices.`

---

**All expectations held.**
