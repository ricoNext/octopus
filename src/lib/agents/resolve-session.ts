import type { CenterTab } from "@/lib/terminal/terminal-tab";
import { isTerminalTab } from "@/lib/terminal/terminal-tab";

export type SessionLocation = {
  contextId: string;
  tabId: string;
  leafId: string;
};

export function findSessionLocation(
  tabsByContext: Record<string, CenterTab[]>,
  sessionId: string,
): SessionLocation | null {
  for (const [contextId, tabs] of Object.entries(tabsByContext)) {
    for (const tab of tabs) {
      if (!isTerminalTab(tab)) continue;
      for (const [leafId, sid] of Object.entries(tab.sessionByLeafId)) {
        if (sid === sessionId) {
          return { contextId, tabId: tab.id, leafId };
        }
      }
    }
  }
  return null;
}
