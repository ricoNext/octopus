import { describe, expect, it } from "vitest";
import {
  closeFileTabResult,
  createFileTab,
  createTerminalTab,
  findFileTabByPath,
  isFileTab,
  isTerminalTab,
  migrateCenterTab,
  migrateTabsByContext,
  migrateTerminalTab,
  nextTerminalTabIndex,
  sessionIdsForTab,
} from "./terminal-tab";

describe("terminal-tab", () => {
  it("nextTerminalTabIndex reuses lowest free ordinal like Orca", () => {
    expect(nextTerminalTabIndex(["终端 2"])).toBe(1);
    expect(nextTerminalTabIndex(["终端 1", "终端 2"])).toBe(3);
    expect(nextTerminalTabIndex(["终端 1", "终端 3"])).toBe(2);
    expect(nextTerminalTabIndex(["自定义", "终端 5"])).toBe(1);
    expect(nextTerminalTabIndex([])).toBe(1);
  });

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
      kind: "terminal",
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

describe("center-tab", () => {
  it("createTerminalTab sets kind terminal", () => {
    const tab = createTerminalTab(1);
    expect(tab.kind).toBe("terminal");
    expect(isTerminalTab(tab)).toBe(true);
  });

  it("createFileTab derives label from basename", () => {
    const tab = createFileTab({ rootPath: "/repo", relPath: "src/App.tsx" });
    expect(tab).toMatchObject({
      kind: "file",
      rootPath: "/repo",
      relPath: "src/App.tsx",
      label: "App.tsx",
    });
    expect(tab.id).toBeTruthy();
    expect(isFileTab(tab)).toBe(true);
  });

  it("migrate missing kind → terminal (v2 shape)", () => {
    const tab = migrateCenterTab({
      id: "t1",
      label: "终端 1",
      layout: { type: "leaf", id: "l1" },
      activeLeafId: "l1",
      sessionByLeafId: { l1: "l1" },
    });
    expect(tab?.kind).toBe("terminal");
    expect(tab && isTerminalTab(tab) && tab.activeLeafId).toBe("l1");
  });

  it("migrate missing kind v1 {id,label} → terminal", () => {
    const tab = migrateCenterTab({ id: "old", label: "终端 1" });
    expect(tab?.kind).toBe("terminal");
  });

  it("migrate file tab keeps paths; ignores content blob; derives label", () => {
    const tab = migrateCenterTab({
      kind: "file",
      id: "f1",
      rootPath: "/repo",
      relPath: "a/b.ts",
      content: "STALE",
    });
    expect(tab).toEqual({
      kind: "file",
      id: "f1",
      label: "b.ts",
      rootPath: "/repo",
      relPath: "a/b.ts",
    });
  });

  it("migrate skips invalid file entries; ensures ≥1 terminal per context", () => {
    const out = migrateTabsByContext({
      ctx: [
        { kind: "file", id: "bad" }, // missing paths
        {
          kind: "file",
          id: "f1",
          rootPath: "/r",
          relPath: "x.ts",
          label: "x.ts",
        },
      ],
    });
    expect(out.ctx!.some(isTerminalTab)).toBe(true);
    expect(out.ctx!.filter(isFileTab)).toHaveLength(1);
  });

  it("findFileTabByPath matches root+rel within list", () => {
    const tabs = [
      createTerminalTab(1),
      createFileTab({ rootPath: "/r", relPath: "a.ts" }),
      createFileTab({ rootPath: "/r", relPath: "b.ts" }),
    ];
    expect(findFileTabByPath(tabs, "/r", "b.ts")?.relPath).toBe("b.ts");
    expect(findFileTabByPath(tabs, "/r", "missing.ts")).toBeUndefined();
  });

  it("closeFileTabResult prefers previous neighbor", () => {
    const t1 = createTerminalTab(1);
    const f1 = createFileTab({ rootPath: "/r", relPath: "a.ts", id: "fa" });
    const f2 = createFileTab({ rootPath: "/r", relPath: "b.ts", id: "fb" });
    const tabs = [t1, f1, f2];
    const result = closeFileTabResult(tabs, "fb");
    expect(result?.tabs.map((t) => t.id)).toEqual([t1.id, "fa"]);
    expect(result?.activeTabId).toBe("fa");
  });

  it("closeFileTabResult on last remaining tab ensures a terminal", () => {
    const f1 = createFileTab({ rootPath: "/r", relPath: "only.ts", id: "fa" });
    const result = closeFileTabResult([f1], "fa");
    expect(result?.tabs).toHaveLength(1);
    expect(result?.tabs[0] && isTerminalTab(result.tabs[0])).toBe(true);
    expect(result?.activeTabId).toBe(result?.tabs[0]?.id);
  });
});
