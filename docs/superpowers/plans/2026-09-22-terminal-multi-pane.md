# Terminal Tab 内多 Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一个 terminal tab 内支持二叉分屏多 pane（独立 PTY/xterm），并用快捷键新建 tab、分屏、关 pane、切换焦点。

**Architecture:** 布局用 `PaneLayoutNode` 二叉树存在 `TerminalTab` 上并写入 `octopus.terminal.state` v2；渲染由命令式 `PaneManager` 管理 DOM/xterm，React 只挂 `TerminalWorkspace` 壳。PTY 继续走现有 Tauri `pty_*` API，但 `sessionId` 从 `tab.id` 改为 `leaf.id`。

**Tech Stack:** Tauri 2、React 19、xterm、FitAddon、TypeScript、Bun；纯逻辑用 Vitest 单测（本期新增）。

**Spec:** `docs/superpowers/specs/2026-09-22-terminal-multi-pane-design.md`

## Global Constraints

- 范围仅内层 pane；不做外层 tab-group 多列
- 不引入 zustand；继续 React state + localStorage
- 不改 `api.ptyOpen/ptyDetach/ptyWrite/ptyResize/ptyKill` 签名
- `cwdId` 始终为当前 context（projectId / worktreeId），分屏继承
- Mac 快捷键：⌘T / ⌘D / ⌘⇧D / ⌘W / ⌘]；保留现有 ⌘B
- 每 context 至少保留 1 个 tab（现网规则）
- v1 迁移：`leaf.id = tab.id` 且 `sessionByLeafId[tab.id] = tab.id`，以 attach 旧 session
- 方向语义：向右分屏 = 左右栏（split `direction: "vertical"`）；向下分屏 = 上下栏（`direction: "horizontal"`）

## File map

| 文件 | 职责 |
|---|---|
| `src/lib/terminal/pane-layout.ts` | 布局类型 + split/close/focus/list 纯函数 |
| `src/lib/terminal/terminal-tab.ts` | `TerminalTab` 工厂、v1→v2 迁移、杀 session 列表 |
| `src/lib/terminal/pane-layout.test.ts` | 布局单测 |
| `src/lib/terminal/terminal-tab.test.ts` | 迁移/工厂单测 |
| `src/lib/keybindings.ts` | 快捷键定义与匹配 |
| `src/lib/keybindings.test.ts` | 匹配单测 |
| `src/lib/pane-manager/pane-manager.ts` | 命令式 DOM + xterm + PTY 绑定 |
| `src/components/TerminalWorkspace.tsx` | React 壳，持有 PaneManager 生命周期 |
| `src/components/TerminalPane.tsx` | 降级为单 leaf 绑定助手，或被 pane-manager 内联吸收后删除导出 |
| `src/App.tsx` | 接入新 `TerminalTab` 形状、关 tab 杀全部 session、快捷键分发、渲染 Workspace |
| `package.json` / `vitest.config.ts` | 增加 vitest |

---

### Task 1: Vitest + 布局纯函数

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`（scripts + devDependency `vitest`）
- Create: `src/lib/terminal/pane-layout.ts`
- Create: `src/lib/terminal/pane-layout.test.ts`

**Interfaces:**
- Produces:
  - `export type SplitDirection = "horizontal" | "vertical"`
  - `export type PaneLayoutNode = { type: "leaf"; id: string } | { type: "split"; id: string; direction: SplitDirection; ratio: number; first: PaneLayoutNode; second: PaneLayoutNode }`
  - `export function createLeaf(id: string): PaneLayoutNode`
  - `export function listLeaves(root: PaneLayoutNode): string[]`
  - `export function splitLeaf(root: PaneLayoutNode, leafId: string, direction: SplitDirection, newLeafId: string, splitId: string): PaneLayoutNode`
  - `export function removeLeaf(root: PaneLayoutNode, leafId: string): PaneLayoutNode | null`
  - `export function nextLeafId(root: PaneLayoutNode, activeLeafId: string): string`

- [ ] **Step 1: 添加 Vitest**

在 `package.json` 增加：

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

并用 bun 安装：`bun add -d vitest`

创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 2: 写失败测试**

`src/lib/terminal/pane-layout.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  createLeaf,
  listLeaves,
  nextLeafId,
  removeLeaf,
  splitLeaf,
} from "./pane-layout";

describe("pane-layout", () => {
  it("splitLeaf replaces target leaf with a split", () => {
    const root = createLeaf("a");
    const next = splitLeaf(root, "a", "vertical", "b", "s1");
    expect(next).toEqual({
      type: "split",
      id: "s1",
      direction: "vertical",
      ratio: 0.5,
      first: { type: "leaf", id: "a" },
      second: { type: "leaf", id: "b" },
    });
    expect(listLeaves(next)).toEqual(["a", "b"]);
  });

  it("removeLeaf promotes sibling", () => {
    const root = splitLeaf(createLeaf("a"), "a", "horizontal", "b", "s1");
    expect(removeLeaf(root, "b")).toEqual({ type: "leaf", id: "a" });
    expect(removeLeaf(root, "a")).toEqual({ type: "leaf", id: "b" });
  });

  it("removeLeaf of sole leaf returns null", () => {
    expect(removeLeaf(createLeaf("a"), "a")).toBeNull();
  });

  it("nextLeafId walks preorder and wraps", () => {
    let root = createLeaf("a");
    root = splitLeaf(root, "a", "vertical", "b", "s1");
    root = splitLeaf(root, "b", "horizontal", "c", "s2");
    // leaves preorder: a, b, c
    expect(listLeaves(root)).toEqual(["a", "b", "c"]);
    expect(nextLeafId(root, "a")).toBe("b");
    expect(nextLeafId(root, "c")).toBe("a");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun run test`
Expected: FAIL（找不到模块或导出名）

- [ ] **Step 4: 最小实现**

`src/lib/terminal/pane-layout.ts`：

```ts
export type SplitDirection = "horizontal" | "vertical";

export type PaneLayoutNode =
  | { type: "leaf"; id: string }
  | {
      type: "split";
      id: string;
      direction: SplitDirection;
      ratio: number;
      first: PaneLayoutNode;
      second: PaneLayoutNode;
    };

export function createLeaf(id: string): PaneLayoutNode {
  return { type: "leaf", id };
}

export function listLeaves(root: PaneLayoutNode): string[] {
  if (root.type === "leaf") return [root.id];
  return [...listLeaves(root.first), ...listLeaves(root.second)];
}

export function splitLeaf(
  root: PaneLayoutNode,
  leafId: string,
  direction: SplitDirection,
  newLeafId: string,
  splitId: string,
): PaneLayoutNode {
  if (root.type === "leaf") {
    if (root.id !== leafId) return root;
    return {
      type: "split",
      id: splitId,
      direction,
      ratio: 0.5,
      first: root,
      second: { type: "leaf", id: newLeafId },
    };
  }
  return {
    ...root,
    first: splitLeaf(root.first, leafId, direction, newLeafId, splitId),
    second: splitLeaf(root.second, leafId, direction, newLeafId, splitId),
  };
}

export function removeLeaf(root: PaneLayoutNode, leafId: string): PaneLayoutNode | null {
  if (root.type === "leaf") {
    return root.id === leafId ? null : root;
  }
  if (root.first.type === "leaf" && root.first.id === leafId) return root.second;
  if (root.second.type === "leaf" && root.second.id === leafId) return root.first;
  const first = removeLeaf(root.first, leafId);
  const second = removeLeaf(root.second, leafId);
  if (first === null) return second;
  if (second === null) return first;
  return { ...root, first, second };
}

export function nextLeafId(root: PaneLayoutNode, activeLeafId: string): string {
  const leaves = listLeaves(root);
  if (leaves.length === 0) return activeLeafId;
  const idx = leaves.indexOf(activeLeafId);
  if (idx < 0) return leaves[0]!;
  return leaves[(idx + 1) % leaves.length]!;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock vitest.config.ts src/lib/terminal/pane-layout.ts src/lib/terminal/pane-layout.test.ts
git commit -m "$(cat <<'EOF'
feat(terminal): add pane layout tree helpers and vitest

EOF
)"
```

---

### Task 2: TerminalTab 工厂与 v1→v2 迁移

**Files:**
- Create: `src/lib/terminal/terminal-tab.ts`
- Create: `src/lib/terminal/terminal-tab.test.ts`

**Interfaces:**
- Consumes: `createLeaf` from `pane-layout.ts`
- Produces:
  - `export type TerminalTab = { id: string; label: string; layout: PaneLayoutNode; activeLeafId: string; sessionByLeafId: Record<string, string> }`
  - `export function createTerminalTab(index: number): TerminalTab`
  - `export function migrateTerminalTab(raw: unknown): TerminalTab | null`
  - `export function migrateTabsByContext(raw: unknown): Record<string, TerminalTab[]>`
  - `export function sessionIdsForTab(tab: TerminalTab): string[]`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import {
  createTerminalTab,
  migrateTerminalTab,
  migrateTabsByContext,
  sessionIdsForTab,
} from "./terminal-tab";

describe("terminal-tab", () => {
  it("createTerminalTab builds a single-leaf tab with matching session", () => {
    const tab = createTerminalTab(1);
    expect(tab.label).toBe("终端 1");
    expect(tab.layout).toEqual({ type: "leaf", id: tab.activeLeafId });
    expect(tab.sessionByLeafId[tab.activeLeafId]).toBe(tab.activeLeafId);
    expect(tab.id).not.toBe(tab.activeLeafId);
  });

  it("migrateTerminalTab upgrades v1 {id,label} keeping session id = tab.id", () => {
    const tab = migrateTerminalTab({ id: "old-tab", label: "终端 1" });
    expect(tab).toEqual({
      id: "old-tab",
      label: "终端 1",
      layout: { type: "leaf", id: "old-tab" },
      activeLeafId: "old-tab",
      sessionByLeafId: { "old-tab": "old-tab" },
    });
  });

  it("migrateTabsByContext skips invalid entries", () => {
    const out = migrateTabsByContext({
      ctx: [{ id: "t1", label: "a" }, { id: 1 }, null],
    });
    expect(Object.keys(out)).toEqual(["ctx"]);
    expect(out.ctx).toHaveLength(1);
    expect(out.ctx![0]!.id).toBe("t1");
  });

  it("sessionIdsForTab returns unique session ids", () => {
    const tab = createTerminalTab(2);
    expect(sessionIdsForTab(tab)).toEqual([tab.activeLeafId]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun run test src/lib/terminal/terminal-tab.test.ts`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```ts
import { createLeaf, type PaneLayoutNode } from "./pane-layout";

export type TerminalTab = {
  id: string;
  label: string;
  layout: PaneLayoutNode;
  activeLeafId: string;
  sessionByLeafId: Record<string, string>;
};

export function createTerminalTab(index: number): TerminalTab {
  const tabId = crypto.randomUUID();
  const leafId = crypto.randomUUID();
  return {
    id: tabId,
    label: `终端 ${index}`,
    layout: createLeaf(leafId),
    activeLeafId: leafId,
    sessionByLeafId: { [leafId]: leafId },
  };
}

export function migrateTerminalTab(raw: unknown): TerminalTab | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;

  // already v2
  if (
    value.layout &&
    typeof value.activeLeafId === "string" &&
    value.sessionByLeafId &&
    typeof value.sessionByLeafId === "object"
  ) {
    return {
      id: value.id,
      label: value.label,
      layout: value.layout as PaneLayoutNode,
      activeLeafId: value.activeLeafId,
      sessionByLeafId: value.sessionByLeafId as Record<string, string>,
    };
  }

  // v1
  return {
    id: value.id,
    label: value.label,
    layout: createLeaf(value.id),
    activeLeafId: value.id,
    sessionByLeafId: { [value.id]: value.id },
  };
}

export function migrateTabsByContext(raw: unknown): Record<string, TerminalTab[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TerminalTab[]> = {};
  for (const [contextId, rawTabs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rawTabs)) continue;
    const tabs = rawTabs
      .map((tab) => migrateTerminalTab(tab))
      .filter((tab): tab is TerminalTab => tab !== null);
    if (tabs.length > 0) out[contextId] = tabs;
  }
  return out;
}

export function sessionIdsForTab(tab: TerminalTab): string[] {
  return [...new Set(Object.values(tab.sessionByLeafId))];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/terminal/terminal-tab.ts src/lib/terminal/terminal-tab.test.ts
git commit -m "$(cat <<'EOF'
feat(terminal): add TerminalTab v2 model and v1 migration

EOF
)"
```

---

### Task 3: App 接入 v2 模型（单 leaf 行为不变）

**Files:**
- Modify: `src/App.tsx`（去掉本地 `TerminalTab` / `createTerminalTab`，改用 `src/lib/terminal/terminal-tab.ts`；`readPersistedTerminalState` 走 `migrateTabsByContext`；持久化写 `version: 2`；关 tab 对 `sessionIdsForTab` 全部 `ptyKill`）

**Interfaces:**
- Consumes: `TerminalTab`, `createTerminalTab`, `migrateTabsByContext`, `sessionIdsForTab`
- Produces: 持久化 shape `{ version: 2, selection, tabsByContext, activeTabByContext }`；运行时仍只渲染一个 `TerminalPane` per tab（下一 task 再换 Workspace）

- [ ] **Step 1: 改 read/write**

把 `App.tsx` 里：

```ts
type TerminalTab = { id: string; label: string };
function createTerminalTab(index: number): TerminalTab { ... }
```

替换为：

```ts
import {
  createTerminalTab,
  migrateTabsByContext,
  sessionIdsForTab,
  type TerminalTab,
} from "@/lib/terminal/terminal-tab";
```

`PersistedTerminalState` 增加 `version?: number`。

`readPersistedTerminalState` 中 tabs 解析改为：

```ts
const tabsByContext = migrateTabsByContext(value.tabsByContext);
```

持久化：

```ts
JSON.stringify({
  version: 2,
  selection,
  tabsByContext,
  activeTabByContext,
})
```

关 tab 处（现 `api.ptyKill(id)`）改为：

```ts
const tab = tabs.find((item) => item.id === id);
if (tab) {
  for (const sessionId of sessionIdsForTab(tab)) {
    void api.ptyKill(sessionId).catch(() => undefined);
  }
}
```

渲染 `TerminalPane` 暂改为：

```tsx
<TerminalPane
  sessionId={tab.sessionByLeafId[tab.activeLeafId] ?? tab.activeLeafId}
  cwdId={context.id}
  active={...}
/>
```

- [ ] **Step 2: 类型检查**

Run: `bun run build`（或 `bunx tsc --noEmit`）
Expected: 无因 TerminalTab 形状引起的类型错误

- [ ] **Step 3: 手工冒烟**

Run: `bun run tauri:dev`
验证：打开已有 project、旧 tab 仍出字、新建 tab、关 tab、刷新后 tab 还在。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(terminal): persist v2 tab layout shape with single-leaf parity

EOF
)"
```

---

### Task 4: 快捷键匹配纯模块

**Files:**
- Create: `src/lib/keybindings.ts`
- Create: `src/lib/keybindings.test.ts`

**Interfaces:**
- Produces:
  - `export type KeybindingAction = "tab.newTerminal" | "terminal.splitRight" | "terminal.splitDown" | "terminal.closePane" | "terminal.focusNextPane" | "sidebar.toggle"`
  - `export function matchKeybinding(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): KeybindingAction | null`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { matchKeybinding } from "./keybindings";

function key(partial: Partial<KeyboardEvent> & { key: string }) {
  return {
    key: partial.key,
    metaKey: Boolean(partial.metaKey),
    ctrlKey: Boolean(partial.ctrlKey),
    shiftKey: Boolean(partial.shiftKey),
    altKey: Boolean(partial.altKey),
  };
}

describe("matchKeybinding", () => {
  it("matches Mac chord defaults", () => {
    expect(matchKeybinding(key({ key: "t", metaKey: true }))).toBe("tab.newTerminal");
    expect(matchKeybinding(key({ key: "d", metaKey: true }))).toBe("terminal.splitRight");
    expect(matchKeybinding(key({ key: "d", metaKey: true, shiftKey: true }))).toBe(
      "terminal.splitDown",
    );
    expect(matchKeybinding(key({ key: "w", metaKey: true }))).toBe("terminal.closePane");
    expect(matchKeybinding(key({ key: "]", metaKey: true }))).toBe("terminal.focusNextPane");
    expect(matchKeybinding(key({ key: "b", metaKey: true }))).toBe("sidebar.toggle");
  });

  it("returns null for unmatched", () => {
    expect(matchKeybinding(key({ key: "t" }))).toBeNull();
  });
});
```

- [ ] **Step 2: 实现**

```ts
export type KeybindingAction =
  | "tab.newTerminal"
  | "terminal.splitRight"
  | "terminal.splitDown"
  | "terminal.closePane"
  | "terminal.focusNextPane"
  | "sidebar.toggle";

export function matchKeybinding(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): KeybindingAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return null;
  const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (k === "t" && !event.shiftKey) return "tab.newTerminal";
  if (k === "d" && event.shiftKey) return "terminal.splitDown";
  if (k === "d" && !event.shiftKey) return "terminal.splitRight";
  if (k === "w" && !event.shiftKey) return "terminal.closePane";
  if (k === "]" && !event.shiftKey) return "terminal.focusNextPane";
  if (k === "b" && !event.shiftKey) return "sidebar.toggle";
  return null;
}
```

- [ ] **Step 3: 测试通过并 commit**

```bash
bun run test
git add src/lib/keybindings.ts src/lib/keybindings.test.ts
git commit -m "$(cat <<'EOF'
feat(terminal): add keybinding matcher for pane shortcuts

EOF
)"
```

---

### Task 5: PaneManager（命令式 DOM + xterm + PTY）

**Files:**
- Create: `src/lib/pane-manager/pane-manager.ts`
- Modify: `src/components/TerminalPane.tsx`（抽出可复用的 theme / attach 逻辑供 PaneManager 调用，或把核心迁入 `src/lib/pane-manager/leaf-session.ts` 后让旧组件变薄）

**Interfaces:**
- Consumes: `PaneLayoutNode`, `api.pty*`
- Produces:
  - `export type PaneManagerCallbacks = { onActiveLeafChange: (leafId: string) => void; onRatioChange: (layout: PaneLayoutNode) => void }`
  - `export class PaneManager { constructor(host: HTMLElement, opts: { cwdId: string; getLayout: () => PaneLayoutNode; getSessionId: (leafId: string) => string; getActiveLeafId: () => string; callbacks: PaneManagerCallbacks }); setActive(active: boolean): void; syncLayout(): void; focusLeaf(leafId: string): void; dispose(): void }`

- [ ] **Step 1: 实现 PaneManager 骨架行为**

要求（实现时对照 spec §5）：

1. `syncLayout()` 按当前 layout 重建或 diff flex 树：`split` → `display:flex; flex-direction: row|column`；`leaf` → 子容器挂 xterm
2. `direction: "vertical"` → `flex-direction: row`（左右）；`horizontal` → `column`（上下）
3. 每个 leaf：创建 `Terminal` + `FitAddon`，listen `pty-data`/`pty-exit`（过滤 `id === sessionId`），`active` 时 `ptyOpen`
4. 点击 leaf 容器 → `callbacks.onActiveLeafChange(leafId)` 并 `term.focus()`
5. 分隔条 pointer 拖拽更新相邻 split 的 flex-basis / ratio，`pointerup` 调用 `onRatioChange` 回写整棵树（深拷贝改 ratio）
6. `setActive(false)` 时对各 session `ptyDetach`（不 kill）；`dispose()` detach + `term.dispose()` + 清空 DOM
7. 隐藏宿主（父级 invisible）时仍保持实例，与现网「访问过挂载」一致

可参考现有 `TerminalPane.tsx` 的 theme、scrollback、`^U` 清行、ResizeObserver→`ptyResize` 逻辑，迁到 leaf 绑定函数，避免复制两套。

- [ ] **Step 2: 手工/单元能测的部分**

布局→flex direction 映射若抽成纯函数，补测：

```ts
expect(flexDirectionFor("vertical")).toBe("row");
expect(flexDirectionFor("horizontal")).toBe("column");
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/pane-manager src/components/TerminalPane.tsx
git commit -m "$(cat <<'EOF'
feat(terminal): add imperative PaneManager for multi-pane xterm

EOF
)"
```

---

### Task 6: TerminalWorkspace + App 换挂载

**Files:**
- Create: `src/components/TerminalWorkspace.tsx`
- Modify: `src/App.tsx`（用 Workspace 替换 per-tab `TerminalPane`；把 ⌘B 并入统一 keydown；实现分屏/关 pane/聚焦/新建的 dispatch）

**Interfaces:**
- Consumes: `PaneManager`, `matchKeybinding`, layout helpers
- Produces: 工作区 UI 与快捷键行为符合 spec 验收标准

- [ ] **Step 1: TerminalWorkspace**

```tsx
// src/components/TerminalWorkspace.tsx
import { useEffect, useRef } from "react";
import { PaneManager } from "@/lib/pane-manager/pane-manager";
import type { PaneLayoutNode } from "@/lib/terminal/pane-layout";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";

type Props = {
  tab: TerminalTab;
  cwdId: string;
  active: boolean;
  onChange: (next: TerminalTab) => void;
};

export function TerminalWorkspace({ tab, cwdId, active, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<PaneManager | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const manager = new PaneManager(host, {
      cwdId,
      getLayout: () => tabRef.current.layout,
      getSessionId: (leafId) => tabRef.current.sessionByLeafId[leafId] ?? leafId,
      getActiveLeafId: () => tabRef.current.activeLeafId,
      callbacks: {
        onActiveLeafChange: (leafId) => {
          onChange({ ...tabRef.current, activeLeafId: leafId });
        },
        onRatioChange: (layout) => {
          onChange({ ...tabRef.current, layout });
        },
      },
    });
    managerRef.current = manager;
    manager.syncLayout();
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [tab.id, cwdId]); // tab 身份变化才重建 manager

  useEffect(() => {
    managerRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    managerRef.current?.syncLayout();
    managerRef.current?.focusLeaf(tab.activeLeafId);
  }, [tab.layout, tab.activeLeafId, tab.sessionByLeafId]);

  return <div ref={hostRef} className="h-full min-h-0 w-full" />;
}
```

（若 `syncLayout` 在 layout 引用每次持久化都重建 xterm，实现时必须做 leafId 级 diff——计划要求：已存在的 leaf 复用 Terminal 实例。）

- [ ] **Step 2: App 替换渲染**

将访问过的 context×tab 映射从 `TerminalPane` 改为 `TerminalWorkspace`，`onChange` 写回 `tabsByContext`。

- [ ] **Step 3: 统一 keydown（capture: true）**

```ts
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("input, textarea, [contenteditable='true']") !== null;
}

// in useEffect
const onKeyDown = (event: KeyboardEvent) => {
  if (isEditableTarget(event.target)) return;
  const action = matchKeybinding(event);
  if (!action) return;
  if (action === "sidebar.toggle") {
    event.preventDefault();
    // existing sidebar toggle
    return;
  }
  if (!selectedContextId) return;
  event.preventDefault();
  // dispatch: tab.newTerminal / split / close / focusNext
};
window.addEventListener("keydown", onKeyDown, true);
```

分屏 dispatch 伪代码：

```ts
import { nextLeafId, removeLeaf, splitLeaf } from "@/lib/terminal/pane-layout";

function splitActive(direction: "horizontal" | "vertical") {
  // load active tab
  const newLeafId = crypto.randomUUID();
  const splitId = crypto.randomUUID();
  const layout = splitLeaf(tab.layout, tab.activeLeafId, direction, newLeafId, splitId);
  onChange({
    ...tab,
    layout,
    activeLeafId: newLeafId,
    sessionByLeafId: { ...tab.sessionByLeafId, [newLeafId]: newLeafId },
  });
}

function closeActivePane() {
  const sessionId = tab.sessionByLeafId[tab.activeLeafId];
  const layout = removeLeaf(tab.layout, tab.activeLeafId);
  if (sessionId) void api.ptyKill(sessionId).catch(() => undefined);
  if (!layout) {
    // close tab (existing closeTab path)
    return;
  }
  const { [tab.activeLeafId]: _, ...rest } = tab.sessionByLeafId;
  const activeLeafId = nextLeafId(layout, tab.activeLeafId);
  onChange({ ...tab, layout, sessionByLeafId: rest, activeLeafId });
}
```

- [ ] **Step 4: 手工验收（对照 spec §10）**

- 同一 tab ⌘D / ⌘⇧D 多层分屏
- 拖分隔条后刷新，比例仍在
- 关 pane 不影响其它 PTY
- ⌘T / ⌘W / ⌘]
- v1 数据升级后旧 session 仍可 attach

- [ ] **Step 5: Commit**

```bash
git add src/components/TerminalWorkspace.tsx src/App.tsx src/lib/pane-manager
git commit -m "$(cat <<'EOF'
feat(terminal): wire multi-pane workspace and shortcuts

EOF
)"
```

---

### Task 7: 收尾与文档

**Files:**
- Modify: `changelog.md`（若项目惯例要求）
- Modify: `docs/superpowers/specs/2026-09-22-terminal-multi-pane-design.md` 状态改为「实现中/已实现」择一

- [ ] **Step 1:** 跑 `bun run test` 与 `bun run build` 全绿
- [ ] **Step 2:** 按 spec 验收清单勾选，缺口补测或修
- [ ] **Step 3:** Commit changelog/docs 状态

```bash
git add changelog.md docs/superpowers/specs/2026-09-22-terminal-multi-pane-design.md
git commit -m "$(cat <<'EOF'
docs(terminal): mark multi-pane plan implemented

EOF
)"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---|---|
| 二叉 layout + activeLeafId + sessionByLeafId | 1–2 |
| v1→v2 迁移 leaf.id=tab.id | 2–3 |
| PaneManager 命令式 xterm | 5–6 |
| 分屏/关 pane/焦点 | 1, 6 |
| PTY 按 leaf；关 tab 杀全部 | 3, 6 |
| 快捷键 ⌘T/D/⇧D/W/] + ⌘B | 4, 6 |
| 持久化 version 2 | 3 |
| 验收标准 | 6–7 |
| 外层 tab-group / 自定义键位 / zustand | 明确不做 |
