import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api, invokeError } from "@/lib/api";
import {
  flattenVisible,
  joinRel,
  setExpanded,
  upsertChildren,
  type TreeNode,
} from "@/lib/files/tree-model";
import { cn } from "@/lib/utils";
import type { FsDirEntry } from "@/types";

type FilesModuleProps = {
  rootPath?: string | null;
  onOpenFilePreview?: (args: { rootPath: string; relPath: string }) => void;
};

function entriesToNodes(entries: FsDirEntry[], parentRel: string, depth: number): TreeNode[] {
  return entries.map((entry) => {
    const node: TreeNode = {
      relPath: joinRel(parentRel, entry.name),
      name: entry.name,
      kind: entry.kind,
      depth,
      expanded: false,
    };
    if (entry.kind === "dir") {
      node.children = null;
    }
    return node;
  });
}

function patchNode(
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
  return found ? result : nodes;
}

function findNode(nodes: TreeNode[], relPath: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.relPath === relPath) {
      return node;
    }
    if (Array.isArray(node.children)) {
      const hit = findNode(node.children, relPath);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

export function FilesModule({ rootPath, onOpenFilePreview }: FilesModuleProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const loadGenRef = useRef(0);

  const loadRoot = useCallback(async (path: string) => {
    const gen = ++loadGenRef.current;
    setRootLoading(true);
    setRootError(null);
    setRoots([]);
    try {
      const entries = await api.fsReadDir(path, "");
      if (gen !== loadGenRef.current) {
        return;
      }
      setRoots(entriesToNodes(entries, "", 0));
    } catch (error) {
      if (gen !== loadGenRef.current) {
        return;
      }
      setRootError(invokeError(error));
      setRoots([]);
    } finally {
      if (gen === loadGenRef.current) {
        setRootLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!rootPath) {
      loadGenRef.current += 1;
      setRoots([]);
      setRootError(null);
      setRootLoading(false);
      return;
    }
    void loadRoot(rootPath);
  }, [rootPath, loadRoot]);

  const flatRows = useMemo(() => flattenVisible(roots), [roots]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  const handleRefresh = () => {
    if (!rootPath) {
      return;
    }
    void loadRoot(rootPath);
  };

  const handleRowClick = async (relPath: string, kind: string) => {
    if (!rootPath) {
      return;
    }
    if (kind !== "dir") {
      if (kind === "file") {
        onOpenFilePreview?.({ rootPath, relPath });
      }
      return;
    }

    const node = findNode(roots, relPath);
    if (!node) {
      return;
    }
    if (node.expanded) {
      setRoots((prev) => setExpanded(prev, relPath, false));
      return;
    }

    const needsLoad = node.children === null && !node.loading;
    const depth = node.depth;
    setRoots((prev) => {
      let next = setExpanded(prev, relPath, true);
      if (needsLoad) {
        next = patchNode(next, relPath, (current) => {
          const updated: TreeNode = { ...current, loading: true };
          delete updated.error;
          return updated;
        });
      }
      return next;
    });

    if (!needsLoad) {
      return;
    }

    try {
      const entries = await api.fsReadDir(rootPath, relPath);
      setRoots((prev) =>
        upsertChildren(prev, relPath, entriesToNodes(entries, relPath, depth + 1)),
      );
    } catch (error) {
      const message = invokeError(error);
      setRoots((prev) =>
        patchNode(prev, relPath, (current) => {
          const updated: TreeNode = { ...current, error: message };
          delete updated.loading;
          return updated;
        }),
      );
    }
  };

  if (!rootPath) {
    return (
      <div className="rounded-md border border-dashed border-sidebar-border bg-sidebar-accent/40 px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">选择左侧主仓或工作树以浏览文件</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={rootPath}>
          {rootPath.split("/").filter(Boolean).pop() || rootPath}
        </p>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={handleRefresh}
          disabled={rootLoading}
          aria-label="刷新"
          title="刷新"
        >
          <RefreshCwIcon className={cn("size-3.5", rootLoading && "animate-spin")} />
        </Button>
      </div>

      {rootError ? (
        <div className="rounded-md border border-dashed border-destructive/40 bg-destructive/5 px-3 py-4 text-center">
          <p className="text-sm text-destructive">加载失败：{rootError}</p>
        </div>
      ) : null}

      {!rootError && rootLoading && roots.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          加载中…
        </div>
      ) : null}

      {!rootError && !(rootLoading && roots.length === 0) ? (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = flatRows[virtualRow.index]!;
              const isDir = row.kind === "dir";
              const nodeError = findNode(roots, row.relPath)?.error;
              return (
                <button
                  key={row.relPath}
                  type="button"
                  className="absolute left-0 top-0 flex w-full items-center gap-1 truncate rounded-md px-1 text-left text-xs hover:bg-sidebar-accent"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    paddingLeft: `${4 + row.depth * 12}px`,
                  }}
                  onClick={() => void handleRowClick(row.relPath, row.kind)}
                  title={nodeError ? `加载失败：${nodeError}` : row.relPath}
                >
                  {isDir ? (
                    row.expanded ? (
                      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )
                  ) : (
                    <span className="inline-block size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {row.loading ? (
                    <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : isDir ? (
                    row.expanded ? (
                      <FolderOpenIcon className="size-3.5 shrink-0 text-amber-600/80" />
                    ) : (
                      <FolderIcon className="size-3.5 shrink-0 text-amber-600/80" />
                    )
                  ) : (
                    <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={cn("truncate", nodeError && "text-destructive")}>{row.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
