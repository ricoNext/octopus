import { BotIcon } from "lucide-react";

import { AgentsModule } from "./modules/agents";
import type { RightRailModule, RightRailModuleId } from "./types";

/** Built-in modules. Add new features by appending here (Orca-style registry). */
export const RIGHT_RAIL_MODULES: readonly RightRailModule[] = [
  {
    id: "agents",
    title: "Agents",
    icon: BotIcon,
    render: (ctx) => (
      <AgentsModule rows={ctx.agentRows ?? []} onFocus={ctx.onFocusAgent} />
    ),
  },
];

export const DEFAULT_RIGHT_RAIL_MODULE_ID: RightRailModuleId = RIGHT_RAIL_MODULES[0]!.id;

export function getRightRailModule(id: RightRailModuleId): RightRailModule | undefined {
  return RIGHT_RAIL_MODULES.find((module) => module.id === id);
}

export function listVisibleRightRailModules(
  modules: readonly RightRailModule[] = RIGHT_RAIL_MODULES,
  ctx: { contextId: string | null } = { contextId: null },
): RightRailModule[] {
  return modules.filter((module) => module.visible?.(ctx) ?? true);
}
