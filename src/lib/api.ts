import { invoke } from "@tauri-apps/api/core";

import type {
  AppSnapshot,
  BranchOptions,
  DeleteResult,
  InspectResult,
  MutationResult,
  RefreshProjectWorktreesResult,
  RemoveProjectResult,
} from "@/types";

export type TerminalAttachResult = {
  sessionId: string;
  isNew: boolean;
  recovery: "warm" | "cold" | "fresh";
  scrollbackAnsi: string;
  cols: number;
  rows: number;
  cwd: string;
};

export function invokeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export const api = {
  loadSnapshot: () => invoke<AppSnapshot>("load_snapshot"),
  inspectRepo: (path: string) => invoke<InspectResult>("inspect_repo", { path }),
  defaultWorktreeParent: (projectId: string) =>
    invoke<string>("default_worktree_parent", { projectId }),
  addProject: (path: string, importPaths: string[]) =>
    invoke<MutationResult>("add_project", { path, importPaths }),
  createWorktree: (
    projectId: string,
    displayName: string,
    startFrom: string | null,
    parentPath: string | null,
  ) =>
    invoke<MutationResult>("create_worktree", {
      projectId,
      displayName,
      startFrom,
      parentPath,
    }),
  retryWorktree: (worktreeId: string) =>
    invoke<MutationResult>("retry_worktree", { worktreeId }),
  abandonWorktree: (worktreeId: string) =>
    invoke<AppSnapshot>("abandon_worktree", { worktreeId }),
  deleteWorktree: (worktreeId: string, deleteBranch: boolean, force: boolean) =>
    invoke<DeleteResult>("delete_worktree", { worktreeId, deleteBranch, force }),
  removeMissingWorktree: (worktreeId: string) =>
    invoke<AppSnapshot>("remove_missing_worktree", { worktreeId }),
  refreshProjectWorktrees: (projectId: string) =>
    invoke<RefreshProjectWorktreesResult>("refresh_project_worktrees", {
      projectId,
    }),
  removeProject: (projectId: string, forget: boolean) =>
    invoke<RemoveProjectResult>("remove_project", { projectId, forget }),
  listLocalBranches: (projectId: string) =>
    invoke<string[]>("list_local_branches", { projectId }),
  listBranchOptions: (projectId: string) =>
    invoke<BranchOptions>("list_branch_options", { projectId }),
  switchMainBranch: (projectId: string, branch: string) =>
    invoke<void>("switch_main_branch", { projectId, branch }),
  openInEditor: (editor: string, path: string) =>
    invoke<void>("open_in_editor", { editor, path }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),
  ptyOpen: (sessionId: string, cwdId: string, cols: number, rows: number) =>
    invoke<TerminalAttachResult>("pty_open", { sessionId, cwdId, cols, rows }),
  ptyDetach: (sessionId: string) => invoke<void>("pty_detach", { sessionId }),
  ptyWrite: (sessionId: string, data: string) =>
    invoke<void>("pty_write", { sessionId, data }),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("pty_resize", { sessionId, cols, rows }),
  ptyKill: (sessionId: string) => invoke<void>("pty_kill", { sessionId }),
};
