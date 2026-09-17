import { invoke } from "@tauri-apps/api/core";

import type {
  AppSnapshot,
  DeleteResult,
  DiffResult,
  InspectResult,
  MutationResult,
  RemoveProjectResult,
} from "@/types";

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
  addProject: (path: string, importPaths: string[]) =>
    invoke<MutationResult>("add_project", { path, importPaths }),
  createWorktree: (
    projectId: string,
    displayName: string,
    branchName: string | null,
    startFrom: string | null,
  ) =>
    invoke<MutationResult>("create_worktree", {
      projectId,
      displayName,
      branchName,
      startFrom,
    }),
  retryWorktree: (worktreeId: string) =>
    invoke<MutationResult>("retry_worktree", { worktreeId }),
  abandonWorktree: (worktreeId: string) =>
    invoke<AppSnapshot>("abandon_worktree", { worktreeId }),
  deleteWorktree: (worktreeId: string, deleteBranch: boolean, force: boolean) =>
    invoke<DeleteResult>("delete_worktree", { worktreeId, deleteBranch, force }),
  removeMissingWorktree: (worktreeId: string) =>
    invoke<AppSnapshot>("remove_missing_worktree", { worktreeId }),
  removeProject: (projectId: string, forget: boolean) =>
    invoke<RemoveProjectResult>("remove_project", { projectId, forget }),
  listLocalBranches: (projectId: string) =>
    invoke<string[]>("list_local_branches", { projectId }),
  getDiff: (worktreeId: string) => invoke<DiffResult>("get_diff", { worktreeId }),
  openInCursor: (path: string) => invoke<void>("open_in_cursor", { path }),
  revealInFinder: (path: string) => invoke<void>("reveal_in_finder", { path }),
  ptyOpen: (worktreeId: string, cols: number, rows: number) =>
    invoke<boolean>("pty_open", { worktreeId, cols, rows }),
  ptyWrite: (worktreeId: string, data: string) =>
    invoke<void>("pty_write", { worktreeId, data }),
  ptyResize: (worktreeId: string, cols: number, rows: number) =>
    invoke<void>("pty_resize", { worktreeId, cols, rows }),
  ptyKill: (worktreeId: string) => invoke<void>("pty_kill", { worktreeId }),
};
