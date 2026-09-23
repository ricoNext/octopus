import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { PanelRightCloseIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ActivityBar } from "@/components/right-rail/ActivityBar";
import { RightRailContent } from "@/components/right-rail/RightRailContent";
import {
  DEFAULT_RIGHT_RAIL_MODULE_ID,
  getRightRailModule,
  listVisibleRightRailModules,
} from "@/components/right-rail/registry";
import type { RightRailModuleId } from "@/components/right-rail/types";
import type { AgentRowView } from "@/lib/agents/types";

const ACTIVE_MODULE_KEY = "octopus.right-rail.active-module";

type RightPanelProps = {
  onCollapse: () => void;
  startWindowDrag: (event: MouseEvent<HTMLElement>) => void;
  /** Current project/worktree context id for module visibility. */
  contextId?: string | null;
  agentRows?: AgentRowView[];
  onFocusAgent?: (sessionId: string) => void;
};

function readActiveModuleId(): RightRailModuleId {
  try {
    const value = localStorage.getItem(ACTIVE_MODULE_KEY)?.trim();
    if (value && getRightRailModule(value)) {
      return value;
    }
  } catch {
    // ignore
  }
  return DEFAULT_RIGHT_RAIL_MODULE_ID;
}

export function RightPanel({
  onCollapse,
  startWindowDrag,
  contextId = null,
  agentRows = [],
  onFocusAgent,
}: RightPanelProps) {
  const ctx = useMemo(
    () => ({ contextId, agentRows, onFocusAgent }),
    [contextId, agentRows, onFocusAgent],
  );
  const visibleModules = useMemo(() => listVisibleRightRailModules(undefined, ctx), [ctx]);
  const [activeId, setActiveId] = useState<RightRailModuleId>(readActiveModuleId);

  useEffect(() => {
    if (visibleModules.some((module) => module.id === activeId)) {
      return;
    }
    const fallback = visibleModules[0]?.id ?? DEFAULT_RIGHT_RAIL_MODULE_ID;
    setActiveId(fallback);
  }, [activeId, visibleModules]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_MODULE_KEY, activeId);
    } catch {
      // ignore
    }
  }, [activeId]);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col overflow-hidden border-l bg-sidebar text-sidebar-foreground">
      {/* Top activity bar — Orca-style horizontal module switcher */}
      <div
        className="flex h-9 min-h-9 items-center gap-1 border-b px-1.5"
        data-tauri-drag-region
        onMouseDown={startWindowDrag}
      >
        <ActivityBar modules={visibleModules} activeId={activeId} onSelect={setActiveId} />
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          onClick={onCollapse}
          aria-label="折叠右侧栏"
          title="折叠右侧栏"
        >
          <PanelRightCloseIcon />
        </Button>
      </div>
      <RightRailContent activeId={activeId} ctx={ctx} />
    </aside>
  );
}
