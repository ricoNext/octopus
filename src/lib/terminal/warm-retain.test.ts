import { describe, expect, it } from "vitest";
import {
  TERMINAL_CONTEXT_HOT_RETAIN_LIMIT,
  TERMINAL_TAB_HOT_RETAIN_LIMIT,
  parseWarmMountKey,
  selectWarmMountKeys,
  warmMountKey,
} from "./warm-retain";

describe("warm-retain", () => {
  it("warmMountKey / parseWarmMountKey round-trip", () => {
    const key = warmMountKey("ctx-a", "tab-1");
    expect(key).toBe("ctx-a::tab-1");
    expect(parseWarmMountKey(key)).toEqual({ contextId: "ctx-a", tabId: "tab-1" });
  });

  it("disabled retains every tab of every visited context", () => {
    const keys = selectWarmMountKeys({
      enabled: false,
      visitedOldestToNewest: ["c1", "c2"],
      selectedContextId: "c2",
      tabsByContext: {
        c1: [{ id: "t1" }, { id: "t2" }],
        c2: [{ id: "t3" }],
        c3: [{ id: "orphan" }],
      },
      activeTabByContext: { c1: "t1", c2: "t3" },
      tabActivationOldestToNewest: [],
    });
    expect([...keys].sort()).toEqual(
      ["c1::t1", "c1::t2", "c2::t3"].sort(),
    );
  });

  it("selected context is always retained even when beyond context cap", () => {
    const visited = ["c1", "c2", "c3", "c4", "c5"];
    const tabsByContext = Object.fromEntries(
      visited.map((id) => [id, [{ id: `${id}-tab` }]]),
    );
    const activeTabByContext = Object.fromEntries(
      visited.map((id) => [id, `${id}-tab`]),
    );
    const keys = selectWarmMountKeys({
      enabled: true,
      visitedOldestToNewest: visited,
      selectedContextId: "c1",
      tabsByContext,
      activeTabByContext,
      tabActivationOldestToNewest: [],
      contextLimit: 4,
    });
    const contexts = new Set([...keys].map((k) => parseWarmMountKey(k).contextId));
    expect(contexts.has("c1")).toBe(true);
    expect(contexts.size).toBe(TERMINAL_CONTEXT_HOT_RETAIN_LIMIT);
    expect(contexts.has("c5")).toBe(true);
    expect(contexts.has("c4")).toBe(true);
    expect(contexts.has("c3")).toBe(true);
    expect(contexts.has("c2")).toBe(false);
  });

  it("context cap keeps newest visited besides selected", () => {
    const visited = ["old", "mid", "new", "newest"];
    const tabsByContext = Object.fromEntries(
      visited.map((id) => [id, [{ id: "t" }]]),
    );
    const keys = selectWarmMountKeys({
      enabled: true,
      visitedOldestToNewest: visited,
      selectedContextId: "newest",
      tabsByContext,
      activeTabByContext: Object.fromEntries(visited.map((id) => [id, "t"])),
      tabActivationOldestToNewest: [],
      contextLimit: 3,
    });
    const contexts = new Set([...keys].map((k) => parseWarmMountKey(k).contextId));
    expect(contexts).toEqual(new Set(["newest", "new", "mid"]));
    expect(contexts.has("old")).toBe(false);
  });

  it("tab cap keeps active + newest activations; skips missing tabs", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }, { id: "f" }, { id: "g" }];
    const keys = selectWarmMountKeys({
      enabled: true,
      visitedOldestToNewest: ["ctx"],
      selectedContextId: "ctx",
      tabsByContext: { ctx: tabs },
      activeTabByContext: { ctx: "a" },
      tabActivationOldestToNewest: [
        warmMountKey("ctx", "gone"),
        warmMountKey("ctx", "g"),
        warmMountKey("ctx", "f"),
        warmMountKey("ctx", "e"),
        warmMountKey("ctx", "d"),
        warmMountKey("ctx", "c"),
        warmMountKey("ctx", "b"),
        warmMountKey("other", "x"),
      ],
      tabLimit: TERMINAL_TAB_HOT_RETAIN_LIMIT,
    });
    expect(keys.has(warmMountKey("ctx", "a"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "gone"))).toBe(false);
    expect(keys.size).toBe(TERMINAL_TAB_HOT_RETAIN_LIMIT);
    // newest activations fill remaining slots after active
    expect(keys.has(warmMountKey("ctx", "b"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "c"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "d"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "e"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "f"))).toBe(true);
    expect(keys.has(warmMountKey("ctx", "g"))).toBe(false);
  });

  it("exports default limits 4 / 6", () => {
    expect(TERMINAL_CONTEXT_HOT_RETAIN_LIMIT).toBe(4);
    expect(TERMINAL_TAB_HOT_RETAIN_LIMIT).toBe(6);
  });
});
