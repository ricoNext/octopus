import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderOpenIcon,
  GitBranchIcon,
  MoreHorizontalIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SettingsIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { invokeError } from "@/lib/api";
import type { BranchOptions, Project, Selection, Worktree } from "@/types";

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
  onNewWorktree: (projectId: string, startFrom?: string) => void;
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
  onListBranchOptions: (projectId: string) => Promise<BranchOptions>;
  onSwitchMainBranch: (projectId: string, branch: string) => Promise<void>;
};

type SidebarContextMenu =
  | { kind: "project"; id: string; x: number; y: number }
  | { kind: "worktree"; id: string; x: number; y: number };

type ProjectMenuItemsProps = {
  project: Project;
  onOpenCursor: (path: string) => void;
  onRevealFinder: (path: string) => void;
  onRemoveProject: (projectId: string) => void;
};

function ProjectMenuItems({
  project,
  onOpenCursor,
  onRevealFinder,
  onRemoveProject,
}: ProjectMenuItemsProps) {
  return (
    <>
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
    </>
  );
}

type WorktreeMenuItemsProps = {
  worktree: Worktree;
  onOpenCursor: (path: string) => void;
  onRevealFinder: (path: string) => void;
  onRetryWorktree: (worktreeId: string) => void;
  onAbandonWorktree: (worktreeId: string) => void;
  onRemoveMissing: (worktreeId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
};

function WorktreeMenuItems({
  worktree,
  onOpenCursor,
  onRevealFinder,
  onRetryWorktree,
  onAbandonWorktree,
  onRemoveMissing,
  onDeleteWorktree,
}: WorktreeMenuItemsProps) {
  return (
    <>
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
    </>
  );
}

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
  onListBranchOptions,
  onSwitchMainBranch,
}: SidebarProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(readCollapsedIds);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenu | null>(null);
  const [branchMenuProjectId, setBranchMenuProjectId] = useState<string | null>(null);
  const [branchOptions, setBranchOptions] = useState<BranchOptions | null>(null);
  const [branchOptionsProjectId, setBranchOptionsProjectId] = useState<string | null>(null);
  const [branchMenuVersion, setBranchMenuVersion] = useState(0);
  const [switchingProjectId, setSwitchingProjectId] = useState<string | null>(null);
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

  async function openBranchMenu(projectId: string) {
    setBranchMenuProjectId(projectId);
    setBranchMenuVersion((current) => current + 1);
    setBranchOptions(null);
    setBranchOptionsProjectId(null);
    try {
      setBranchOptions(await onListBranchOptions(projectId));
      setBranchOptionsProjectId(projectId);
    } catch (error) {
      setBranchMenuProjectId(null);
      toast.error(invokeError(error));
    }
  }

  async function switchBranch(projectId: string, branch: string) {
    setBranchMenuProjectId(null);
    setBranchOptions(null);
    setBranchOptionsProjectId(null);
    setSwitchingProjectId(projectId);
    try {
      await onSwitchMainBranch(projectId, branch);
    } catch (error) {
      toast.error(invokeError(error));
    } finally {
      setSwitchingProjectId((current) => (current === projectId ? null : current));
    }
  }

  function openContextMenu(
    event: MouseEvent<HTMLElement>,
    menu: Omit<SidebarContextMenu, "x" | "y">,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ ...menu, x: event.clientX, y: event.clientY });
  }

  const contextProject =
    contextMenu?.kind === "project"
      ? projects.find((item) => item.id === contextMenu.id) ?? null
      : null;
  const contextWorktree =
    contextMenu?.kind === "worktree"
      ? worktrees.find((item) => item.id === contextMenu.id) ?? null
      : null;

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
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="min-w-0 w-full space-y-4 overflow-hidden p-3 pr-1">
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
                  <div
                    className="flex min-w-0 items-center gap-1"
                    onContextMenu={(event) => openContextMenu(event, { kind: "project", id: project.id })}
                  >
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
                      <span className="min-w-0 truncate text-xs font-medium tracking-wide text-muted-foreground">
                        {project.name}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
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
                          <ProjectMenuItems
                            project={project}
                            onOpenCursor={onOpenCursor}
                            onRevealFinder={onRevealFinder}
                            onRemoveProject={onRemoveProject}
                          />
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {project.pathMissing ? (
                    <p className="px-2 text-xs text-destructive">路径丢失</p>
                  ) : null}
                  {collapsed ? null : (
                    <div id={contentId} className="min-w-0 space-y-1">
                      <DropdownMenu
                        open={branchMenuProjectId === project.id}
                        onOpenChange={(open) => {
                          if (!open) setBranchMenuProjectId(null);
                        }}
                      >
                        <div
                          className={cn(
                            "flex w-full min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-left text-sm",
                            mainSelected
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "hover:bg-sidebar-accent/70",
                          )}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                            onClick={() => onSelect({ kind: "main", projectId: project.id })}
                          >
                            <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate">{project.mainBranch ?? "HEAD"}</span>
                                <BranchTag>主分支</BranchTag>
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                主工作区
                              </span>
                            </span>
                          </button>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              className="shrink-0 text-muted-foreground"
                              aria-label="切换主分支"
                              title="切换主分支"
                              disabled={switchingProjectId === project.id}
                              onClick={() => void openBranchMenu(project.id)}
                            >
                              <GitBranchIcon className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                        </div>
                        <DropdownMenuContent
                            side="right"
                            align="start"
                            sideOffset={8}
                            className="min-w-80 max-w-[calc(100vw-1rem)]"
                          >
                            {!branchOptions || branchOptionsProjectId !== project.id ? (
                              <div className="px-2 py-2 text-xs text-muted-foreground">加载分支中…</div>
                            ) : (
                              <>
                                <BranchMenuSection
                                  key={`${project.id}-${branchMenuVersion}-recent`}
                                  title="最近"
                                  branches={branchOptions.recent}
                                  current={project.mainBranch}
                                  newWorktreeDisabled={creating || project.pathMissing}
                                  onSwitch={(branch) => switchBranch(project.id, branch)}
                                  onNewWorktree={(branch) => {
                                    setBranchMenuProjectId(null);
                                    onNewWorktree(project.id, branch);
                                  }}
                                />
                                <BranchMenuSection
                                  key={`${project.id}-${branchMenuVersion}-local`}
                                  title="本地"
                                  branches={branchOptions.local}
                                  current={project.mainBranch}
                                  newWorktreeDisabled={creating || project.pathMissing}
                                  onSwitch={(branch) => switchBranch(project.id, branch)}
                                  onNewWorktree={(branch) => {
                                    setBranchMenuProjectId(null);
                                    onNewWorktree(project.id, branch);
                                  }}
                                />
                                <BranchMenuSection
                                  key={`${project.id}-${branchMenuVersion}-remote`}
                                  title="远端"
                                  branches={branchOptions.remote}
                                  current={project.mainBranch}
                                  newWorktreeDisabled={creating || project.pathMissing}
                                  onSwitch={(branch) => switchBranch(project.id, branch)}
                                  onNewWorktree={(branch) => {
                                    setBranchMenuProjectId(null);
                                    onNewWorktree(project.id, branch);
                                  }}
                                />
                              </>
                            )}
                          </DropdownMenuContent>
                      </DropdownMenu>
                      {trees.map((worktree) => {
                        const selected =
                          selection.kind === "worktree" && selection.worktreeId === worktree.id;
                        return (
                          <div
                            key={worktree.id}
                            className="grid min-w-0 grid-cols-[minmax(0,1fr)_24px] items-start gap-1"
                            onContextMenu={(event) =>
                              openContextMenu(event, { kind: "worktree", id: worktree.id })
                            }
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
                                <WorktreeMenuItems
                                  worktree={worktree}
                                  onOpenCursor={onOpenCursor}
                                  onRevealFinder={onRevealFinder}
                                  onRetryWorktree={onRetryWorktree}
                                  onAbandonWorktree={onAbandonWorktree}
                                  onRemoveMissing={onRemoveMissing}
                                  onDeleteWorktree={onDeleteWorktree}
                                />
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
          </div>
          <DropdownMenu
            open={Boolean(contextMenu && (contextProject || contextWorktree))}
            onOpenChange={(open) => !open && setContextMenu(null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="fixed z-0 size-px border-0 bg-transparent p-0 opacity-0 outline-none"
                style={{
                  left: contextMenu?.x ?? 0,
                  top: contextMenu?.y ?? 0,
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={4}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {contextProject ? (
                <ProjectMenuItems
                  project={contextProject}
                  onOpenCursor={onOpenCursor}
                  onRevealFinder={onRevealFinder}
                  onRemoveProject={onRemoveProject}
                />
              ) : contextWorktree ? (
                <WorktreeMenuItems
                  worktree={contextWorktree}
                  onOpenCursor={onOpenCursor}
                  onRevealFinder={onRevealFinder}
                  onRetryWorktree={onRetryWorktree}
                  onAbandonWorktree={onAbandonWorktree}
                  onRemoveMissing={onRemoveMissing}
                  onDeleteWorktree={onDeleteWorktree}
                />
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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

function BranchMenuSection({
  title,
  branches,
  current,
  newWorktreeDisabled,
  onSwitch,
  onNewWorktree,
}: {
  title: string;
  branches: string[];
  current: string | null;
  newWorktreeDisabled: boolean;
  onSwitch: (branch: string) => Promise<void>;
  onNewWorktree: (branch: string) => void;
}) {
  const [expanded, setExpanded] = useState(title === "最近");

  if (branches.length === 0) {
    return null;
  }
  return (
    <>
      <DropdownMenuItem
        className="font-medium"
        onSelect={(event) => {
          event.preventDefault();
          setExpanded((current) => !current);
        }}
      >
        {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        {title}
        <span className="ml-auto text-xs text-muted-foreground">{branches.length}</span>
      </DropdownMenuItem>
      {expanded
        ? branches.map((branch) => (
            <DropdownMenuSub key={`${title}-${branch}`}>
              <DropdownMenuSubTrigger
                className={cn("min-w-0", current === branch && "font-medium")}
              >
                <span className="min-w-0 flex-1 truncate" title={branch}>
                  {branch}
                </span>
                {current === branch ? (
                  <span className="shrink-0 text-xs text-muted-foreground">当前</span>
                ) : null}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent sideOffset={6} className="min-w-52">
                <DropdownMenuItem
                  disabled={current === branch}
                  onSelect={() => void onSwitch(branch)}
                >
                  <GitBranchIcon />
                  切换到此分支
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={newWorktreeDisabled}
                  className="whitespace-nowrap"
                  onSelect={() => onNewWorktree(branch)}
                >
                  <PlusIcon />
                  基于此分支新建工作树
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        : null}
      <DropdownMenuSeparator />
    </>
  );
}
