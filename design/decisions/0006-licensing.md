# 0006 — Licensing

- **Status:** accepted
- **Date:** 2026-07-16 (accepted 2026-07-16 by Jharek)

## Context

Scheduled to resolve **before any public release** (PRODUCTION §9, PRD §15 Q8), and the **M4 public
beta is public distribution** — a build in a stranger's hands needs a license, so the gate must close
before the beta ships. The repository currently carries a **placeholder** LICENSE (all-rights-reserved
"during pre-production") that explicitly says a final license will be chosen before any public
release; this ADR resolves what the beta ships under, and when the final selection gets made.

This decision is about **rights to the code and content**, and is **coupled to — but not the same as
— the monetization / business-model decision** (T58, PRD §15 Q5), which is deliberately deferred to
M5. Licensing sets what others may legally *do* with the project; monetization sets how it earns.

Selection criteria:

1. **Unblock public-beta distribution.** The beta cannot go out under an *unresolved* license — it
   needs an explicit one, whatever it is.
2. **Fit the project's nature.** Solo + AI, a **deterministic, dependency-free core** (ADR-0001) and
   **content-as-data** (ADR-0002) — architecture that is portfolio- and community-facing by design.
3. **Modding.** The GDD/PRD value community content, and content-as-data + open schemas makes the
   game unusually moddable; the final license should enable that.
4. **Interaction with the deferred monetization decision (T58).** The license should not *silently*
   foreclose a business model — or, where it does constrain one, that trade-off must be made
   **deliberately**.
5. **Prefer the reversible order.** Where two coupled decisions must be made, make the *reversible*
   one first. Permissive licensing is **effectively a one-way door**: shipped MIT copies cannot be
   recalled. All-rights-reserved is not — it can be opened later, at any time, in full.

## Options considered

**Open source, MIT now.** Permissive licensing of engine **and** content: maximal community, mod,
contribution, and portfolio value, and zero licensing friction for the beta. But it is a **one-way
door walked before the decision it constrains** — MIT permits anyone to fork, reskin, and sell the
game, so it would settle T58's option space (criterion 4) *by side effect*, months before T58 is
scheduled to be reasoned about. The value it buys — modders and contributors at scale — is value the
project cannot yet absorb: there is no beta audience, no mod surface shipped, and solo review
capacity (PRODUCTION §2).

**Source-available (BSL / non-commercial).** Code visible for transparency and modding but not
freely resellable — reserves commercial rights while opening the source. A genuine candidate for the
*final* selection, but it carries real license nuance and contribution friction, and picking it now
would still pre-empt T58 on thinner data than T58 will have.

**Retain all-rights-reserved for the beta and defer the final selection to T58 (chosen).** Close the
gate on the only question the beta actually asks — *what does this build ship under?* — and bind the
open/source-available/proprietary selection to the moment the coupled decision is made, with a named
trigger so it cannot drift.

## Decision

**Retain the all-rights-reserved LICENSE as the standing license through the M4 public beta; formally
defer the final license selection (open source / source-available / proprietary) to the T58
monetization decision, bound to a named trigger so it cannot silently drift.**

Concretely:

1. **The M4 beta ships all-rights-reserved.** The placeholder LICENSE stands as the real license for
   the beta — the build is distributed for playtest with rights reserved. This is an *explicit*
   license, not an open question, so criterion 1 is satisfied and nothing about licensing stalls the
   beta.
2. **No open-source grant is made before T58.** Nothing in the repo is published under a permissive
   or source-available license until the final selection lands, because that grant is irrevocable for
   everything it touches (criterion 5).
3. **The final license is selected at the T58 monetization decision** — the two are coupled
   (criterion 4), and T58 is where the business model is reasoned about with beta data behind it.
   It is logged as **ADR-0006a**, which supersedes this ADR. The §9 schedule carries the trigger so
   it is not forgotten.
4. **The selection is not pre-judged.** MIT and source-available both remain live options for
   ADR-0006a, and criteria 2 and 3 — the shared-by-design architecture, and modding — are recorded
   here as **real arguments in their favour**, to be weighed at T58 rather than lost. What is
   rejected here is only the *timing*, not the outcome.

## Consequences

Easier: the **public beta ships with zero licensing ambiguity** under an explicit license; the
**irrevocable decision is made in the right order** — after the business model it constrains, not
before it (criterion 5); T58 inherits a **full option space** (proprietary, source-available, and
open all still on the table) instead of a foreclosed one; no CLA or contribution-provenance machinery
is needed for a solo repo in the meantime.

Harder: the project is **not an open portfolio during the beta**, and **modders and outside
contributors cannot build on it yet** (accepted — the mod surface is unshipped and solo review
capacity is the binding constraint, so the value deferred is largely theoretical today); "reserved"
beta rights mean any **community content that does appear** has no clear license to live under
(mitigated: the beta is a playtest, and ADR-0006a lands before the M5 launch); the deferral only
works if the **T58 trigger is honored** (mitigated by logging it here and in the §9 schedule as
ADR-0006a), otherwise "deferred" quietly becomes "forgotten."

If accepted: resolves the M4 decision gate; the beta ships all-rights-reserved with no licensing
ambiguity, and the final selection carries a dated trigger at T58. If vetoed: select the final
license against the same five criteria within the M4 beta time-box, before any public build leaves
the owner's hands.
