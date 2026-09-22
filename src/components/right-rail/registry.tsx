import { FilesIcon, GitBranchIcon } from "lucide-react";

import { FilesPlaceholderModule } from "./modules/files-placeholder";
import { GitPlaceholderModule } from "./modules/git-placeholder";
import type { RightRailModule, RightRailModuleId } from "./types";

/** Built-in modules. Add new features by appending here (Orca-style registry). */
export const RIGHT_RAIL_MODULES: readonly RightRailModule[] = [
  {
    id: "files",
    title: "文件",
    icon: FilesIcon,
    render: () => <FilesPlaceholderModule />,
  },
  {
    id: "git",
    title: "Git",
    icon: GitBranchIcon,
    render: () => <GitPlaceholderModule />,
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
