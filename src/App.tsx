import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CopyableError } from "@/components/CopyableError";
import { DiffPane } from "@/components/DiffPane";
import { Sidebar } from "@/components/Sidebar";
import { TerminalPane } from "@/components/TerminalPane";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, invokeError } from "@/lib/api";
import type {
  AppSnapshot,
  ExistingWorktree,
  InspectResult,
  Project,
  Selection,
  Worktree,
} from "@/types";

const emptySnapshot: AppSnapshot = { projects: [], worktrees: [] };

export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [selection, setSelection] = useState<Selection>({ kind: "empty" });
  const [visited, setVisited] = useState<string[]>([]);
  const [diffCollapsed, setDiffCollapsed] = useState(false);
  const [diffText, setDiffText] = useState("");
  const [diffEmpty, setDiffEmpty] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});

  const [createProjectId, setCreateProjectId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [localBranches, setLocalBranches] = useState<string[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<Worktree | null>(null);
  const [deleteBranchToo, setDeleteBranchToo] = useState(false);
  const [forceStderr, setForceStderr] = useState<string | null>(null);
  const deleteTargetRef = useRef<Worktree | null>(null);
  const deleteBranchTooRef = useRef(false);

  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [removeProjectCount, setRemoveProjectCount] = useState(0);

  const projects = snapshot.projects;
  const worktrees = snapshot.worktrees;
  const selectedWorktree = useMemo(
    () =>
      selection.kind === "worktree"
        ? worktrees.find((item) => item.id === selection.worktreeId) ?? null
        : null,
    [selection, worktrees],
  );
  const selectedProject = useMemo(() => {
    if (selection.kind === "main") {
      return projects.find((item) => item.id === selection.projectId) ?? null;
    }
    if (selectedWorktree) {
      return projects.find((item) => item.id === selectedWorktree.projectId) ?? null;
    }
    return null;
  }, [projects, selectedWorktree, selection]);

  const applySnapshot = useCallback((next: AppSnapshot, focusedWorktreeId?: string | null) => {
    setSnapshot(next);
    if (focusedWorktreeId) {
      setSelection({ kind: "worktree", worktreeId: focusedWorktreeId });
      setVisited((current) =>
        current.includes(focusedWorktreeId) ? current : [...current, focusedWorktreeId],
      );
      return;
    }
    setSelection((current) => pruneSelection(current, next));
    setVisited((current) =>
      current.filter((id) => next.worktrees.some((item) => item.id === id)),
    );
  }, []);

  useEffect(() => {
    void api
      .loadSnapshot()
      .then((next) => applySnapshot(next))
      .catch((error) => toast.error(invokeError(error)));
  }, [applySnapshot]);

  useEffect(() => {
    if (selection.kind === "worktree") {
      setVisited((current) =>
        current.includes(selection.worktreeId) ? current : [...current, selection.worktreeId],
      );
    }
  }, [selection]);

  const refreshDiff = useCallback(async (worktreeId: string) => {
    setDiffLoading(true);
    setDiffError(null);
    try {
      const result = await api.getDiff(worktreeId);
      setDiffText(result.text);
      setDiffEmpty(result.empty);
    } catch (error) {
      setDiffError(invokeError(error));
      setDiffText("");
      setDiffEmpty(true);
    } finally {
      setDiffLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWorktree?.status === "ready" && !selectedWorktree.missing) {
      void refreshDiff(selectedWorktree.id);
      return;
    }
    setDiffText("");
    setDiffEmpty(true);
    setDiffError(null);
  }, [refreshDiff, selectedWorktree]);

  async function handleAddProject() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择 git 仓库",
      });
      if (!selected || Array.isArray(selected)) {
        return;
      }
      const result = await api.inspectRepo(selected);
      if (result.usedFallbackDefaultBranch) {
        toast.message("未读到默认分支，已用 main");
      }
      if (result.existingWorktrees.length === 0) {
        const mutation = await api.addProject(result.rootPath, []);
        applySnapshot(mutation.snapshot);
        const project = mutation.snapshot.projects.find(
          (item) => item.rootPath === result.rootPath,
        );
        if (project) {
          setSelection({ kind: "main", projectId: project.id });
        }
        return;
      }
      setInspect(result);
      setImportSelected({});
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function confirmAddProject() {
    if (!inspect) {
      return;
    }
    const importPaths = inspect.existingWorktrees
      .filter((item) => importSelected[item.path])
      .map((item) => item.path);
    try {
      const mutation = await api.addProject(inspect.rootPath, importPaths);
      applySnapshot(mutation.snapshot);
      const project = mutation.snapshot.projects.find(
        (item) => item.rootPath === inspect.rootPath,
      );
      if (project) {
        setSelection({ kind: "main", projectId: project.id });
      }
      setInspect(null);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function openCreate(projectId: string) {
    try {
      const branches = await api.listLocalBranches(projectId);
      const project = projects.find((item) => item.id === projectId);
      setLocalBranches(branches);
      setCreateProjectId(projectId);
      setDisplayName("");
      setBranchName("");
      setStartFrom(project?.defaultBranch ?? branches[0] ?? "");
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function confirmCreate() {
    if (!createProjectId) {
      return;
    }
    try {
      const mutation = await api.createWorktree(
        createProjectId,
        displayName,
        branchName.trim() ? branchName.trim() : null,
        startFrom.trim() ? startFrom.trim() : null,
      );
      applySnapshot(mutation.snapshot, mutation.focusedWorktreeId);
      if (mutation.error) {
        toast.error(mutation.error);
      }
      setCreateProjectId(null);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function handleRetry(worktreeId: string) {
    try {
      const mutation = await api.retryWorktree(worktreeId);
      applySnapshot(mutation.snapshot, mutation.focusedWorktreeId);
      if (mutation.error) {
        toast.error(mutation.error);
      }
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function handleAbandon(worktreeId: string) {
    try {
      applySnapshot(await api.abandonWorktree(worktreeId));
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function confirmDelete(force: boolean) {
    const target = deleteTargetRef.current;
    if (!target) {
      return;
    }
    try {
      const result = await api.deleteWorktree(target.id, deleteBranchTooRef.current, force);
      if (result.status === "needsForce") {
        setForceStderr(result.stderr);
        return;
      }
      applySnapshot(result.snapshot);
      deleteTargetRef.current = null;
      setDeleteTarget(null);
      setForceStderr(null);
      setDeleteBranchToo(false);
      deleteBranchTooRef.current = false;
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function handleRemoveProject(projectId: string, forget: boolean) {
    try {
      const result = await api.removeProject(projectId, forget);
      if (result.status === "hasAppWorktrees") {
        setRemoveProjectId(projectId);
        setRemoveProjectCount(result.count);
        return;
      }
      applySnapshot(result.snapshot);
      setRemoveProjectId(null);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function handleOpenCursor(path: string) {
    try {
      await api.openInCursor(path);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function handleRevealFinder(path: string) {
    try {
      await api.revealInFinder(path);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  const currentPath = selectedWorktree?.path ?? selectedProject?.rootPath ?? null;
  const showTerminal =
    selectedWorktree?.status === "ready" && !selectedWorktree.missing;
  const visitedReady = visited
    .map((id) => worktrees.find((item) => item.id === id))
    .filter((item): item is Worktree => Boolean(item && item.status === "ready" && !item.missing));

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <Sidebar
        projects={projects}
        worktrees={worktrees}
        selection={selection}
        onSelect={setSelection}
        onAddProject={() => void handleAddProject()}
        onNewWorktree={(projectId) => void openCreate(projectId)}
        onRemoveProject={(projectId) => void handleRemoveProject(projectId, false)}
        onDeleteWorktree={(worktreeId) => {
          const target = worktrees.find((item) => item.id === worktreeId);
          if (target) {
            deleteTargetRef.current = target;
            setDeleteTarget(target);
            setDeleteBranchToo(false);
            deleteBranchTooRef.current = false;
            setForceStderr(null);
          }
        }}
        onRetryWorktree={(worktreeId) => void handleRetry(worktreeId)}
        onAbandonWorktree={(worktreeId) => void handleAbandon(worktreeId)}
        onRemoveMissing={(worktreeId) => {
          void api
            .removeMissingWorktree(worktreeId)
            .then((next) => applySnapshot(next))
            .catch((error) => toast.error(invokeError(error)));
        }}
        onOpenCursor={(path) => void handleOpenCursor(path)}
        onRevealFinder={(path) => void handleRevealFinder(path)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {selectedWorktree
                ? selectedWorktree.displayName
                : selectedProject
                  ? `${selectedProject.name} · 主工作区`
                  : "未选择工作树"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {currentPath ?? "添加项目后，在这里打开终端和差异"}
            </p>
          </div>
          {currentPath ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void handleOpenCursor(currentPath)}>
                在 Cursor 中打开
              </Button>
              <Button size="sm" variant="outline" onClick={() => void handleRevealFinder(currentPath)}>
                在访达中显示
              </Button>
            </>
          ) : null}
          {selectedWorktree && !selectedWorktree.missing && selectedWorktree.status !== "creating" ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                deleteTargetRef.current = selectedWorktree;
                setDeleteTarget(selectedWorktree);
                setDeleteBranchToo(false);
                deleteBranchTooRef.current = false;
                setForceStderr(null);
              }}
            >
              删除工作树
            </Button>
          ) : null}
        </header>

        <div className="relative min-h-0 flex-1">
          {visitedReady.map((worktree) => (
            <div
              key={worktree.id}
              className={
                selectedWorktree?.id === worktree.id
                  ? "absolute inset-0"
                  : "pointer-events-none invisible absolute inset-0"
              }
            >
              <TerminalPane
                worktreeId={worktree.id}
                active={selectedWorktree?.id === worktree.id}
              />
            </div>
          ))}
          {!showTerminal ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <EmptyMain
                project={selectedProject}
                worktree={selectedWorktree}
                onRetry={() => selectedWorktree && void handleRetry(selectedWorktree.id)}
                onAbandon={() => selectedWorktree && void handleAbandon(selectedWorktree.id)}
                onRemoveMissing={() =>
                  selectedWorktree &&
                  void api
                    .removeMissingWorktree(selectedWorktree.id)
                    .then((next) => applySnapshot(next))
                    .catch((error) => toast.error(invokeError(error)))
                }
              />
            </div>
          ) : null}
        </div>
      </main>

      <DiffPane
        collapsed={diffCollapsed}
        loading={diffLoading}
        text={diffText}
        empty={diffEmpty}
        error={diffError}
        onRefresh={() => {
          if (selectedWorktree) {
            void refreshDiff(selectedWorktree.id);
          }
        }}
        onToggle={() => setDiffCollapsed((value) => !value)}
      />

      <ImportDialog
        inspect={inspect}
        selected={importSelected}
        onToggle={(path, checked) =>
          setImportSelected((current) => ({ ...current, [path]: checked }))
        }
        onCancel={() => setInspect(null)}
        onConfirm={() => void confirmAddProject()}
      />

      <Dialog open={Boolean(createProjectId)} onOpenChange={(open) => !open && setCreateProjectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建工作树</DialogTitle>
            <DialogDescription>会在固定默认路径创建真实 git worktree，不安装依赖。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="display-name">显示名</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：修登录"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="branch-name">分支名</Label>
              <Input
                id="branch-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="空则用显示名生成"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>起始分支</Label>
              <Select value={startFrom} onValueChange={setStartFrom}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择本地分支" />
                </SelectTrigger>
                <SelectContent>
                  {localBranches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateProjectId(null)}>
              取消
            </Button>
            <Button disabled={!displayName.trim()} onClick={() => void confirmCreate()}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget) && !forceStderr}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteBranchToo(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除工作树</AlertDialogTitle>
            <AlertDialogDescription>
              将删除磁盘上的工作树目录
              {deleteTarget ? ` ${deleteTarget.path}` : ""}。此操作不能从本应用撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={deleteBranchToo}
              onCheckedChange={(value) => {
                const checked = value === true;
                setDeleteBranchToo(checked);
                deleteBranchTooRef.current = checked;
              }}
            />
            同时删除本地分支
            {deleteTarget ? ` ${deleteTarget.branchName}` : ""}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete(false)}>
              删除工作树
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(forceStderr)} onOpenChange={(open) => !open && setForceStderr(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>强制删除</AlertDialogTitle>
            <AlertDialogDescription>
              普通删除失败，通常是因为还有未提交改动。强制删除会丢掉工作树目录中的未提交内容。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {forceStderr ? <CopyableError text={forceStderr} /> : null}
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete(true)}>
              强制删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(removeProjectId)}
        onOpenChange={(open) => !open && setRemoveProjectId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消登记项目</AlertDialogTitle>
            <AlertDialogDescription>
              此项目下仍有 {removeProjectCount} 个本应用创建的工作树。取消登记只会从本应用忘掉该仓，不会删除磁盘上的 git 数据。若要删掉工作树，请先逐个删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeProjectId && void handleRemoveProject(removeProjectId, true)}
            >
              仍要取消登记
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function pruneSelection(selection: Selection, snapshot: AppSnapshot): Selection {
  if (selection.kind === "main") {
    return snapshot.projects.some((item) => item.id === selection.projectId)
      ? selection
      : { kind: "empty" };
  }
  if (selection.kind === "worktree") {
    return snapshot.worktrees.some((item) => item.id === selection.worktreeId)
      ? selection
      : { kind: "empty" };
  }
  return selection;
}

function EmptyMain({
  project,
  worktree,
  onRetry,
  onAbandon,
  onRemoveMissing,
}: {
  project: Project | null;
  worktree: Worktree | null;
  onRetry: () => void;
  onAbandon: () => void;
  onRemoveMissing: () => void;
}) {
  if (worktree?.missing) {
    return (
      <div className="max-w-md space-y-3 text-center">
        <p className="text-sm">该工作树已丢失，磁盘上找不到对应 git worktree。</p>
        {worktree.errorMessage ? <CopyableError text={worktree.errorMessage} /> : null}
        <Button variant="outline" onClick={onRemoveMissing}>
          从列表移除
        </Button>
      </div>
    );
  }
  if (worktree?.status === "creating") {
    return <p className="text-sm text-muted-foreground">正在创建工作树…</p>;
  }
  if (worktree?.status === "error") {
    return (
      <div className="max-w-lg space-y-3 text-center">
        <p className="text-sm">创建失败。可以重试，或放弃并清理半成品。</p>
        {worktree.errorMessage ? <CopyableError text={worktree.errorMessage} /> : null}
        <div className="flex justify-center gap-2">
          <Button onClick={onRetry}>重试</Button>
          <Button variant="outline" onClick={onAbandon}>
            放弃
          </Button>
        </div>
      </div>
    );
  }
  if (project) {
    return (
      <p className="text-sm text-muted-foreground">
        主工作区。请选择或新建工作树，以打开终端和只读差异。
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">添加一个本地 git 仓库开始编排工作树。</p>;
}

function ImportDialog({
  inspect,
  selected,
  onToggle,
  onCancel,
  onConfirm,
}: {
  inspect: InspectResult | null;
  selected: Record<string, boolean>;
  onToggle: (path: string, checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(inspect)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入已有工作树</DialogTitle>
          <DialogDescription>
            已扫描 git worktree 列表。勾选要导入到侧栏的条目，也可以一个都不勾。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-2 overflow-auto">
          {inspect?.existingWorktrees.map((item: ExistingWorktree) => (
            <label key={item.path} className="flex items-start gap-2 rounded-md border p-2 text-sm">
              <Checkbox
                checked={Boolean(selected[item.path])}
                onCheckedChange={(value) => onToggle(item.path, value === true)}
              />
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {item.branchName ?? item.head.slice(0, 8)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{item.path}</span>
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm}>添加项目</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
