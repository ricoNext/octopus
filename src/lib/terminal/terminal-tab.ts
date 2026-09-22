import { createLeaf, type PaneLayoutNode } from "./pane-layout";

export type TerminalTab = {
  id: string;
  label: string;
  layout: PaneLayoutNode;
  activeLeafId: string;
  sessionByLeafId: Record<string, string>;
};

/** Matches Orca getNextTerminalOrdinal: /^Terminal (\d+)$/ against default titles. */
const DEFAULT_TAB_LABEL = /^终端\s+(\d+)$/;

/**
 * Lowest unused "终端 N" index among existing labels (Orca-style).
 * Closing "终端 1" while "终端 2" remains yields 1 for the next tab, not 2 or 3.
 */
export function nextTerminalTabIndex(labels: readonly string[]): number {
  const used = new Set<number>();
  for (const label of labels) {
    const match = DEFAULT_TAB_LABEL.exec(label.trim());
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 1) {
      used.add(value);
    }
  }
  let next = 1;
  while (used.has(next)) {
    next += 1;
  }
  return next;
}

export function createTerminalTab(index: number): TerminalTab {
  const tabId = crypto.randomUUID();
  const leafId = crypto.randomUUID();
  return {
    id: tabId,
    label: `终端 ${index}`,
    layout: createLeaf(leafId),
    activeLeafId: leafId,
    sessionByLeafId: { [leafId]: leafId },
  };
}

export function migrateTerminalTab(raw: unknown): TerminalTab | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;

  // already v2
  if (
    value.layout &&
    typeof value.activeLeafId === "string" &&
    value.sessionByLeafId &&
    typeof value.sessionByLeafId === "object"
  ) {
    return {
      id: value.id,
      label: value.label,
      layout: value.layout as PaneLayoutNode,
      activeLeafId: value.activeLeafId,
      sessionByLeafId: value.sessionByLeafId as Record<string, string>,
    };
  }

  // v1
  return {
    id: value.id,
    label: value.label,
    layout: createLeaf(value.id),
    activeLeafId: value.id,
    sessionByLeafId: { [value.id]: value.id },
  };
}

export function migrateTabsByContext(raw: unknown): Record<string, TerminalTab[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, TerminalTab[]> = {};
  for (const [contextId, rawTabs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rawTabs)) continue;
    const tabs = rawTabs
      .map((tab) => migrateTerminalTab(tab))
      .filter((tab): tab is TerminalTab => tab !== null);
    if (tabs.length > 0) out[contextId] = tabs;
  }
  return out;
}

export function sessionIdsForTab(tab: TerminalTab): string[] {
  return [...new Set(Object.values(tab.sessionByLeafId))];
}
