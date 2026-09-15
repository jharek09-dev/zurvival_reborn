# Web client — the last turn of a run

Screen reader: Orca (46.1) · client: web page in Chromium over AT-SPI · 2026-09-15

A run is played to one turn before its end (by script), then the fatal choice is taken from the keyboard. What must hold: focus lands on 'The run is over.', and Orca speaks the ending and how to start again.

### Enter — the last choice

keys: `Return`

focus → h2#choices-title — "The run is over."
- PASS focus matches `#choices-title`

Orca said:

> 🔊 return
> 🔊 Thirst won before the dead ever did. You stopped moving somewhere quiet. You stopped. Whatever came next, it came without you arguing. Nothing you leave behind has your name on it. The city went on being the city, and you stopped being in it. There was water in that city. There is always water in a city. You simply ran out of the hours to find it in. You were not the first that week and you were nowhere near the last. Names you never learned had gone out ahead of you, all over the map. You did not fight the last of it. After everything you had spent fighting the rest, that reads less like giving up than like knowing the difference. The run is over. Start a new run to play again.

- PASS said `The run is over.`
- PASS said `Start a new run to play again.`

### Tab

keys: `Tab`

focus → button — "New run"

Orca said:

> 🔊 tab
> 🔊 New run push button.

- PASS said `New run push button`

---

**All expectations held.**
