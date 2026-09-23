import type { AppSnapshot } from "@/types";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";
import type { AgentPresence, AgentRowView } from "./types";
import { agentDisplayName } from "./labels";
import { findSessionLocation } from "./resolve-session";

export function buildAgentRows(
  presenceBySession: ReadonlyMap<string, AgentPresence>,
  snapshot: AppSnapshot,
  tabsByContext: Record<string, TerminalTab[]>,
): AgentRowView[] {
  const rows: AgentRowView[] = [];
  for (const presence of presenceBySession.values()) {
    const loc = findSessionLocation(tabsByContext, presence.sessionId);
    if (!loc) {
      continue;
    }
    const tab = (tabsByContext[loc.contextId] ?? []).find((item) => item.id === loc.tabId);
    if (!tab) {
      continue;
    }
    const sessionCount = Object.keys(tab.sessionByLeafId).length;
    let terminalLabel = tab.label;
    if (sessionCount > 1) {
      terminalLabel = `${tab.label} · ${loc.leafId.slice(0, 4)}`;
    }

    const project = snapshot.projects.find((item) => item.id === presence.contextId);
    const worktree = snapshot.worktrees.find((item) => item.id === presence.contextId);
    let projectName = "";
    let branchName = "";
    if (project) {
      projectName = project.name;
      branchName = project.mainBranch ?? project.defaultBranch ?? "";
    } else if (worktree) {
      projectName =
        snapshot.projects.find((item) => item.id === worktree.projectId)?.name ?? "";
      branchName = worktree.branchName;
    }

    rows.push({
      sessionId: presence.sessionId,
      contextId: presence.contextId,
      agentId: presence.agentId,
      agentLabel: agentDisplayName(presence.agentId),
      projectName,
      branchName,
      terminalLabel,
    });
  }

  rows.sort((a, b) => {
    const byProject = a.projectName.localeCompare(b.projectName);
    if (byProject !== 0) return byProject;
    const byTerm = a.terminalLabel.localeCompare(b.terminalLabel);
    if (byTerm !== 0) return byTerm;
    return a.sessionId.localeCompare(b.sessionId);
  });
  return rows;
}
