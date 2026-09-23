import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { AgentRowView } from "@/lib/agents/types";

export type RightRailModuleId = string;

export type RightRailContext = {
  /** Selected worktree or project context id, when any. */
  contextId: string | null;
  agentRows?: AgentRowView[];
  onFocusAgent?: (sessionId: string) => void;
};

export type RightRailModule = {
  id: RightRailModuleId;
  title: string;
  icon: LucideIcon;
  /** Return false to hide from the activity bar for the current context. */
  visible?: (ctx: RightRailContext) => boolean;
  render: (ctx: RightRailContext) => ReactNode;
};
