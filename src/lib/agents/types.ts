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
