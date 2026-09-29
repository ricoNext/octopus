# Sidebar project typography hierarchy

**Date:** 2026-09-29  
**Branch:** `feat/worktree-node-modules-symlink` (or current working branch)  
**Scope:** Visual hierarchy only in left `Sidebar` — no interaction / copy / icon changes.

## Goal

Make **project (directory) names** the primary scannable label. Make **main-branch and worktree row titles** secondary so they don't compete with the project name.

## Locked choices

- Approach **A**: contrast via weight + color; keep row title at `text-sm`.
- Weaken target: main / worktree **row labels** (not ⋯/＋ buttons, not the「项目」section header).

## Spec

| Element | Classes (intent) |
|---|---|
| Project name (`project.name`) | `text-sm font-semibold text-sidebar-foreground` (drop current `text-xs` + `text-muted-foreground`) |
| Main branch title (`project.mainBranch`) | keep `text-sm`, add `text-muted-foreground` |
| Worktree branch title (`worktree.branchName`) | keep `text-sm`, add `text-muted-foreground` |
| Row subtitles («主工作区», «基于 …») | unchanged: `text-xs text-muted-foreground` |
| Selection highlight / icons / ⋯ / ＋ | unchanged |

## Out of scope

- Dropdown menu item typography
- Right rail / Agents
- Dep-link icons or menus
- Section header「项目」restyle

## File

- Modify: `src/components/Sidebar.tsx` only

## Acceptance

1. Project names read clearly stronger than branch/worktree titles at a glance.
2. Selected row highlight still works as today.
3. No behavior change for click / context menu / create.
