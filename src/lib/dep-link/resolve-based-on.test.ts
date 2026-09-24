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

const featWt = {
  id: "w1",
  projectId: "p1",
  displayName: "feat",
  branchName: "feat",
  startFrom: "main",
  path: "/repo-worktrees/feat",
  origin: "app" as const,
  status: "ready" as const,
  missing: false,
};

describe("resolveBasedOnPath", () => {
  it("uses matching worktree path", () => {
    expect(resolveBasedOnPath(project, "feat", [featWt])).toBe("/repo-worktrees/feat");
    expect(resolveBasedOnPath(project, "main", [featWt])).toBe("/repo");
  });

  it("prefers main repo when startFromBranch matches mainBranch", () => {
    const onFeatureA = { ...project, mainBranch: "feature-a", defaultBranch: "main" };
    const stale = {
      ...featWt,
      id: "w2",
      displayName: "feature-a",
      branchName: "feature-a",
      path: "/repo-worktrees/feature-a-stale",
    };
    expect(resolveBasedOnPath(onFeatureA, "feature-a", [stale])).toBe("/repo");
    expect(resolveBasedOnPath(onFeatureA, "feat", [featWt, stale])).toBe(
      "/repo-worktrees/feat",
    );
  });

  it("does not prefer root when mainBranch is null", () => {
    const noMain = { ...project, mainBranch: null };
    const stale = {
      ...featWt,
      branchName: "feature-a",
      path: "/repo-worktrees/feature-a",
    };
    expect(resolveBasedOnPath(noMain, "feature-a", [stale])).toBe(
      "/repo-worktrees/feature-a",
    );
  });
});

describe("basedOnLabel", () => {
  it("labels main repo and matching worktree branch", () => {
    expect(basedOnLabel(project, "/repo", [featWt])).toBe("main（主仓）");
    expect(basedOnLabel(project, "/repo-worktrees/feat", [featWt])).toBe("feat");
    expect(basedOnLabel(project, "/unknown", [featWt])).toBe("/unknown");
  });

  it("labels main repo with current checkout branch, not defaultBranch", () => {
    const onFeatureA = { ...project, mainBranch: "feature-a", defaultBranch: "main" };
    expect(basedOnLabel(onFeatureA, "/repo", [featWt])).toBe("feature-a（主仓）");
  });

  it("falls back to defaultBranch when mainBranch is null", () => {
    const noMain = { ...project, mainBranch: null, defaultBranch: "develop" };
    expect(basedOnLabel(noMain, "/repo", [])).toBe("develop（主仓）");
  });
});
