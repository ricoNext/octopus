# Right rail (persistent)

Date: 2026-09-22
Status: approved (scheme A)

## Goal
Add a persistent right-hand module on the main workspace page for future features.

## Layout
`[Left sidebar | Center terminal | Right rail]`

## Behavior
- Default **expanded**
- Resizable without width limits (drag separator on the left edge of the rail)
- Collapsible (button); when collapsed, show a small expand control
- Width persisted in localStorage (mirror left sidebar pattern)
- Hidden on settings view
- Placeholder content only this round (`RightPanel` shell)

## Non-goals
- Real feature content inside the rail
- New keyboard shortcut (button-only for now)
- Refactoring left sidebar into a shared three-pane primitive

## Defaults
- Default width ~280px; drag resize has **no min/max clamp**


## Multi-module shell (added)

Orca-style layers:
- `RightPanel` shell (open/width/collapse already in App)
- `ActivityBar` + `RightRailContent`
- Module registry in `src/components/right-rail/registry.tsx`

Built-in placeholders: `files`, `git`. Active module id persisted as `octopus.right-rail.active-module`.
New features: append a `RightRailModule` to the registry.

## Activity Bar 位置（修订）

模块切换入口放在**顶部横条**（对齐 Orca `RightSidebarTopActivityBar`），不再使用右侧竖条。

- 顶栏：图标切换 + 折叠按钮
- 下方：当前模块内容
