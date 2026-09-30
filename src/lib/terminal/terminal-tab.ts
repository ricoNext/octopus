import { fileNameFromRel } from "@/lib/files/preview-chip";
import { createLeaf, type PaneLayoutNode } from "./pane-layout";

export type TerminalTab = {
  kind: "terminal";
  id: string;
  label: string;
  layout: PaneLayoutNode;
  activeLeafId: string;
  sessionByLeafId: Record<string, string>;
};

export type FileTab = {
  kind: "file";
  id: string;
  label: string; // basename(relPath)
  rootPath: string;
  relPath: string;
};

export type CenterTab = TerminalTab | FileTab;

export function isTerminalTab(tab: CenterTab): tab is TerminalTab {
  return tab.kind === "terminal";
}

export function isFileTab(tab: CenterTab): tab is FileTab {
  return tab.kind === "file";
}

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
    kind: "terminal",
    id: tabId,
    label: `终端 ${index}`,
    layout: createLeaf(leafId),
    activeLeafId: leafId,
    sessionByLeafId: { [leafId]: leafId },
  };
}

export function createFileTab(args: {
  rootPath: string;
  relPath: string;
  id?: string;
}): FileTab {
  return {
    kind: "file",
    id: args.id ?? crypto.randomUUID(),
    label: fileNameFromRel(args.relPath),
    rootPath: args.rootPath,
    relPath: args.relPath,
  };
}

/** Same rootPath+relPath within one context's tab list. */
export function findFileTabByPath(
  tabs: readonly CenterTab[],
  rootPath: string,
  relPath: string,
): FileTab | undefined {
  return tabs.find(
    (tab): tab is FileTab =>
      isFileTab(tab) && tab.rootPath === rootPath && tab.relPath === relPath,
  );
}

/**
 * Remove file tab by id. Prefer previous neighbor as next active; else next;
 * if list empty after remove, append a default terminal tab and activate it.
 * Does not kill PTYs (file tabs have none).
 */
export function closeFileTabResult(
  tabs: readonly CenterTab[],
  fileTabId: string,
): { tabs: CenterTab[]; activeTabId: string } | null {
  const index = tabs.findIndex((tab) => isFileTab(tab) && tab.id === fileTabId);
  if (index < 0) return null;

  const nextTabs = tabs.filter((_, i) => i !== index);

  if (nextTabs.length === 0) {
    const terminal = createTerminalTab(1);
    return { tabs: [terminal], activeTabId: terminal.id };
  }

  const activeTabId = index > 0 ? nextTabs[index - 1]!.id : nextTabs[0]!.id;
  return { tabs: [...nextTabs], activeTabId };
}

function migrateTerminalFields(value: Record<string, unknown>): TerminalTab | null {
  if (typeof value.id !== "string" || typeof value.label !== "string") return null;

  // already v2
  if (
    value.layout &&
    typeof value.activeLeafId === "string" &&
    value.sessionByLeafId &&
    typeof value.sessionByLeafId === "object"
  ) {
    return {
      kind: "terminal",
      id: value.id,
      label: value.label,
      layout: value.layout as PaneLayoutNode,
      activeLeafId: value.activeLeafId,
      sessionByLeafId: value.sessionByLeafId as Record<string, string>,
    };
  }

  // v1
  return {
    kind: "terminal",
    id: value.id,
    label: value.label,
    layout: createLeaf(value.id),
    activeLeafId: value.id,
    sessionByLeafId: { [value.id]: value.id },
  };
}

export function migrateCenterTab(raw: unknown): CenterTab | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;

  if (value.kind === "file") {
    if (
      typeof value.id !== "string" ||
      typeof value.rootPath !== "string" ||
      typeof value.relPath !== "string"
    ) {
      return null;
    }
    const label =
      typeof value.label === "string" && value.label.length > 0
        ? value.label
        : fileNameFromRel(value.relPath);
    return {
      kind: "file",
      id: value.id,
      label,
      rootPath: value.rootPath,
      relPath: value.relPath,
    };
  }

  if (value.kind !== undefined && value.kind !== "terminal") {
    return null;
  }

  return migrateTerminalFields(value);
}

/** @deprecated Prefer migrateCenterTab; returns null for non-terminal results. */
export function migrateTerminalTab(raw: unknown): TerminalTab | null {
  const tab = migrateCenterTab(raw);
  if (!tab || !isTerminalTab(tab)) return null;
  return tab;
}

export function migrateTabsByContext(raw: unknown): Record<string, CenterTab[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, CenterTab[]> = {};
  for (const [contextId, rawTabs] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rawTabs)) continue;
    const tabs = rawTabs
      .map((tab) => migrateCenterTab(tab))
      .filter((tab): tab is CenterTab => tab !== null);
    if (tabs.length === 0) continue;
    if (!tabs.some(isTerminalTab)) {
      tabs.push(createTerminalTab(1));
    }
    out[contextId] = tabs;
  }
  return out;
}

export function sessionIdsForTab(tab: TerminalTab): string[] {
  return [...new Set(Object.values(tab.sessionByLeafId))];
}
