import {
  ChevronRightIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SettingsIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Project, Selection, Worktree } from "@/types";

const COLLAPSED_KEY = "octopus.sidebar.collapsedProjectIds";

function readCollapsedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedIds(ids: Set<string>) {
  localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
}

function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest("button, a, input, textarea, select, [role='button']")) {
    return;
  }
  void getCurrentWindow().startDragging().catch(() => undefined);
}

type SidebarProps = {
  projects: Project[];
  worktrees: Worktree[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onAddProject: () => void;
  onNewWorktree: (projectId: string) => void;
  onRemoveProject: (projectId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onRetryWorktree: (worktreeId: string) => void;
  onAbandonWorktree: (worktreeId: string) => void;
  onRemoveMissing: (worktreeId: string) => void;
  onOpenCursor: (path: string) => void;
  onRevealFinder: (path: string) => void;
  settingsActive?: boolean;
  onOpenSettings: () => void;
  collapsed?: boolean;
  onToggleCollapse: () => void;
};

export function Sidebar({
  projects,
  worktrees,
  selection,
  onSelect,
  onAddProject,
  onNewWorktree,
  onRemoveProject,
  onDeleteWorktree,
  onRetryWorktree,
  onAbandonWorktree,
  onRemoveMissing,
  onOpenCursor,
  onRevealFinder,
  settingsActive = false,
  onOpenSettings,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(readCollapsedIds);
  const treeCountsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    const existing = new Set(projects.map((item) => item.id));
    writeCollapsedIds(new Set([...collapsedIds].filter((id) => existing.has(id))));
  }, [collapsedIds, projects]);

  useEffect(() => {
    const nextCounts: Record<string, number> = {};
    const toExpand: string[] = [];
    for (const project of projects) {
      const count = worktrees.filter((item) => item.projectId === project.id).length;
      nextCounts[project.id] = count;
      const previous = treeCountsRef.current[project.id];
      if (previous !== undefined && count > previous) {
        toExpand.push(project.id);
      }
    }
    treeCountsRef.current = nextCounts;
    if (toExpand.length === 0) {
      return;
    }
    setCollapsedIds((current) => {
      const next = new Set(current);
      for (const id of toExpand) {
        next.delete(id);
      }
      return next;
    });
  }, [projects, worktrees]);

  function toggleCollapsed(projectId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  return (
    <aside
      className="flex h-full w-full shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
      aria-hidden={collapsed}
    >
      {!collapsed ? <>
        <div
          className="flex h-10 min-h-10 items-center justify-between gap-2 border-b px-3 py-1"
            data-tauri-drag-region
            onMouseDown={startWindowDrag}
          >
            <div className="flex min-w-0 items-center">
              <div className="titlebar-traffic-light-pad" aria-hidden="true" />
              <p className="truncate text-sm font-medium">octopus</p>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={onToggleCollapse}
              aria-label="折叠侧栏"
              title="折叠侧栏"
            >
              <PanelLeftCloseIcon />
            </Button>
          </div>
          <ScrollArea className="min-w-0 flex-1">
            <div className="min-w-0 space-y-4 overflow-hidden p-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  项目
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0"
                  onClick={onAddProject}
                  aria-label="添加项目"
                  title="添加项目"
                >
                  <PlusIcon />
                </Button>
              </div>
              {projects.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">
                  还没有项目。添加一个本地 git 仓库开始。
                </p>
              ) : (
                projects.map((project) => {
              const trees = worktrees.filter((item) => item.projectId === project.id);
              const creating = trees.some((item) => item.status === "creating");
              const mainSelected =
                selection.kind === "main" && selection.projectId === project.id;
              const collapsed = collapsedIds.has(project.id);
              const contentId = `project-${project.id}-items`;
              return (
                <section key={project.id} className="min-w-0 space-y-1">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px_24px] items-center gap-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-sidebar-accent/70"
                      aria-expanded={!collapsed}
                      aria-controls={contentId}
                      aria-label={collapsed ? `展开 ${project.name}` : `折叠 ${project.name}`}
                      onClick={() => toggleCollapsed(project.id)}
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          !collapsed && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {project.name}
                      </span>
                    </button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0"
                      disabled={creating || project.pathMissing}
                      onClick={() => onNewWorktree(project.id)}
                      aria-label="新建工作树"
                    >
                      <PlusIcon />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="shrink-0"
                          aria-label="项目操作"
                        >
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => onOpenCursor(project.rootPath)}
                          disabled={project.pathMissing}
                        >
                          在 Cursor 中打开
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onRevealFinder(project.rootPath)}
                          disabled={project.pathMissing}
                        >
                          在访达中显示
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRemoveProject(project.id)}
                        >
                          取消登记项目
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {project.pathMissing ? (
                    <p className="px-2 text-xs text-destructive">路径丢失</p>
                  ) : null}
                  {collapsed ? null : (
                    <div id={contentId} className="space-y-1">
                      <button
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                          mainSelected
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "hover:bg-sidebar-accent/70",
                        )}
                        onClick={() => onSelect({ kind: "main", projectId: project.id })}
                      >
                        <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{project.mainBranch ?? "HEAD"}</span>
                            <BranchTag>主分支</BranchTag>
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            主工作区
                          </span>
                        </span>
                      </button>
                      {trees.map((worktree) => {
                        const selected =
                          selection.kind === "worktree" && selection.worktreeId === worktree.id;
                        return (
                          <div
                            key={worktree.id}
                            className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px] items-start gap-1"
                          >
                            <button
                              type="button"
                              className={cn(
                                "flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                                selected
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "hover:bg-sidebar-accent/70",
                              )}
                              onClick={() => onSelect({ kind: "worktree", worktreeId: worktree.id })}
                            >
                              <SquareTerminalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                              <span className="min-w-0">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate">{worktree.branchName}</span>
                                  <BranchTag>worktree</BranchTag>
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {worktree.origin === "app" && worktree.startFrom
                                    ? `基于 ${worktree.startFrom}`
                                    : "来源分支未记录"}
                                  {statusLabel(worktree)}
                                </span>
                              </span>
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  className="shrink-0"
                                  aria-label="工作树操作"
                                >
                                  <MoreHorizontalIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => onOpenCursor(worktree.path)}
                                  disabled={worktree.missing}
                                >
                                  在 Cursor 中打开
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => onRevealFinder(worktree.path)}
                                  disabled={worktree.missing}
                                >
                                  在访达中显示
                                </DropdownMenuItem>
                                {worktree.status === "error" ? (
                                  <>
                                    <DropdownMenuItem onClick={() => onRetryWorktree(worktree.id)}>
                                      重试
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onAbandonWorktree(worktree.id)}>
                                      放弃
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                                {worktree.missing ? (
                                  <DropdownMenuItem onClick={() => onRemoveMissing(worktree.id)}>
                                    从列表移除
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => onDeleteWorktree(worktree.id)}
                                  >
                                    <Trash2Icon />
                                    删除工作树
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
                })
              )}
            </div>
          </ScrollArea>
          <div className="border-t p-2">
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                settingsActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
              onClick={onOpenSettings}
              aria-current={settingsActive ? "page" : undefined}
            >
              <SettingsIcon className="size-4 shrink-0" />
              <span className="truncate">设置</span>
            </button>
          </div>
      </> : null}
    </aside>
  );
}

function BranchTag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded border border-sidebar-border px-1 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </span>
  );
}

function statusLabel(worktree: Worktree): string {
  if (worktree.missing) {
    return " · 丢失";
  }
  if (worktree.status === "creating") {
    return " · 创建中";
  }
  if (worktree.status === "error") {
    return " · 出错";
  }
  return "";
}
