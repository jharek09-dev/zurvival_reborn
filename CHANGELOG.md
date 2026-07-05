# Changelog

All notable changes to the Zurvival Reborn design and repository are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **ADR-0002 — Content data format** (`design/decisions/0002-content-data-format.md`) —
  accepted 2026-07-05: JSON validated by JSON Schema (draft 2020-12) in `content/schemas/`,
  one entity per file, Ajv in CI and loader (tooling dependency only), ICU strings for
  translatable fields. Unblocks M0 tasks T6 (content loader + schemas) and T8 (CI gate).
- Initial repository scaffold: language-agnostic structure for docs, content, design,
  assets, and a reserved `prototype/` folder.
- **Game Design Document** (`docs/GDD.md`) — full rewrite that makes the six reimagining
  principles canonica