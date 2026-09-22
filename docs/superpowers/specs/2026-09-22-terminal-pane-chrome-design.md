# Terminal pane chrome (header split + close)

Date: 2026-09-22
Status: approved (local)

## Goal
Orca-style always-on mini titlebar on each terminal leaf inside a tab:
- Split right
- Split down
- Close (X) only when leaf count > 1

## Behavior
- Header visible for every leaf (leaf count ≥ 1).
- Split buttons call the same layout path as shortcuts/context menu (`splitLeaf`).
- Close kills that leaf's PTY, `removeLeaf`, updates `sessionByLeafId` / `activeLeafId`; if last leaf, close the tab.
- Clicking header chrome activates that leaf; split/close stopPropagation.
- Keyboard close/split unchanged.

## Non-goals (this round)
- Pane title rename, running-process confirm dialogs, full terminal context menu.

## Implementation
- Imperative header in `PaneManager.buildLeaf`.
- Callbacks: `onSplitLeaf(leafId, direction)`, `onCloseLeaf(leafId)`.
- App extracts `splitPane(leafId, direction)` / `closePane(leafId)` shared by shortcuts and header.
