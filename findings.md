# Findings

## Current implementation

- `StashRecord.name` already exists and Stash storage is capped at 50 records.
- Stash already supports window, group, and selected-tab capture plus full restore and Undo.
- Stash UI currently supports only full restore/delete; it has no search, rename, expansion, or partial restore.
- `TabRecord` includes group membership, title, URL, favicon, index, active, pinned, muted, and discard state.
- `TabGroupRecord` includes title, color, collapsed, window ID, and group ID.
- Side Panel already has local search for live tabs, virtualized rows, multi-select, drag-and-drop, and active-tab scrolling.
- Group rows currently support collapse, drag-to-group, and stash; they do not expose native rename/color/ungroup actions.
- `ActionJournal.type = 'group'` already supports undoing AI-created grouping by ungrouping affected tabs.
- `chrome.tabGroups.onUpdated` and `onRemoved` already broadcast current group state.
- AI grouping already uses proposals, evidence, confidence levels, unclassified tabs, bounded batches, and no forced single-tab groups.
- Storage validation supports legacy `tab-flow.*` keys and schema-safe fallback.
- Manifest has no new required permissions needed for this plan.

## Implementation constraints

- Stash search should filter the already-loaded snapshot locally; no runtime message per keystroke.
- Partial restore must validate stash membership, special URLs, incognito state, and current tab existence before using the existing restore pipeline.
- Group mutation must use the existing Service Worker mutation queue and stale-ID validation.
- AI project memory must store only normalized project labels/tokens, exclude incognito data, be capped, and stay local.
