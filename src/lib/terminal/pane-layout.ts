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
