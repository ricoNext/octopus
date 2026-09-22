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
    expect(listLeaves(root)).toEqual(["a", "b", "c"]);
    expect(nextLeafId(root, "a")).toBe("b");
    expect(nextLeafId(root, "c")).toBe("a");
  });
});
