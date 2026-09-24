import { describe, expect, it } from "vitest";
import { basedOnLabel, resolveBasedOnPath } from "./resolve-based-on";

const project = {
  id: "p1",
  name: "demo",
  rootPath: "/repo",
  defaultBranch: "main",
  mainBranch: "main",
  pathMissing: false,
};

describe("resolveBasedOnPath", () => {
  it("uses matching worktree path", () => {
    const wts = [
      {
        id: "w1",
        projectId: "p1",
        displayName: "feat",
        branchName: "feat",
        startFrom: "main",
        path: "/repo-worktrees/feat",
        origin: "app" as const,
        status: "ready" as const,
        missing: false,
      },
    ];
    expect(resolveBasedOnPath(project, "feat", wts)).toBe("/repo-worktrees/feat");
    expect(resolveBasedOnPath(project, "main", wts)).toBe("/repo");
  });
});

describe("basedOnLabel", () => {
  it("labels main repo and matching worktree branch", () => {
    const wts = [
      {
        id: "w1",
        projectId: "p1",
        displayName: "feat",
        branchName: "feat",
        startFrom: "main",
        path: "/repo-worktrees/feat",
        origin: "app" as const,
        status: "ready" as const,
        missing: false,
      },
    ];
    expect(basedOnLabel(project, "/repo", wts)).toBe("main（主仓）");
    expect(basedOnLabel(project, "/repo-worktrees/feat", wts)).toBe("feat");
    expect(basedOnLabel(project, "/unknown", wts)).toBe("/unknown");
  });
});
