export type AgentId = "codex" | "codebuddy";

export type AgentPresenceEvent = {
  sessionId: string;
  contextId: string;
  agentId: AgentId | null;
  processName?: string | null;
};

export type AgentPresence = {
  sessionId: string;
  contextId: string;
  agentId: AgentId;
  processName?: string;
};

export type AgentRowView = {
  sessionId: string;
  contextId: string;
  agentId: AgentId;
  agentLabel: string;
  projectName: string;
  branchName: string;
  terminalLabel: string;
};

export type DefaultAgentId = AgentId | "blank";

export type AgentOverride = {
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentUserSettings = {
  defaultAgent: string;
  disabledAgents: string[];
  agentOverrides: Record<string, AgentOverride>;
};

export type CatalogEntryDto = {
  id: string;
  label: string;
  detectCmd: string;
  launchCmd: string;
  processMatch: string;
  defaultArgs: string[];
  defaultEnv: Record<string, string>;
};

export type AgentsStateDto = {
  settings: AgentUserSettings;
  catalog: CatalogEntryDto[];
  installed: Record<string, boolean>;
  resolvedDefault: string;
};

export type ResolvedLaunchDto = {
  cmd: string;
  args: string[];
  env: Record<string, string>;
  shellLine: string;
};
