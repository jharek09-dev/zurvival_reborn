# web/at — verification with a real screen reader (T63)

NFR-ACC-02 asks for accessibility *verified with assistive technology*, not just authored. This folder is how the
two clients are verified with one: **Orca**, the GNOME screen reader, driving

- the built web page (`web/build-html.mjs`) in Chromium, over AT-SPI; and
- the terminal client (`src/playCli.ts`) in a VTE terminal (xfce4-terminal).

Keys are real X key events (`xdotool`). What Orca *said* comes from its own debug log — every `SPEECH OUTPUT:` line
is the exact string it handed the speech synthesiser — and, for the web page, where DOM focus landed comes from the
DevTools protocol. Each scenario step carries `expect` / `forbid` phrases and a `focus` selector, so a run is a
pass/fail result with a transcript attached, not a recording somebody has to believe.

**Not run in CI.** It needs a desktop accessibility stack. What a CI runner can repeat — structure, focus, dialogs,
shortcuts, rendered contrast, reflow, target size, motion, persistence, read through Chromium's accessibility tree —
is `web/a11y-check.mjs`, which CI does run.

## Run it (Ubuntu 24.04)

    sudo apt-get install -y --no-install-recommends orca xdotool dbus-x11 at-spi2-core speech-dispatcher \
      python3-pyatspi gsettings-desktop-schemas xfce4-terminal xvfb
    export ZURV_AT_DIR=/tmp/zurv-at
    web/at/start-stack.sh                         # Xvfb :99, session bus, AT-SPI, Orca logging to $ZURV_AT_DIR
    web/at/run-all.sh /tmp/zurv-at/out --chrome "$(which chromium)"

or one scenario: `node web/at/orca-run.mjs web web/at/scenarios/web-turn.json out.md --page built.html`.

The transcripts committed as evidence are in `docs/qa/at/`: `T63_<scenario>.md` for each scenario on the T63 build,
and `T63_PRE_<scenario>.md` for the three scenarios that run unchanged on the pre-T63 page and terminal client
(`web-turn`, `web-dialog-trap`, `cli-screen`) — the same script, run before. Each step also carries `assertJs` where
a spoken word alone cannot prove the page changed.

## Scenarios

| file | what must hold |
|---|---|
| `web-turn.json` | a choice's name carries its cost in words; Enter moves focus to the new scene heading and Orca speaks one ordered digest ending in the choice count; the scene walks by heading (H) (runs unchanged on the pre-T63 page) |
| `web-dialogs.json` | every dialog — the second one too — is announced as a dialog on open; content reads as headings and lists; Escape returns focus to the opener; closing re-reads nothing |
| `web-dialog-trap.json` | after reading on with the browse cursor, Tab still lands inside the dialog (runs unchanged on the pre-T63 page) |
| `web-settings.json` | each option is spoken inside its setting's group; Space selects and the text really grows; closing replays nothing |
| `web-run-over.json` | the last turn lands focus on "The run is over." and speaks the ending |
| `cli-screen.json` | a turn is spoken in reading order; a depth screen is spoken whole, title line first, and STOPS; a bare Enter returns to the story (runs unchanged on the pre-T63 client) |

## Three things about the harness that are not about the game

1. **Orca's debug file is block-buffered.** An utterance can sit unwritten until 8 KB more debug output arrives, which
   pins speech to the wrong step. `start-stack.sh` runs Orca under `script` with the debug file on `/dev/tty`, which
   Python line-buffers.
2. **`sayAllOnLoad` is switched off** in a private Orca preferences directory. With the null speech backend a
   say-all never gets its "finished" callback, stays active forever, and Orca then stops presenting focus changes
   ("Not presenting text because SayAll is active"). A real listener's say-all ends; this one would not.
3. **A UTF-8 locale** for the terminal, or `—` and `·` reach Orca as Latin-1 mojibake.

## Orca behaviour worth knowing when reading a transcript

- In browse mode Orca keeps the letter and digit keys for its own quick navigation (H heading, B button, L list,
  1–6 heading level). The page's single-key shortcuts therefore do nothing for an Orca user in browse mode — they
  are for sighted keyboard players — and every action is reachable with Tab and Enter. Settings can switch the
  shortcuts off entirely (WCAG 2.1.4).
- On opening a dialog Orca speaks "dialog", the description, and the focused control, but not the dialog's name
  when the button just pressed has the same name ("has same name as priorObj" in its log).
- A heading that holds focus is spoken with "clickable" (Chromium exposes a click action on anything focusable);
  the client adds `tabindex="-1"` only while a heading actually has focus, so the word does not follow the reader
  around the page afterwards.
