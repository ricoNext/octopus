import type { Project, Worktree } from "@/types";

export function resolveBasedOnPath(
  project: Project,
  startFromBranch: string,
  worktrees: Worktree[],
): string {
  if (project.mainBranch != null && startFromBranch === project.mainBranch) {
    return project.rootPath;
  }
  const match = worktrees.find(
    (wt) => wt.projectId === project.id && wt.branchName === startFromBranch,
  );
  return match?.path ?? project.rootPath;
}

export function basedOnLabel(
  project: Project,
  basedOnPath: string,
  worktrees: Worktree[],
): string {
  if (basedOnPath === project.rootPath) {
    return `${project.mainBranch ?? project.defaultBranch}（主仓）`;
  }
  const wt = worktrees.find((item) => item.path === basedOnPath);
  return wt?.branchName ?? basedOnPath;
}
