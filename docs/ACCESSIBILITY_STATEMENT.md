# Zurvival Reborn — Accessibility statement

*Beta · last reviewed 2026-09-15 (T63) · applies to the terminal client (`npm run play`) and the browser client
(`prototype/harness/web/`)*

Zurvival Reborn is a text game, turn-based, with no timers and no reflex tests. We want it to be the most
screen-reader-friendly game its players own. This page says plainly what works today, how we checked it, and what
does not work yet.

## What you can expect

**Everything that matters is in words.** Colour is never the only way anything is shown: every coloured edge or tint
sits beside words that say the same thing. Every meaningful sound has a text caption ("What you hear"), and the game
currently plays no audio at all.

**Screen readers.** In the browser client:

- the page has a heading for the scene (day, time and place), headings for your condition, what you hear, the story,
  and "What do you do?" — so you can jump by heading;
- after you choose, focus moves to the new scene's heading and a short summary is read once: what is new about you
  (and what no longer is), new sounds, the story, and how many choices you have. In **Settings** you can have it read
  that, only what changed, or nothing — the whole scene is always there to read from the heading down;
- choices are a numbered list of buttons, and each says what it costs in words ("2 hours", "free");
- Inventory, Companions, Shelter, Map & Journal and Codex open as dialogs with headings and lists; Tab stays inside a
  dialog, Escape closes it, and focus goes back to where you were.

In the terminal client every turn prints in one fixed order, and a depth screen (I, C, B, M, L) stays on screen until
you press Enter.

**Keyboard.** Everything works from the keyboard: Tab and Shift+Tab to move, the arrow keys inside a group of options,
Enter or Space to choose, Escape to close. There are also single-key shortcuts —
1–9 to choose, I C B M L for the screens, N for a new run. If you use speech input, or keep pressing keys by accident,
turn them off in **Settings**. (Screen readers in browse mode keep those keys for their own navigation anyway;
Tab and Enter always work.)

**Seeing the text.** In **Settings**: text size from 100% to 200% (the layout reflows down to a phone-width screen
at 200%); contrast standard, high, or following your system; the story in a serif or a sans-serif font; standard or
wide letter and line spacing. These settings are remembered in your browser. Windows high-contrast (forced colours)
keeps every button's outline and the focus ring visible (checked in Chromium's forced-colours emulation, not yet on
Windows itself). Every control is at least 44 × 44 pixels.

**Motion.** Nothing flashes. The only animation is a short fade on notices, and it is removed when your system's
"reduce motion" setting is on.

## How we checked

- **With a screen reader.** Both clients were tested with scripted runs of **Orca** (the Linux screen reader): the
  browser client in Chromium, the terminal client in a terminal. The scripts record exactly what Orca said (and, in the
  browser, where focus went), and fail if it said the wrong thing. The transcripts are in `docs/qa/at/`.
- **Automatically.** A check that is part of our CI (it has not yet run on the hosted CI service) loads the browser client in Chromium and reads it through the browser's
  accessibility tree — the same information screen readers get — testing headings, names, Tab order, focus and
  announcements around a turn, every dialog, the shortcuts switch, text contrast in every state it can reach, reflow at
  200%, focus never hidden under the pinned bars, target sizes, reduced motion and settings that persist. Another check
  makes sure the stylesheet never sets text in the two palette colours that are too faint for body text.

## What does not work yet

- **Only one screen reader has been tested.** NVDA, JAWS, VoiceOver and TalkBack have not been tried. If you use one
  of them, we would especially like to hear from you.
- **No testing with disabled players yet**, and none with switch access.
- **No autosave in the browser client.** Your run lives only in the page — use Save to download or copy it. (Your
  reader settings are remembered; your run is not.)
- **Shortcuts can be turned off but not remapped.**
- **No in-game "reduce motion" switch** — there is nothing to switch yet; your system setting is honoured.
- **Some depth screens are long.** Read them by heading (H in most screen readers) and list (L) rather than from the
  top.
- **No visual "what changed" summary.** Screen-reader users can have only the changes announced; there is no
  equivalent highlight on screen yet.

## Tell us

If something in Zurvival Reborn stops you playing, that is a bug and we want it — what you were doing, what you use
(screen reader, magnifier, switch, voice control, browser), and what happened. Send it to the project owner with your
beta feedback; how to run the beta is in `docs/BETA.md`.

*Standards we measure against: WCAG 2.2 level AA for the browser client and the Game Accessibility Guidelines; the
working checklist is `docs/specs/ACCESSIBILITY.md`.*
