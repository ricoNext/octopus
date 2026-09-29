import { describe, expect, it } from "vitest";
import {
  flattenVisible,
  joinRel,
  setExpanded,
  upsertChildren,
  type TreeNode,
} from "./tree-model";

describe("tree-model", () => {
  it("joins rel", () => {
    expect(joinRel("", "src")).toBe("src");
    expect(joinRel("src", "a.ts")).toBe("src/a.ts");
  });

  it("flattens only expanded", () => {
    const roots: TreeNode[] = [
      {
        relPath: "a",
        name: "a",
        kind: "dir",
        depth: 0,
        expanded: true,
        children: [
          { relPath: "a/b", name: "b", kind: "file", depth: 1, expanded: false },
        ],
      },
      { relPath: "c", name: "c", kind: "file", depth: 0, expanded: false },
    ];
    expect(flattenVisible(roots).map((r) => r.relPath)).toEqual(["a", "a/b", "c"]);
  });

  it("does not flatten children when collapsed or not loaded", () => {
    const roots: TreeNode[] = [
      {
        relPath: "a",
        name: "a",
        kind: "dir",
        depth: 0,
        expanded: false,
        children: [
          { relPath: "a/b", name: "b", kind: "file", depth: 1, expanded: false },
        ],
      },
      {
        relPath: "d",
        name: "d",
        kind: "dir",
        depth: 0,
        expanded: true,
        children: null,
      },
    ];
    expect(flattenVisible(roots).map((r) => r.relPath)).toEqual(["a", "d"]);
  });

  it("upsertChildren replaces children at relPath immutably", () => {
    const roots: TreeNode[] = [
      {
        relPath: "a",
        name: "a",
        kind: "dir",
        depth: 0,
        expanded: true,
        children: null,
        loading: true,
      },
      { relPath: "c", name: "c", kind: "file", depth: 0, expanded: false },
    ];
    const kids: TreeNode[] = [
      { relPath: "a/b", name: "b", kind: "file", depth: 1, expanded: false },
    ];
    const next = upsertChildren(roots, "a", kids);
    expect(next).not.toBe(roots);
    expect(roots[0].children).toBeNull();
    expect(next[0].children).toEqual(kids);
    expect(next[0].loading).toBeUndefined();
    expect(next[1]).toBe(roots[1]);
  });

  it("setExpanded toggles expanded immutably", () => {
    const roots: TreeNode[] = [
      {
        relPath: "a",
        name: "a",
        kind: "dir",
        depth: 0,
        expanded: false,
        children: [
          { relPath: "a/b", name: "b", kind: "dir", depth: 1, expanded: false },
        ],
      },
    ];
    const next = setExpanded(roots, "a/b", true);
    expect(next).not.toBe(roots);
    expect(next[0].children![0].expanded).toBe(true);
    expect(roots[0].children![0].expanded).toBe(false);
    expect(next[0].expanded).toBe(false);
  });
});
