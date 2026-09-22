import { useEffect, useRef } from "react";

import { PaneManager } from "@/lib/pane-manager/pane-manager";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";

type TerminalWorkspaceProps = {
  tab: TerminalTab;
  cwdId: string;
  active: boolean;
  onChange: (next: TerminalTab) => void;
  onSplitLeaf: (leafId: string, direction: "horizontal" | "vertical") => void;
  onCloseLeaf: (leafId: string) => void;
};

export function TerminalWorkspace({
  tab,
  cwdId,
  active,
  onChange,
  onSplitLeaf,
  onCloseLeaf,
}: TerminalWorkspaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<PaneManager | null>(null);
  const tabRef = useRef(tab);
  const onChangeRef = useRef(onChange);
  const onSplitLeafRef = useRef(onSplitLeaf);
  const onCloseLeafRef = useRef(onCloseLeaf);
  tabRef.current = tab;
  onChangeRef.current = onChange;
  onSplitLeafRef.current = onSplitLeaf;
  onCloseLeafRef.current = onCloseLeaf;

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
          onChangeRef.current({ ...tabRef.current, activeLeafId: leafId });
        },
        onRatioChange: (layout) => {
          onChangeRef.current({ ...tabRef.current, layout });
        },
        onSplitLeaf: (leafId, direction) => {
          onSplitLeafRef.current(leafId, direction);
        },
        onCloseLeaf: (leafId) => {
          onCloseLeafRef.current(leafId);
        },
      },
    });
    managerRef.current = manager;
    manager.syncLayout();
    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [tab.id, cwdId]);

  useEffect(() => {
    managerRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    managerRef.current?.syncLayout();
  }, [tab.layout, tab.sessionByLeafId]);

  useEffect(() => {
    managerRef.current?.focusLeaf(tab.activeLeafId);
  }, [tab.activeLeafId]);

  return <div ref={hostRef} className="h-full min-h-0 w-full" />;
}
