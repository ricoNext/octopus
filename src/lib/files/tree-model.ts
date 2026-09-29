export type TreeNode = {
  relPath: string; // "" for root children joined as name
  name: string;
  kind: string;
  depth: number;
  expanded: boolean;
  children?: TreeNode[] | null; // null = not loaded
  loading?: boolean;
  error?: string;
};

export type FlatRow = {
  relPath: string;
  name: string;
  kind: string;
  depth: number;
  expanded: boolean;
  loading?: boolean;
};

export function joinRel(parent: string, name: string): string {
  if (!parent) return name;
  return `${parent}/${name}`;
}

function toFlatRow(node: TreeNode): FlatRow {
  const row: FlatRow = {
    relPath: node.relPath,
    name: node.name,
    kind: node.kind,
    depth: node.depth,
    expanded: node.expanded,
  };
  if (node.loading !== undefined) {
    row.loading = node.loading;
  }
  return row;
}

export function flattenVisible(nodes: TreeNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      rows.push(toFlatRow(node));
      if (node.expanded && Array.isArray(node.children)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return rows;
}

function mapNodeAt(
  nodes: TreeNode[],
  relPath: string,
  update: (node: TreeNode) => TreeNode,
): TreeNode[] {
  let found = false;
  const mapList = (list: TreeNode[]): TreeNode[] => {
    let changed = false;
    const next = list.map((node) => {
      if (node.relPath === relPath) {
        found = true;
        changed = true;
        return update(node);
      }
      if (Array.isArray(node.children)) {
        const children = mapList(node.children);
        if (children !== node.children) {
          changed = true;
          return { ...node, children };
        }
      }
      return node;
    });
    return changed ? next : list;
  };
  const result = mapList(nodes);
  if (!found) return nodes;
  return result;
}

export function upsertChildren(
  nodes: TreeNode[],
  relPath: string,
  children: TreeNode[],
): TreeNode[] {
  return mapNodeAt(nodes, relPath, (node) => {
    const next: TreeNode = { ...node, children };
    delete next.loading;
    delete next.error;
    return next;
  });
}

export function setExpanded(
  nodes: TreeNode[],
  relPath: string,
  expanded: boolean,
): TreeNode[] {
  return mapNodeAt(nodes, relPath, (node) => ({ ...node, expanded }));
}
