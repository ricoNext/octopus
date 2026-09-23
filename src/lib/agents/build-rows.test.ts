import { describe, expect, it } from "vitest";
import { createLeaf } from "@/lib/terminal/pane-layout";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";
import type { AppSnapshot } from "@/types";
import { buildAgentRows } from "./build-rows";
import type { AgentPresence } from "./types";

function tab(partial: Partial<TerminalTab> & Pick<TerminalTab, "id" | "label" | "activeLeafId" | "sessionByLeafId">): TerminalTab {
  return {
    layout: createLeaf(partial.activeLeafId),
    ...partial,
  };
}

const snapshot: AppSnapshot = {
  projects: [
    {
      id: "proj1",
      name: "Octopus",
      rootPath: "/tmp/octopus",
      defaultBranch: "main",
      mainBranch: "main",
      pathMissing: false,
    },
  ],
  worktrees: [
    {
      id: "wt1",
      projectId: "proj1",
      displayName: "feature",
      branchName: "feature/x",
      startFrom: null,
      path: "/tmp/octopus-wt",
      origin: "app",
      status: "ready",
      missing: false,
    },
  ],
};

describe("buildAgentRows", () => {
  it("builds main and worktree rows and skips orphans", () => {
    const presence = new Map<string, AgentPresence>([
      [
        "s-main",
        { sessionId: "s-main", contextId: "proj1", agentId: "codex" },
      ],
      [
        "s-wt",
        { sessionId: "s-wt", contextId: "wt1", agentId: "codebuddy", processName: "codebuddy" },
      ],
      [
        "orphan",
        { sessionId: "orphan", contextId: "proj1", agentId: "codex" },
      ],
    ]);
    const tabsByContext: Record<string, TerminalTab[]> = {
      proj1: [tab({ id: "t1", label: "终端 1", activeLeafId: "l1", sessionByLeafId: { l1: "s-main" } })],
      wt1: [
        tab({
          id: "t2",
          label: "终端 2",
          activeLeafId: "l2",
          sessionByLeafId: { l2: "s-wt", l3: "s-other" },
        }),
      ],
    };
    const rows = buildAgentRows(presence, snapshot, tabsByContext);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sessionId: "s-main",
      projectName: "Octopus",
      branchName: "main",
      terminalLabel: "终端 1",
      agentLabel: "Codex",
    });
    expect(rows[1]).toMatchObject({
      sessionId: "s-wt",
      projectName: "Octopus",
      branchName: "feature/x",
      terminalLabel: "终端 2 · l2",
      agentLabel: "CodeBuddy",
    });
  });
});
