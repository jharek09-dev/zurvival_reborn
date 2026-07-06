# Documentation

The design home for Zurvival Reborn, organized by kind.

| Folder | Holds |
| --- | --- |
| [specs/](specs/) | Core design docs — GDD, PRD, Production Plan, Accessibility, Audio, Localization. Source of truth; each also has a generated `.docx` export. |
| [plans/](plans/) | Milestone implementation plans (`M1_PART2_PLAN.md` … `M3_PART3_PLAN.md`) and the living [scope-control tracker](plans/scope-control-tracker.xlsx). |
| [qa/](qa/) | The QA & Test Plan plus one QA review per completed milestone/part. |
| [reference/](reference/) | Source material the rewrite is built on (original outline + prior GDD drafts). |

`status.json` (+ `.bak` / `.bak2`) at the root of this folder is the machine-readable milestone/task tracker, not a hand-authored doc — it stays here rather than under any of the folders above.

## specs/

| File | Purpose |
| --- | --- |
| [GDD.md](specs/GDD.md) | **Game Design Document.** The creative and systemic vision — what the game *is* and why. |
| [PRD.md](specs/PRD.md) | **Product Requirements Document.** The vision turned into prioritized, testable requirements — what we *build* and in what order. |
| [PRODUCTION.md](specs/PRODUCTION.md) | **Production Plan.** The milestone ladder, fun gates, and scope-control machinery — how it ships. |
| [ACCESSIBILITY.md](specs/ACCESSIBILITY.md) | Accessibility checklist. |
| [AUDIO.md](specs/AUDIO.md) | Audio bible. |
| [LOCALIZATION.md](specs/LOCALIZATION.md) | Localization plan. |

Each also has a shareable `.docx` export alongside it. Regenerate exports from the Markdown; do not hand-edit the `.docx`.

## plans/

Working design notes for each milestone part — `M1_PART2_PLAN.md` through `M3_PART3_PLAN.md` — plus [scope-control-tracker.xlsx](plans/scope-control-tracker.xlsx) (milestone backlog, content budgets, risk burn-down).

## qa/

`QA_PLAN.md` is the test strategy and taxonomy. Each `QA_REVIEW_*.md` is the review filed after a milestone/part lands.

## reference/

- `Zurvival Gameplay Outline.txt` — the original Kik bot's pure single-player mechanics,
  stripped of chat/social features. The mechanical skeleton.
- `Zurvival_Reborn_GDD.docx` — the prior full GDD draft (text). The systemic muscle.
- `Zurvival_Reborn_GDD_remodel.docx` — the same GDD with embedded concept images and a
  table of contents.

The current `specs/GDD.md` supersedes the reference GDDs: it keeps their strong systemic content
but reorganizes it around the six design principles and promotes the scattered optional
recommendations into canonical systems.
