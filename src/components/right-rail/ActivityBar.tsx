import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { RightRailModule, RightRailModuleId } from "./types";

type ActivityBarProps = {
  modules: readonly RightRailModule[];
  activeId: RightRailModuleId;
  onSelect: (id: RightRailModuleId) => void;
};

/**
 * Horizontal top module switcher (Orca top activity bar).
 */
export function ActivityBar({ modules, activeId, onSelect }: ActivityBarProps) {
  return (
    <nav
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      aria-label="右侧模块"
    >
      {modules.map((module) => {
        const Icon = module.icon;
        const active = module.id === activeId;
        return (
          <Button
            key={module.id}
            type="button"
            size="icon-sm"
            variant="ghost"
            title={module.title}
            aria-label={module.title}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 text-muted-foreground",
              active && "bg-sidebar-primary/15 text-sidebar-primary",
            )}
            onClick={() => onSelect(module.id)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </nav>
  );
}
