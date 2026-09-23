import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { api } from "@/lib/api";
import type { AgentId, AgentPresence, AgentPresenceEvent } from "./types";

const presence = new Map<string, AgentPresence>();
const listeners = new Set<(map: ReadonlyMap<string, AgentPresence>) => void>();

let listenPromise: Promise<void> | null = null;
let unlisten: UnlistenFn | null = null;
let hydratePromise: Promise<void> | null = null;

function isAgentId(value: string | null | undefined): value is AgentId {
  return value === "codex" || value === "codebuddy";
}

function publish() {
  const snapshot = new Map(presence);
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function applyEvent(event: AgentPresenceEvent) {
  const { sessionId, contextId, agentId, processName } = event;
  if (!sessionId) {
    return;
  }
  if (agentId == null) {
    if (presence.delete(sessionId)) {
      publish();
    }
    return;
  }
  if (!isAgentId(agentId)) {
    return;
  }
  const next: AgentPresence = {
    sessionId,
    contextId: contextId ?? "",
    agentId,
  };
  if (processName) {
    next.processName = processName;
  }
  presence.set(sessionId, next);
  publish();
}

function replaceFromSnapshot(
  items: Array<{
    sessionId: string;
    contextId: string;
    agentId: string;
    processName?: string | null;
  }>,
) {
  presence.clear();
  for (const item of items) {
    if (!isAgentId(item.agentId)) {
      continue;
    }
    const next: AgentPresence = {
      sessionId: item.sessionId,
      contextId: item.contextId ?? "",
      agentId: item.agentId,
    };
    if (item.processName) {
      next.processName = item.processName;
    }
    presence.set(item.sessionId, next);
  }
  publish();
}

function ensureListen(): Promise<void> {
  if (listenPromise) {
    return listenPromise;
  }
  listenPromise = listen<AgentPresenceEvent>("agent-presence", (event) => {
    applyEvent(event.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return listenPromise;
}

async function hydrateFromDaemon() {
  if (hydratePromise) {
    return hydratePromise;
  }
  hydratePromise = (async () => {
    try {
      const items = await api.listAgentPresence();
      replaceFromSnapshot(items);
    } catch {
      // Daemon may not be ready yet; live events can still fill the map.
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}

async function maybeTeardown() {
  if (listeners.size === 0 && unlisten) {
    unlisten();
    unlisten = null;
    listenPromise = null;
  }
}

export function getAgentPresenceSnapshot(): ReadonlyMap<string, AgentPresence> {
  return new Map(presence);
}

export function subscribeAgentPresence(
  onChange: (map: ReadonlyMap<string, AgentPresence>) => void,
): () => void {
  listeners.add(onChange);
  onChange(new Map(presence));
  void ensureListen().then(() => hydrateFromDaemon());
  return () => {
    listeners.delete(onChange);
    void maybeTeardown();
  };
}
