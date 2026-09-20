import {
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";

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
}: SidebarProps) {
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
        <div>
          <p className="text-sm font-medium">工作树编排</p>
          <p className="text-xs text-muted-foreground">本地 git worktree</p>
        </div>
        <Button size="sm" onClick={onAddProject}>
          添加项目
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-4 p-3">
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
              return (
                <section key={project.id} className="space-y-1">
                  <div className="flex items-center gap-1">
                    <p className="min-w-0 flex-1 truncate px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {project.name}
                    </p>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={creating || project.pathMissing}
                      onClick={() => onNewWorktree(project.id)}
                      aria-label="新建工作树"
                    >
                      <PlusIcon />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-xs" variant="ghost" aria-label="项目操作">
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
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      mainSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/70",
                    )}
                    onClick={() => onSelect({ kind: "main", projectId: project.id })}
                  >
                    <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">主工作区</span>
                  </button>
                  {trees.map((worktree) => {
                    const selected =
                      selection.kind === "worktree" && selection.worktreeId === worktree.id;
                    return (
                      <div key={worktree.id} className="flex items-start gap-1">
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
                            <span className="block truncate">{worktree.displayName}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {worktree.branchName}
                              {statusLabel(worktree)}
                            </span>
                          </span>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-xs" variant="ghost" aria-label="工作树操作">
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
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
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
