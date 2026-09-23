import type { AgentId } from "./types";

export function agentDisplayName(id: AgentId): string {
  return id === "codebuddy" ? "CodeBuddy" : "Codex";
}
