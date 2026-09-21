import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeftIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  FolderOpenIcon,
  PencilIcon,
  PanelLeftOpenIcon,
  PanelTopCloseIcon,
  PlusIcon,
  XIcon,
  SettingsIcon,
  PaletteIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  Code2Icon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";

import { CopyableError } from "@/components/CopyableError";
import { Sidebar } from "@/components/Sidebar";
import { TerminalPane } from "@/components/TerminalPane";
import { UpdateDialog } from "@/components/UpdateDialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, invokeError } from "@/lib/api";
import { useAppUpdater, type ManualCheckStatus } from "@/lib/updater";
import { cn } from "@/lib/utils";
import type {
  AppSnapshot,
  ExistingWorktree,
  InspectResult,
  Project,
  Selection,
  Worktree,
} from "@/types";

const emptySnapshot: AppSnapshot = { projects: [], worktrees: [] };

type TerminalTab = {
  id: string;
  label: string;
};

type TabCloseMode = "current" | "others" | "left" | "right";
type AppView = "workspace" | "settings";

type TabContextMenu = {
  tabId: string;
  x: number;
  y: number;
};

type RenameTabTarget = {
  contextId: string;
  tabId: string;
};

type PersistedTerminalState = {
  selection?: Selection;
  tabsByContext?: Record<string, TerminalTab[]>;
  activeTabByContext?: Record<string, string>;
};

const TERMINAL_STATE_KEY = "octopus.terminal.state";
const SIDEBAR_WIDTH_KEY = "octopus.sidebar.width";
const DEFAULT_SIDEBAR_WIDTH = 288;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;
const THEME_KEY = "octopus.theme";
const DEFAULT_EDITOR_KEY = "octopus.default-editor";
type ThemePreference = "light" | "dark" | "system";

const EDITOR_OPTIONS = [
  { value: "Cursor", label: "Cursor" },
  { value: "Visual Studio Code", label: "Visual Studio Code" },
  { value: "Windsurf", label: "Windsurf" },
  { value: "Zed", label: "Zed" },
  { value: "Sublime Text", label: "Sublime Text" },
  { value: "Nova", label: "Nova" },
] as const;

const EDITOR_VALUES = new Set<string>(EDITOR_OPTIONS.map((option) => option.value));
const LEGACY_EDITOR_VALUES: Record<string, string> = {
  cursor: "Cursor",
  code: "Visual Studio Code",
  "visual studio code": "Visual Studio Code",
  windsurf: "Windsurf",
  zed: "Zed",
  "sublime text": "Sublime Text",
  nova: "Nova",
  "/applications/cursor.app": "Cursor",
  "/applications/visual studio code.app": "Visual Studio Code",
  "/applications/windsurf.app": "Windsurf",
  "/applications/zed.app": "Zed",
  "/applications/sublime text.app": "Sublime Text",
  "/applications/nova.app": "Nova",
};

function readDefaultEditor(): string {
  try {
    const value = localStorage.getItem(DEFAULT_EDITOR_KEY)?.trim() ?? "";
    if (EDITOR_VALUES.has(value)) {
      return value;
    }
    return LEGACY_EDITOR_VALUES[value.toLowerCase()] ?? "";
  } catch {
    return "";
  }
}

function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function readSidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(value)
      ? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value))
      : DEFAULT_SIDEBAR_WIDTH;
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function readPersistedTerminalState(): PersistedTerminalState {
  try {
    const raw = localStorage.getItem(TERMINAL_STATE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const value = parsed as Record<string, unknown>;
    const tabsByContext: Record<string, TerminalTab[]> = {};
    if (value.tabsByContext && typeof value.tabsByContext === "object") {
      for (const [contextId, rawTabs] of Object.entries(value.tabsByContext)) {
        if (!Array.isArray(rawTabs)) {
          continue;
        }
        const tabs = rawTabs.filter(
          (tab): tab is TerminalTab =>
            Boolean(tab) &&
            typeof tab === "object" &&
            typeof (tab as { id?: unknown }).id === "string" &&
            typeof (tab as { label?: unknown }).label === "string",
        );
        if (tabs.length > 0) {
          tabsByContext[contextId] = tabs;
        }
      }
    }
    const activeTabByContext: Record<string, string> = {};
    if (value.activeTabByContext && typeof value.activeTabByContext === "object") {
      for (const [contextId, tabId] of Object.entries(value.activeTabByContext)) {
        if (typeof tabId === "string") {
          activeTabByContext[contextId] = tabId;
        }
      }
    }
    const rawSelection = value.selection;
    const selection =
      rawSelection &&
      typeof rawSelection === "object" &&
      ((rawSelection as { kind?: unknown }).kind === "empty" ||
        ((rawSelection as { kind?: unknown }).kind === "main" &&
          typeof (rawSelection as { projectId?: unknown }).projectId === "string") ||
        ((rawSelection as { kind?: unknown }).kind === "worktree" &&
          typeof (rawSelection as { worktreeId?: unknown }).worktreeId === "string"))
        ? (rawSelection as Selection)
        : undefined;
    return { selection, tabsByContext, activeTabByContext };
  } catch {
    return {};
  }
}

function createTerminalTab(index: number): TerminalTab {
  return { id: crypto.randomUUID(), label: `终端 ${index}` };
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

export default function App() {
  const persistedState = useMemo(readPersistedTerminalState, []);
  const updater = useAppUpdater();
  const [snapshot, setSnapshot] = useState<AppSnapshot>(emptySnapshot);
  const [selection, setSelection] = useState<Selection>(persistedState.selection ?? { kind: "empty" });
  const [visited, setVisited] = useState<string[]>([]);
  const [tabsByContext, setTabsByContext] = useState<Record<string, TerminalTab[]>>(
    persistedState.tabsByContext ?? {},
  );
  const [activeTabByContext, setActiveTabByContext] = useState<Record<string, string>>(
    persistedState.activeTabByContext ?? {},
  );
  const [stateHydrated, setStateHydrated] = useState(false);
  const activeTabElementRef = useRef<HTMLDivElement | null>(null);
  const tabsViewportRef = useRef<HTMLDivElement | null>(null);
  const tabsContentRef = useRef<HTMLDivElement | null>(null);
  const [tabsOverflowing, setTabsOverflowing] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenu | null>(null);
  const [renameTabTarget, setRenameTabTarget] = useState<RenameTabTarget | null>(null);
  const [renameTabValue, setRenameTabValue] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  // 折叠是当前会话的临时布局偏好；宽度单独持久化，应用重启后默认展开。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const resizePointerRef = useRef<{ pointerId: number } | null>(null);
  const [view, setView] = useState<AppView>("workspace");
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [defaultEditor, setDefaultEditor] = useState(readDefaultEditor);

  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});

  const [createProjectId, setCreateProjectId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [startFromQuery, setStartFromQuery] = useState("");
  const [localBranches, setLocalBranches] = useState<string[]>([]);
  const [worktreeParent, setWorktreeParent] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Worktree | null>(null);
  const [deleteBranchToo, setDeleteBranchToo] = useState(false);
  const [forceStderr, setForceStderr] = useState<string | null>(null);
  const deleteTargetRef = useRef<Worktree | null>(null);
  const deleteBranchTooRef = useRef(false);

  const [removeProjectId, setRemoveProjectId] = useState<string | null>(null);
  const [removeProjectCount, setRemoveProjectCount] = useState(0);

  useEffect(() => {
    applyTheme(themePreference);
    try {
      localStorage.setItem(THEME_KEY, themePreference);
    } catch {
      // 本地存储不可用时，主题仍会在当前会话中生效。
    }

    if (themePreference !== "system") {
      return;
    }
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => applyTheme("system");
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [themePreference]);

  // 启动后延迟静默检查更新，避免抢占启动资源；失败时静默跳过。
  useEffect(() => {
    const timer = window.setTimeout(() => void updater.check("silent"), 4000);
    return () => window.clearTimeout(timer);
    // 只在挂载时检查一次；updater.check 是稳定引用。
  }, []);

  useEffect(() => {
    try {
      const editor = defaultEditor.trim();
      if (editor) {
        localStorage.setItem(DEFAULT_EDITOR_KEY, editor);
      } else {
        localStorage.removeItem(DEFAULT_EDITOR_KEY);
      }
    } catch {
      // 本地存储不可用时，编辑器设置仍会在当前会话中生效。
    }
  }, [defaultEditor]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // 本地存储不可用时，宽度仍可在当前会话中正常调整。
    }
  }, [sidebarWidth]);

  useEffect(() => {
    function handleSidebarShortcut(event: KeyboardEvent) {
      if (view === "settings") {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable='true']")) {
          return;
        }
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      }
    }
    window.addEventListener("keydown", handleSidebarShortcut);
    return () => window.removeEventListener("keydown", handleSidebarShortcut);
  }, [view]);

  useEffect(() => {
    document.body.style.cursor = isResizingSidebar ? "col-resize" : "";
    document.body.style.userSelect = isResizingSidebar ? "none" : "";
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingSidebar]);

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

  const selectedContextId =
    selection.kind === "main"
      ? selection.projectId
      : selection.kind === "worktree"
        ? selection.worktreeId
        : null;
  const selectedTabs = selectedContextId ? tabsByContext[selectedContextId] ?? [] : [];
  const activeTabId = selectedContextId
    ? activeTabByContext[selectedContextId] ?? selectedTabs[0]?.id
    : undefined;

  useEffect(() => {
    const viewport = tabsViewportRef.current;
    const content = tabsContentRef.current;
    if (!viewport || !content) {
      return;
    }

    const updateOverflow = () => {
      setTabsOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    };
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(content);
    updateOverflow();
    window.addEventListener("resize", updateOverflow);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOverflow);
    };
  }, [selectedContextId, selectedTabs.length]);

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
      current.filter(
        (id) =>
          next.worktrees.some((item) => item.id === id) ||
          next.projects.some((item) => item.id === id),
      ),
    );
  }, []);

  useEffect(() => {
    void api
      .loadSnapshot()
      .then((next) => {
        applySnapshot(next);
        const restoredSelection = selectionExists(selection, next) ? selection : null;
        const initialSelection =
          restoredSelection ?? (next.projects[0] ? { kind: "main", projectId: next.projects[0].id } : { kind: "empty" });
        setSelection(initialSelection);
        if (initialSelection.kind === "main") {
          setVisited((current) =>
            current.includes(initialSelection.projectId)
              ? current
              : [...current, initialSelection.projectId],
          );
        } else if (initialSelection.kind === "worktree") {
          setVisited((current) =>
            current.includes(initialSelection.worktreeId)
              ? current
              : [...current, initialSelection.worktreeId],
          );
        }
        setStateHydrated(true);
      })
      .catch((error) => toast.error(invokeError(error)));
  }, [applySnapshot]);

  useEffect(() => {
    if (!stateHydrated) {
      return;
    }
    try {
      localStorage.setItem(
        TERMINAL_STATE_KEY,
        JSON.stringify({ selection, tabsByContext, activeTabByContext } satisfies PersistedTerminalState),
      );
    } catch {
      // 本地存储不可用或已满时，终端仍可正常使用。
    }
  }, [activeTabByContext, selection, stateHydrated, tabsByContext]);

  useEffect(() => {
    if (selection.kind === "worktree") {
      setVisited((current) =>
        current.includes(selection.worktreeId) ? current : [...current, selection.worktreeId],
      );
      return;
    }
    if (selection.kind === "main") {
      setVisited((current) =>
        current.includes(selection.projectId) ? current : [...current, selection.projectId],
      );
    }
  }, [selection]);

  useEffect(() => {
    if (!selectedContextId) {
      return;
    }
    setTabsByContext((current) => {
      if (current[selectedContextId]?.length) {
        return current;
      }
      return { ...current, [selectedContextId]: [createTerminalTab(1)] };
    });
    setActiveTabByContext((current) => {
      if (current[selectedContextId]) {
        return current;
      }
      return current;
    });
  }, [selectedContextId]);

  useEffect(() => {
    setTabContextMenu(null);
  }, [selectedContextId]);

  useEffect(() => {
    if (renameTabTarget?.contextId !== selectedContextId) {
      setRenameTabTarget(null);
    }
  }, [renameTabTarget, selectedContextId]);

  useEffect(() => {
    activeTabElementRef.current?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId, selectedContextId]);

  function addTerminalTab() {
    if (!selectedContextId) {
      return;
    }
    const tabs = tabsByContext[selectedContextId] ?? [];
    const tab = createTerminalTab(tabs.length + 1);
    setTabsByContext((current) => ({
      ...current,
      [selectedContextId]: [...(current[selectedContextId] ?? []), tab],
    }));
    setActiveTabByContext((current) => ({ ...current, [selectedContextId]: tab.id }));
  }

  function closeTerminalTabs(tabId: string, mode: TabCloseMode) {
    if (!selectedContextId) {
      return;
    }
    setTabContextMenu(null);
    const tabs = tabsByContext[selectedContextId] ?? [];
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return;
    }

    const idsToClose = new Set(
      mode === "current"
        ? [tabId]
        : mode === "others"
          ? tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)
          : mode === "left"
            ? tabs.slice(0, index).map((tab) => tab.id)
            : tabs.slice(index + 1).map((tab) => tab.id),
    );
    // 每个项目/分支上下文必须至少保留一个终端，避免关闭后无法再回到该终端。
    if (idsToClose.size === 0 || idsToClose.size >= tabs.length) {
      return;
    }

    for (const id of idsToClose) {
      void api.ptyKill(id).catch(() => undefined);
    }
    const nextTabs = tabs.filter((tab) => !idsToClose.has(tab.id));
    setTabsByContext((current) => ({ ...current, [selectedContextId]: nextTabs }));
    setActiveTabByContext((current) => {
      const activeId = current[selectedContextId] ?? tabs[0]?.id;
      if (activeId && !idsToClose.has(activeId)) {
        return current;
      }
      const nextTab =
        mode === "current"
          ? nextTabs[index] ?? nextTabs[index - 1]
          : nextTabs.find((tab) => tab.id === tabId) ?? nextTabs[0];
      return nextTab
        ? { ...current, [selectedContextId]: nextTab.id }
        : { ...current, [selectedContextId]: "" };
    });
  }

  function closeTerminalTab(tabId: string) {
    closeTerminalTabs(tabId, "current");
  }

  function openRenameTerminalTab(tabId: string) {
    if (!selectedContextId) {
      return;
    }
    const tab = (tabsByContext[selectedContextId] ?? []).find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    setTabContextMenu(null);
    setRenameTabTarget({ contextId: selectedContextId, tabId });
    setRenameTabValue(tab.label);
  }

  function confirmRenameTerminalTab() {
    if (!renameTabTarget) {
      return;
    }
    const label = renameTabValue.trim();
    if (!label) {
      toast.error("终端名称不能为空");
      return;
    }
    setTabsByContext((current) => {
      const tabs = current[renameTabTarget.contextId];
      if (!tabs) {
        return current;
      }
      return {
        ...current,
        [renameTabTarget.contextId]: tabs.map((tab) =>
          tab.id === renameTabTarget.tabId ? { ...tab, label } : tab,
        ),
      };
    });
    setRenameTabTarget(null);
  }

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

  async function openCreate(projectId: string, suggestedStartFrom?: string) {
    try {
      const branches = await api.listLocalBranches(projectId);
      const project = projects.find((item) => item.id === projectId);
      const parent = await api.defaultWorktreeParent(projectId);
      const initialStartFrom = suggestedStartFrom ?? project?.defaultBranch ?? branches[0] ?? "";
      setLocalBranches(
        suggestedStartFrom && !branches.includes(suggestedStartFrom)
          ? [...branches, suggestedStartFrom]
          : branches,
      );
      setCreateProjectId(projectId);
      setDisplayName("");
      setStartFrom(initialStartFrom);
      setStartFromQuery("");
      setWorktreeParent(parent);
    } catch (error) {
      toast.error(invokeError(error));
    }
  }

  async function confirmCreate() {
    if (!createProjectId) {
      return;
    }
    const name = displayName.trim();
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.startsWith(".") || name.endsWith(".") || name.startsWith("/") || name.endsWith("/") || name.includes("..") || name.includes("//")) {
      toast.error("显示名只能包含英文字母、数字、/、-、_ 和 .，且不能包含非法路径片段");
      return;
    }
    if (!startFrom || !localBranches.includes(startFrom)) {
      toast.error("请选择有效的起始分支");
      return;
    }
    if (!worktreeParent.trim()) {
      toast.error("工作树目录不能为空");
      return;
    }
    try {
      const mutation = await api.createWorktree(
        createProjectId,
        displayName,
        startFrom.trim() ? startFrom.trim() : null,
        worktreeParent.trim() ? worktreeParent.trim() : null,
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

  async function chooseWorktreeParent() {
    const selected = await open({ directory: true, multiple: false, title: "选择工作树目录" });
    if (selected && !Array.isArray(selected)) {
      setWorktreeParent(selected);
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

  async function handleSwitchMainBranch(projectId: string, branch: string) {
    const previousBranch =
      snapshot.projects.find((project) => project.id === projectId)?.mainBranch ?? null;
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? { ...project, mainBranch: branch } : project,
      ),
    }));
    try {
      await api.switchMainBranch(projectId, branch);
    } catch (error) {
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectId && project.mainBranch === branch
            ? { ...project, mainBranch: previousBranch }
            : project,
        ),
      }));
      throw error;
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

  async function handleOpenEditor(path: string) {
    const editor = defaultEditor.trim();
    if (!editor) {
      toast.error("请先到设置中配置默认编辑器");
      return;
    }
    try {
      await api.openInEditor(editor, path);
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

  const showWorktreeTerminal =
    selectedWorktree?.status === "ready" && !selectedWorktree.missing;
  const showMainTerminal = Boolean(
    selection.kind === "main" && selectedProject && !selectedProject.pathMissing,
  );
  const showTerminal = showWorktreeTerminal || showMainTerminal;
  const newTerminalButton = (
    <Button
      size="icon-sm"
      variant="ghost"
      className="my-1 shrink-0 bg-muted/30"
      onClick={addTerminalTab}
      disabled={!selectedContextId || !showTerminal}
      aria-label="新建终端"
      title="新建终端"
    >
      <PlusIcon />
    </Button>
  );
  const visitedReady = visited
    .map((id) => worktrees.find((item) => item.id === id))
    .filter((item): item is Worktree => Boolean(item && item.status === "ready" && !item.missing));
  const visitedMains = visited
    .map((id) => projects.find((item) => item.id === id))
    .filter((item): item is Project => Boolean(item && !item.pathMissing));
  const terminalContexts = [
    ...visitedReady.map((worktree) => ({ id: worktree.id, cwdId: worktree.id })),
    ...visitedMains.map((project) => ({ id: project.id, cwdId: project.id })),
  ];
  const contextMenuTab = tabContextMenu
    ? selectedTabs.find((tab) => tab.id === tabContextMenu.tabId) ?? null
    : null;
  const contextMenuTabIndex = contextMenuTab
    ? selectedTabs.findIndex((tab) => tab.id === contextMenuTab.id)
    : -1;

  function selectWorkspace(selection: Selection) {
    setView("workspace");
    setSelection(selection);
  }

  return (
    <div className="relative flex h-full min-h-0 bg-background text-foreground">
      {view === "workspace" ? (
        <div
          ref={sidebarShellRef}
          className={cn(
            "relative flex h-full min-h-0 shrink-0 flex-col overflow-visible",
            !isResizingSidebar && "transition-[width] duration-150 ease-out",
          )}
          style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
        >
        <Sidebar
          projects={projects}
          worktrees={worktrees}
          selection={selection}
          onSelect={selectWorkspace}
          onAddProject={() => void handleAddProject()}
          onNewWorktree={(projectId, startFromBranch) =>
            void openCreate(projectId, startFromBranch)
          }
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
          onOpenEditor={(path) => void handleOpenEditor(path)}
          editorConfigured={Boolean(defaultEditor.trim())}
          onRevealFinder={(path) => void handleRevealFinder(path)}
          onListBranchOptions={(projectId) => api.listBranchOptions(projectId)}
          onSwitchMainBranch={handleSwitchMainBranch}
          onOpenSettings={() => setView("settings")}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(true)}
        />

        {sidebarCollapsed ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="absolute top-1 z-30 border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm hover:bg-sidebar-accent"
            style={{ left: "var(--mac-traffic-lights-width)" }}
            onClick={() => setSidebarCollapsed(false)}
            aria-label="展开侧栏"
            title="展开侧栏（⌘/Ctrl+B）"
          >
            <PanelLeftOpenIcon />
          </Button>
        ) : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整侧边栏宽度"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            tabIndex={0}
            className={cn(
              "group absolute -right-1.5 top-0 z-20 flex h-full w-3 touch-none cursor-col-resize items-stretch justify-center outline-none",
              isResizingSidebar && "cursor-col-resize",
            )}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              resizePointerRef.current = { pointerId: event.pointerId };
              setIsResizingSidebar(true);
            }}
            onPointerMove={(event) => {
              if (resizePointerRef.current?.pointerId !== event.pointerId) {
                return;
              }
              const maxWidth = Math.max(
                MIN_SIDEBAR_WIDTH,
                Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - 320),
              );
              const nextWidth = Math.min(maxWidth, Math.max(MIN_SIDEBAR_WIDTH, event.clientX));
              if (sidebarShellRef.current) {
                sidebarShellRef.current.style.width = `${nextWidth}px`;
              }
            }}
            onPointerUp={(event) => {
              if (resizePointerRef.current?.pointerId !== event.pointerId) {
                return;
              }
              const nextWidth = sidebarShellRef.current?.getBoundingClientRect().width ?? sidebarWidth;
              resizePointerRef.current = null;
              setIsResizingSidebar(false);
              setSidebarWidth(Math.round(nextWidth));
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              resizePointerRef.current = null;
              setIsResizingSidebar(false);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 32 : 16;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setSidebarWidth((current) => Math.max(MIN_SIDEBAR_WIDTH, current - step));
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setSidebarWidth((current) => Math.min(MAX_SIDEBAR_WIDTH, current + step));
              }
            }}
          >
            <span className="h-full w-px bg-border/80 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary/70" />
          </div>
        )}
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        {view === "settings" ? (
          <SettingsPage
            onBack={() => setView("settings" === "settings" ? "workspace" : "settings")}
            themePreference={themePreference}
            onThemeChange={setThemePreference}
            defaultEditor={defaultEditor}
            onDefaultEditorChange={setDefaultEditor}
            currentVersion={updater.currentVersion}
            manualCheckStatus={updater.manualStatus}
            onCheckUpdate={() => void updater.check("manual")}
          />
        ) : (
          <>
            <div
              className="flex h-10 shrink-0 items-stretch border-b bg-muted/30 pr-2"
              data-tauri-drag-region
              onMouseDown={startWindowDrag}
            >
          <div
            className="shrink-0"
            style={{
              width: sidebarCollapsed
                ? "calc(var(--mac-traffic-lights-width) + 40px)"
                : "0px",
            }}
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-1 items-stretch">
            <div ref={tabsViewportRef} className="tabs-scrollbar flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pt-1">
              <div ref={tabsContentRef} className="flex min-w-max items-end gap-1">
              {selectedTabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  ref={active ? activeTabElementRef : undefined}
                  className={cn(
                    "group flex h-9 max-w-48 shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-sm",
                    active
                      ? "border-border bg-background text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-background/70",
                  )}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setTabContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() =>
                      selectedContextId &&
                      setActiveTabByContext((current) => ({
                        ...current,
                        [selectedContextId]: tab.id,
                      }))
                    }
                  >
                    {tab.label}
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                    onClick={() => closeTerminalTab(tab.id)}
                    disabled={selectedTabs.length <= 1}
                    aria-label={`关闭${tab.label}`}
                    title={selectedTabs.length <= 1 ? "至少保留一个终端" : `关闭${tab.label}`}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              );
              })}
              {!tabsOverflowing && newTerminalButton}
              </div>
            </div>
            {tabsOverflowing && newTerminalButton}
          </div>
          <DropdownMenu
            open={Boolean(tabContextMenu && contextMenuTab)}
            onOpenChange={(open) => !open && setTabContextMenu(null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="fixed z-0 size-px border-0 bg-transparent p-0 opacity-0 outline-none"
                style={{
                  left: tabContextMenu?.x ?? 0,
                  top: tabContextMenu?.y ?? 0,
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={4}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <DropdownMenuItem
                onClick={() => {
                  if (contextMenuTab) {
                    openRenameTerminalTab(contextMenuTab.id);
                  }
                }}
              >
                <PencilIcon />
                重命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={selectedTabs.length <= 1}
                onClick={() => {
                  if (contextMenuTab) {
                    closeTerminalTabs(contextMenuTab.id, "current");
                  }
                  setTabContextMenu(null);
                }}
              >
                <XIcon />
                关闭当前
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selectedTabs.length <= 1}
                onClick={() => {
                  if (contextMenuTab) {
                    closeTerminalTabs(contextMenuTab.id, "others");
                  }
                  setTabContextMenu(null);
                }}
              >
                <PanelTopCloseIcon />
                关闭其他
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={contextMenuTabIndex <= 0}
                onClick={() => {
                  if (contextMenuTab) {
                    closeTerminalTabs(contextMenuTab.id, "left");
                  }
                  setTabContextMenu(null);
                }}
              >
                <ArrowLeftToLineIcon />
                关闭左侧
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  contextMenuTabIndex < 0 || contextMenuTabIndex >= selectedTabs.length - 1
                }
                onClick={() => {
                  if (contextMenuTab) {
                    closeTerminalTabs(contextMenuTab.id, "right");
                  }
                  setTabContextMenu(null);
                }}
              >
                <ArrowRightToLineIcon />
                关闭右侧
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
            </div>
            <div className="relative min-h-0 flex-1">
          {terminalContexts.flatMap((context) =>
            (tabsByContext[context.id] ?? []).map((tab) => (
              <div
                key={tab.id}
                className={
                  selectedContextId === context.id && activeTabId === tab.id
                    ? "absolute inset-0"
                    : "pointer-events-none invisible absolute inset-0"
                }
              >
                <TerminalPane
                  sessionId={tab.id}
                  cwdId={context.cwdId}
                  active={selectedContextId === context.id && activeTabId === tab.id}
                />
              </div>
            )),
          )}
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
          </>
        )}
      </main>

      <Dialog
        open={Boolean(renameTabTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTabTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名终端</DialogTitle>
            <DialogDescription>为当前终端设置一个便于识别的名称。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="terminal-tab-name">名称</Label>
            <Input
              id="terminal-tab-name"
              value={renameTabValue}
              onChange={(event) => setRenameTabValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmRenameTerminalTab();
                }
              }}
              autoFocus
              maxLength={80}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTabTarget(null)}>
              取消
            </Button>
            <Button disabled={!renameTabValue.trim()} onClick={confirmRenameTerminalTab}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpdateDialog
        open={updater.dialogOpen}
        phase={updater.phase}
        info={updater.updateInfo}
        error={updater.dialogError}
        onInstall={() => void updater.install()}
        onDismiss={updater.dismiss}
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
            <DialogDescription>会在指定父目录下创建真实 git worktree，不安装依赖。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="display-name">显示名</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：feat/login"
                pattern="[A-Za-z0-9._/-]+"
              />
              <p className="text-xs text-muted-foreground">不能使用中文；支持英文字母、数字、/、-、_、.，并直接作为分支名。</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="worktree-parent">工作树父目录</Label>
              <Input
                id="worktree-parent"
                value={worktreeParent}
                onChange={(event) => setWorktreeParent(event.target.value)}
                className="pr-10"
              />
              <Button type="button" size="icon-sm" variant="ghost" className="-mt-10 ml-auto mr-1" onClick={() => void chooseWorktreeParent()} aria-label="选择工作树目录" title="选择工作树目录">
                <FolderOpenIcon />
              </Button>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="start-from">起始分支</Label>
              <Input
                id="start-from"
                value={startFromQuery || startFrom}
                onChange={(event) => {
                  setStartFrom("");
                  setStartFromQuery(event.target.value);
                }}
                placeholder="输入搜索分支"
              />
              <div className="max-h-32 overflow-y-auto rounded-md border p-1">
                {localBranches.filter((branch) => branch.toLowerCase().includes((startFromQuery || startFrom).toLowerCase())).map((branch) => (
                  <button type="button" key={branch} className={cn("block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted", branch === startFrom && "bg-muted font-medium")} onClick={() => { setStartFrom(branch); setStartFromQuery(""); }}>{branch}</button>
                ))}
              </div>
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

function selectionExists(selection: Selection, snapshot: AppSnapshot): boolean {
  if (selection.kind === "main") {
    return snapshot.projects.some((item) => item.id === selection.projectId);
  }
  if (selection.kind === "worktree") {
    return snapshot.worktrees.some((item) => item.id === selection.worktreeId);
  }
  return false;
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
  if (project?.pathMissing) {
    return <p className="text-sm text-muted-foreground">主工作区路径丢失，无法打开终端。</p>;
  }
  if (project) {
    return <p className="text-sm text-muted-foreground">主工作区。</p>;
  }
  return <p className="text-sm text-muted-foreground">添加一个本地 git 仓库开始编排工作树。</p>;
}

function SettingsPage({
  onBack,
  themePreference,
  onThemeChange,
  defaultEditor,
  onDefaultEditorChange,
  currentVersion,
  manualCheckStatus,
  onCheckUpdate,
}: {
  onBack: () => void;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  defaultEditor: string;
  onDefaultEditorChange: (editor: string) => void;
  currentVersion: string;
  manualCheckStatus: ManualCheckStatus;
  onCheckUpdate: () => void;
}) {
  const [activeSection, setActiveSection] = useState<"appearance" | "editor" | "about">("appearance");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
          <div
            className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
            data-tauri-drag-region
            onMouseDown={startWindowDrag}
          >
            <div className="titlebar-traffic-light-pad" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              className="min-w-0 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground"
              onClick={onBack}
              aria-label="返回应用"
              title="返回应用"
            >
              <ArrowLeftIcon className="size-4 shrink-0" />
              <span className="truncate">返回应用</span>
            </Button>
          </div>
          <nav className="min-h-0 flex-1 overflow-auto p-3" aria-label="设置分类">
            <p className="px-2 pb-2 text-xs font-medium tracking-wide text-muted-foreground">设置</p>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                activeSection === "appearance"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
              onClick={() => setActiveSection("appearance")}
              aria-current={activeSection === "appearance" ? "page" : undefined}
            >
              <PaletteIcon className="size-4 shrink-0" />
              <span>外观</span>
            </button>
            <button
              type="button"
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                activeSection === "editor"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
              onClick={() => setActiveSection("editor")}
              aria-current={activeSection === "editor" ? "page" : undefined}
            >
              <Code2Icon className="size-4 shrink-0" />
              <span>编辑器</span>
            </button>
            <button
              type="button"
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                activeSection === "about"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
              onClick={() => setActiveSection("about")}
              aria-current={activeSection === "about" ? "page" : undefined}
            >
              <InfoIcon className="size-4 shrink-0" />
              <span>关于与更新</span>
            </button>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-3xl px-8 py-8">
            <div className="mb-8 flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <SettingsIcon className="size-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">设置</h1>
                <p className="mt-1 text-sm text-muted-foreground">管理 octopus 的显示和交互偏好。</p>
              </div>
            </div>

            {activeSection === "appearance" ? (
              <section className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">外观</h2>
                  <p className="mt-1 text-sm text-muted-foreground">自定义应用的颜色主题。</p>
                </div>
                <div className="divide-y rounded-lg border bg-card">
                  <div className="flex items-center justify-between gap-4 px-4 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {themePreference === "light" ? (
                          <SunIcon className="size-4" />
                        ) : themePreference === "dark" ? (
                          <MoonIcon className="size-4" />
                        ) : (
                          <MonitorIcon className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">主题</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">选择浅色、深色或跟随系统。</p>
                      </div>
                    </div>
                    <Select value={themePreference} onValueChange={(value) => onThemeChange(value as ThemePreference)}>
                      <SelectTrigger className="w-32 shrink-0" aria-label="主题">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">浅色</SelectItem>
                        <SelectItem value="dark">深色</SelectItem>
                        <SelectItem value="system">系统</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>
            ) : null}
            {activeSection === "editor" ? (
              <section className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">编辑器</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    选择从项目菜单打开路径时使用的默认编辑器。
                  </p>
                </div>
                <div className="rounded-lg border bg-card px-4 py-4">
                  <Label htmlFor="default-editor">默认编辑器</Label>
                  <div className="mt-2">
                    <Select
                      value={defaultEditor || "none"}
                      onValueChange={(value) => onDefaultEditorChange(value === "none" ? "" : value)}
                    >
                      <SelectTrigger id="default-editor" className="w-full max-w-sm" aria-label="默认编辑器">
                        <SelectValue placeholder="选择编辑器" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">未设置</SelectItem>
                        {EDITOR_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    请选择已安装的编辑器。未配置时，项目菜单中的“在编辑器中打开”会被禁用。
                  </p>
                </div>
              </section>
            ) : null}
            {activeSection === "about" ? (
              <section className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold">关于与更新</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    查看当前版本，手动检查是否有新版本可用。
                  </p>
                </div>
                <div className="rounded-lg border bg-card px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">当前版本</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {currentVersion ? `octopus v${currentVersion}` : "正在读取版本号…"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={onCheckUpdate}
                      disabled={manualCheckStatus.kind === "checking"}
                    >
                      <RefreshCwIcon className={cn(manualCheckStatus.kind === "checking" && "animate-spin")} />
                      检查更新
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {manualCheckStatus.kind === "checking"
                      ? "正在检查更新…"
                      : manualCheckStatus.kind === "uptodate"
                        ? "当前已是最新版本。应用启动时也会自动检查一次。"
                        : manualCheckStatus.kind === "error"
                          ? `检查失败：${manualCheckStatus.message}`
                          : "发现新版本时会弹出窗口展示更新内容，确认后才会下载安装。"}
                  </p>
                </div>
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
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
