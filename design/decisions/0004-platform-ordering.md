# 0004 — Platform ordering (native / Steam / bot)

- **Status:** accepted
- **Date:** 2026-07-16 (accepted 2026-07-16 by Jharek)

## Context

Scheduled to resolve by **M4** (PRODUCTION §9, PRD §15 Q4): it *blocks post-launch client work*,
and the M4 milestone opens the public beta, so the platform story must be settled enough not to
stall content or the beta. **Web-first is already set** — it was a fixed premise of ADR-0001
(a pure, headless engine that ships to the browser as-is and runs unchanged under a bot client,
TEC-03). What is *not* decided, and what this ADR resolves, is the **order** of the remaining
clients after the web beta: a native app (mobile / desktop), a Steam release, and a
Discord/Telegram chat-bot.

Selection criteria, drawn from existing commitments:

1. **Must not stall the M4 beta or M5 launch.** The beta and v1.0 ship on **web** (mobile-first).
   Any post-web client is, by construction, *not on the launch critical path* — so the one thing
   this decision must guarantee is that it does not gate the beta.
2. **Leverage the headless core (TEC-03, ADR-0001).** Every client is a thin renderer over the
   same deterministic engine; no client requires re-implementing game logic. This makes the
   *marginal* client cheap and makes ordering a business/reach question, not an architecture one.
3. **Match the personas (PRD).** "Play in short bursts on my phone" — mobile web already serves
   this; a chat-bot serves it *natively* (the game lives where the player already is), a Steam
   build serves a different, session-heavier audience.
4. **Decide against data we do not yet have.** *Where* players actually are, what retains them,
   and which funnel converts are answerable only *after* the beta. Committing a fixed native →
   Steam → bot order now would be a guess dressed as a decision.

## Options considered

**Commit a concrete order now (e.g. bot → app → Steam, or Steam → app → bot).** Gives a quotable
roadmap, but every ordering rests on beta data that does not exist yet (criterion 4); locking one
in trades a real future decision for a premature one.

**Leave ADR-0004 open.** Violates the §9 discipline — an open gate at its milestone is exactly the
drift the schedule exists to prevent, and "open" gives the beta no clarity.

**Ratify web-first and formally defer the *ordering* with a named re-decision trigger
(recommended).** Resolve the gate by deciding the two things that actually matter now — the launch
surface, and that no second client is built before v1.0 — and bind the ordering decision to a
specific later moment (the launch gate) when the data exists. This is a *decision*, not a
deferral-by-neglect: it names what is settled, what is not, and exactly when the rest gets settled.

## Decision

**Ratify web-first as the sole launch surface through the M4 beta and M5 v1.0; formally defer the
native/Steam/bot ordering to a post-launch re-decision, bound to a named trigger so it cannot
silently drift.**

Concretely:

1. **Web (mobile-first) is the launch client** for the M4 public beta and the v1.0 release. No
   licensing, packaging, or store dependency sits on the launch path.
2. **No second client is built before v1.0 ships** (WIP discipline, PRODUCTION §6.6 — one thing in
   flight; the M4/M5 work is content, balance, accessibility, and hardening, not new clients).
3. **The ordering is re-decided at the v1.0 launch gate (T69)** using beta + launch telemetry —
   where players actually are, retention, funnel — and logged as **ADR-0004a**, which supersedes
   this ADR. The §9 schedule carries the trigger so it is not forgotten.
4. **Interim lean, not a commitment:** because the headless engine (TEC-03) makes a
   Discord/Telegram bot the cheapest incremental reach (no store review, no native packaging, and
   it matches the short-burst persona), the **bot is the default first post-launch client absent
   contrary data**. This is written down only so a forced-early decision has a sane default; it is
   explicitly *not* a roadmap promise.

## Consequences

Easier: the M4 beta and M5 launch stay focused on the game (content, balance, hardening) with **no
store/native/packaging work competing** for the scarce review capacity (PRODUCTION §2); the eventual
ordering is made **against real data instead of a guess**; the shared-core architecture keeps every
future client cheap, so deferring costs nothing structural (criterion 2); the decision gate is
*closed* — web-first ratified, order deferred-with-trigger — so nothing about clients stalls the beta.

Harder: there is **no fixed post-launch platform roadmap** to hand a partner or a marketing plan yet
(accepted — it is post-launch by definition, and a guessed roadmap would be worse); the deferral only
works if the **T69 trigger is honored** (mitigated by logging it here and in the §9 schedule as
ADR-0004a), otherwise "deferred" quietly becomes "forgotten."

If accepted: resolves the M4 decision gate; the beta ships on web with zero client ambiguity, and the
ordering carries a dated trigger. If vetoed: pick a concrete native/Steam/bot order against the same
four criteria within the M4 time-box.
