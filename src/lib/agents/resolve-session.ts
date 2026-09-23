import type { TerminalTab } from "@/lib/terminal/terminal-tab";

export type SessionLocation = {
  contextId: string;
  tabId: string;
  leafId: string;
};

export function findSessionLocation(
  tabsByContext: Record<string, TerminalTab[]>,
  sessionId: string,
): SessionLocation | null {
  for (const [contextId, tabs] of Object.entries(tabsByContext)) {
    for (const tab of tabs) {
      for (const [leafId, sid] of Object.entries(tab.sessionByLeafId)) {
        if (sid === sessionId) {
          return { contextId, tabId: tab.id, leafId };
        }
      }
    }
  }
  return null;
}
