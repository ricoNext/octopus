export const TERMINAL_CONTEXT_HOT_RETAIN_LIMIT = 4;
export const TERMINAL_TAB_HOT_RETAIN_LIMIT = 6;

export function warmMountKey(contextId: string, tabId: string): string {
  return `${contextId}::${tabId}`;
}

export function parseWarmMountKey(key: string): { contextId: string; tabId: string } {
  const sep = key.indexOf("::");
  if (sep < 0) {
    return { contextId: key, tabId: "" };
  }
  return { contextId: key.slice(0, sep), tabId: key.slice(sep + 2) };
}

export type SelectWarmMountKeysInput = {
  enabled: boolean;
  visitedOldestToNewest: string[]; // newest at end (LRU bump)
  selectedContextId: string | null;
  tabsByContext: Record<string, Array<{ id: string }>>;
  activeTabByContext: Record<string, string>;
  tabActivationOldestToNewest: string[]; // warmMountKey strings, newest at end
  contextLimit?: number;
  tabLimit?: number;
};

/** Returns set of warmMountKey strings that should stay mounted. */
export function selectWarmMountKeys(input: SelectWarmMountKeysInput): Set<string> {
  const {
    enabled,
    visitedOldestToNewest,
    selectedContextId,
    tabsByContext,
    activeTabByContext,
    tabActivationOldestToNewest,
    contextLimit = TERMINAL_CONTEXT_HOT_RETAIN_LIMIT,
    tabLimit = TERMINAL_TAB_HOT_RETAIN_LIMIT,
  } = input;

  if (!enabled) {
    const all = new Set<string>();
    for (const contextId of visitedOldestToNewest) {
      for (const tab of tabsByContext[contextId] ?? []) {
        all.add(warmMountKey(contextId, tab.id));
      }
    }
    return all;
  }

  const warmContexts: string[] = [];
  const seen = new Set<string>();

  if (selectedContextId) {
    warmContexts.push(selectedContextId);
    seen.add(selectedContextId);
  }

  for (let i = visitedOldestToNewest.length - 1; i >= 0; i -= 1) {
    if (warmContexts.length >= contextLimit) {
      break;
    }
    const contextId = visitedOldestToNewest[i]!;
    if (seen.has(contextId)) {
      continue;
    }
    warmContexts.push(contextId);
    seen.add(contextId);
  }

  const result = new Set<string>();

  for (const contextId of warmContexts) {
    const tabs = tabsByContext[contextId] ?? [];
    const tabIds = new Set(tabs.map((tab) => tab.id));
    const warmTabs: string[] = [];
    const tabSeen = new Set<string>();

    const activeTabId = activeTabByContext[contextId];
    if (activeTabId && tabIds.has(activeTabId)) {
      warmTabs.push(activeTabId);
      tabSeen.add(activeTabId);
    }

    for (let i = tabActivationOldestToNewest.length - 1; i >= 0; i -= 1) {
      if (warmTabs.length >= tabLimit) {
        break;
      }
      const key = tabActivationOldestToNewest[i]!;
      const parsed = parseWarmMountKey(key);
      if (parsed.contextId !== contextId) {
        continue;
      }
      if (!tabIds.has(parsed.tabId) || tabSeen.has(parsed.tabId)) {
        continue;
      }
      warmTabs.push(parsed.tabId);
      tabSeen.add(parsed.tabId);
    }

    for (const tabId of warmTabs) {
      result.add(warmMountKey(contextId, tabId));
    }
  }

  return result;
}
