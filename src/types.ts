export type WorktreeOrigin = "app" | "imported";
export type WorktreeStatus = "creating" | "ready" | "error";

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  defaultBranch: string;
  mainBranch: string | null;
  pathMissing: boolean;
};

export type Worktree = {
  id: string;
  projectId: string;
  displayName: string;
  branchName: string;
  startFrom: string | null;
  path: string;
  origin: WorktreeOrigin;
  status: WorktreeStatus;
  errorMessage?: string | null;
  missing: boolean;
};

export type AppSnapshot = {
  projects: Project[];
  worktrees: Worktree[];
};

export type BranchOptions = {
  recent: string[];
  local: string[];
  remote: string[];
};

export type ExistingWorktree = {
  path: string;
  branchName?: string | null;
  head: string;
};

export type InspectResult = {
  rootPath: string;
  name: string;
  defaultBranch: string;
  usedFallbackDefaultBranch: boolean;
  existingWorktrees: ExistingWorktree[];
};

export type MutationResult = {
  snapshot: AppSnapshot;
  focusedWorktreeId?: string | null;
  error?: string | null;
};

export type DeleteResult =
  | { status: "ok"; snapshot: AppSnapshot }
  | { status: "needsForce"; stderr: string };

export type RemoveProjectResult =
  | { status: "ok"; snapshot: AppSnapshot }
  | { status: "hasAppWorktrees"; count: number };

export type Selection =
  | { kind: "empty" }
  | { kind: "main"; projectId: string }
  | { kind: "worktree"; worktreeId: string };
