import { describe, expect, it } from "vitest";
import {
  createTerminalTab,
  nextTerminalTabIndex,
  migrateTerminalTab,
  migrateTabsByContext,
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
