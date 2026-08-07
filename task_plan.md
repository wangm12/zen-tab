# Zen Tab core capability implementation

## Goal

Implement the approved core-only plan: improve Stash Library, add native tab-group controls, and persist explicit local AI grouping corrections without adding Command Palette, auto snapshots, cloud sync, tags, import/export, duplicate center, tab limits, or default page-body scanning.

## Phases

- [completed] Phase 1 — Shared types, storage validation, and message contracts
- [completed] Phase 2 — Stash search, rename, expansion, and partial restore
- [completed] Phase 3 — Native tab-group controls and undo
- [completed] Phase 4 — Local AI project-memory corrections and settings clear action
- [completed] Phase 5 — Tests, typecheck, production build, and regression verification

## Decisions

- Stash partial restore supports one Tab or an entire Group, not arbitrary multi-select inside a Stash.
- AI memory is local and persistent, bounded, explicit-confirmation-only, and never sent to Groq.
- Existing Chrome Desktop / MV3 architecture remains the source of truth.
- Existing mutation queue, virtual tab list, restore batching, and bilingual UI are reused.

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `react-dev-pro` skill path in catalog did not exist | 1 | Located and read the available copy at `/Users/mingjie.wang/.agents/skills/react-dev-pro/SKILL.md`. |
