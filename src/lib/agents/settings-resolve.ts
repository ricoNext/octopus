import type { AgentId, AgentPresence, AgentUserSettings } from "./types";

const CATALOG_IDS: AgentId[] = ["codex", "codebuddy"];

export function isAgentEnabled(
  settings: Pick<AgentUserSettings, "disabledAgents">,
  id: string,
): boolean {
  return !settings.disabledAgents.some(
    (disabled) => disabled.toLowerCase() === id.toLowerCase(),
  );
}

export function enabledAgentIds(
  settings: Pick<AgentUserSettings, "disabledAgents">,
  catalogIds: readonly string[] = CATALOG_IDS,
): string[] {
  return catalogIds.filter((id) => isAgentEnabled(settings, id));
}

/** Resolve effective default: blank, or first still-enabled catalog id, or blank. */
export function resolveDefaultAgent(
  settings: Pick<AgentUserSettings, "defaultAgent" | "disabledAgents">,
  catalogIds: readonly string[] = CATALOG_IDS,
): string {
  const configured = settings.defaultAgent;
  if (configured === "blank") {
    return "blank";
  }
  if (
    catalogIds.includes(configured) &&
    isAgentEnabled(settings, configured)
  ) {
    return configured;
  }
  const enabled = enabledAgentIds(settings, catalogIds);
  return enabled[0] ?? "blank";
}


/** Rewrite defaultAgent to the resolved fallback when it points at a disabled/unknown id. */
export function coalesceDefaultAgent(
  settings: AgentUserSettings,
  catalogIds: readonly string[] = CATALOG_IDS,
): { settings: AgentUserSettings; changed: boolean } {
  const resolved = resolveDefaultAgent(settings, catalogIds);
  if (resolved === settings.defaultAgent) {
    return { settings, changed: false };
  }
  return {
    settings: { ...settings, defaultAgent: resolved },
    changed: true,
  };
}

/** Drop presence entries whose agentId is not in the enabled set. */
export function filterPresenceByEnabled(
  presenceBySession: ReadonlyMap<string, AgentPresence>,
  enabledIds: ReadonlySet<string> | readonly string[],
): Map<string, AgentPresence> {
  const enabled =
    enabledIds instanceof Set ? enabledIds : new Set(enabledIds);
  const out = new Map<string, AgentPresence>();
  for (const [sessionId, presence] of presenceBySession) {
    if (enabled.has(presence.agentId)) {
      out.set(sessionId, presence);
    }
  }
  return out;
}
