import { useEffect, useRef } from "react";

import { PaneManager } from "@/lib/pane-manager/pane-manager";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";

type TerminalWorkspaceProps = {
  tab: TerminalTab;
  cwdId: string;
  active: boolean;
  onChange: (next: TerminalTab) => void;
};

export function TerminalWorkspace({ tab, cwdId, active, onChange }: TerminalWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<PaneManager | null>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const manager = new PaneManager(host, {
      cwdId,
      getLayout: () => tabRef.current.layout,
      getSessionId: (leafId) => tabRef.current.sessionByLeafId[leafId] ?? leafId,
      getActiveLeafId: () => tabRef.current.activeLeafId,
      callbacks: {
        onActiveLeafChange: (leafId) => {
          onChange({ ...tabRef.current, activeLeafId: leafId });
        },
        onRatioChange: (layout) => {
          onChange({ ...tabRef.current, layout });
        },
      },
    });
    managerRef.current = manager;
    manager.syncLayout();
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [tab.id, cwdId, onChange]);

  useEffect(() => {
    managerRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    managerRef.current?.syncLayout();
    managerRef.current?.focusLeaf(tab.activeLeafId);
  }, [tab.layout, tab.activeLeafId, tab.sessionByLeafId]);

  return <div ref={hostRef} className="h-full min-h-0 w-full" />;
}
