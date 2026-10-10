import { describe, expect, it } from "vitest";
import {
  enabledAgentIds,
  filterPresenceByEnabled,
  isAgentEnabled,
  resolveDefaultAgent,
} from "./settings-resolve";
import type { AgentPresence, AgentUserSettings } from "./types";
import { buildAgentRows } from "./build-rows";
import { createLeaf } from "@/lib/terminal/pane-layout";
import type { CenterTab, TerminalTab } from "@/lib/terminal/terminal-tab";
import type { AppSnapshot } from "@/types";

function settings(
  partial: Partial<AgentUserSettings> &
    Pick<AgentUserSettings, "defaultAgent" | "disabledAgents">,
): AgentUserSettings {
  return {
    agentOverrides: {},
    ...partial,
  };
}

describe("settings-resolve", () => {
  it("isAgentEnabled respects disabledAgents case-insensitively", () => {
    const s = settings({ defaultAgent: "codex", disabledAgents: ["CodeBuddy"] });
    expect(isAgentEnabled(s, "codex")).toBe(true);
    expect(isAgentEnabled(s, "codebuddy")).toBe(false);
  });

  it("resolveDefaultAgent falls back when disabled", () => {
    expect(
      resolveDefaultAgent(
        settings({ defaultAgent: "codebuddy", disabledAgents: ["codebuddy"] }),
      ),
    ).toBe("codex");
    expect(
      resolveDefaultAgent(
        settings({
          defaultAgent: "codebuddy",
          disabledAgents: ["codex", "codebuddy"],
        }),
      ),
    ).toBe("blank");
    expect(
      resolveDefaultAgent(settings({ defaultAgent: "blank", disabledAgents: [] })),
    ).toBe("blank");
  });

  it("filterPresenceByEnabled drops disabled ids", () => {
    const presence = new Map<string, AgentPresence>([
      ["s1", { sessionId: "s1", contextId: "c1", agentId: "codex" }],
      ["s2", { sessionId: "s2", contextId: "c1", agentId: "codebuddy" }],
    ]);
    const filtered = filterPresenceByEnabled(presence, ["codex"]);
    expect([...filtered.keys()]).toEqual(["s1"]);
    expect(enabledAgentIds(settings({ defaultAgent: "codex", disabledAgents: ["codebuddy"] }))).toEqual([
      "codex",
    ]);
  });

  it("disabled id does not enter buildAgentRows after filter", () => {
    function tab(
      partial: Partial<TerminalTab> &
        Pick<TerminalTab, "id" | "label" | "activeLeafId" | "sessionByLeafId">,
    ): TerminalTab {
      return {
        kind: "terminal",
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
      worktrees: [],
    };
    const presence = new Map<string, AgentPresence>([
      ["s-codex", { sessionId: "s-codex", contextId: "proj1", agentId: "codex" }],
      [
        "s-buddy",
        { sessionId: "s-buddy", contextId: "proj1", agentId: "codebuddy" },
      ],
    ]);
    const tabsByContext: Record<string, CenterTab[]> = {
      proj1: [
        tab({
          id: "t1",
          label: "终端 1",
          activeLeafId: "l1",
          sessionByLeafId: { l1: "s-codex" },
        }),
        tab({
          id: "t2",
          label: "终端 2",
          activeLeafId: "l2",
          sessionByLeafId: { l2: "s-buddy" },
        }),
      ],
    };
    const filtered = filterPresenceByEnabled(presence, new Set(["codex"]));
    const rows = buildAgentRows(filtered, snapshot, tabsByContext);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agentId).toBe("codex");
  });
});
