import type { AgentId } from "./types";

export type PendingLaunch = {
  agentId: AgentId;
  installed: boolean;
};

const pendingBySession = new Map<string, PendingLaunch>();

/** Queue a one-shot agent launch for a newly created terminal session. */
export function queuePendingLaunch(sessionId: string, launch: PendingLaunch): void {
  pendingBySession.set(sessionId, launch);
}

/** Take and clear a pending launch for this session, if any. */
export function consumePendingLaunch(sessionId: string): PendingLaunch | null {
  const launch = pendingBySession.get(sessionId);
  if (!launch) {
    return null;
  }
  pendingBySession.delete(sessionId);
  return launch;
}
