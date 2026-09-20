import { RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CopyableError } from "@/components/CopyableError";

type DiffPaneProps = {
  collapsed: boolean;
  loading: boolean;
  text: string;
  empty: boolean;
  error: string | null;
  onRefresh: () => void;
  onToggle: () => void;
};

export function DiffPane({
  collapsed,
  loading,
  text,
  empty,
  error,
  onRefresh,
  onToggle,
}: DiffPaneProps) {
  return (
    <aside
      className={
        collapsed
          ? "flex h-full w-10 shrink-0 flex-col border-l bg-background"
          : "flex h-full w-[28rem] shrink-0 flex-col border-l bg-background"
      }
    >
      <div className="flex items-center gap-2 border-b px-2 py-2">
        <Button size="xs" variant="ghost" onClick={onToggle}>
          {collapsed ? "差异" : "收起"}
        </Button>
        {collapsed ? null : (
          <>
            <p className="flex-1 text-sm font-medium">只读差异</p>
            <Button size="icon-xs" variant="ghost" onClick={onRefresh} aria-label="刷新差异">
              <RefreshCwIcon />
            </Button>
          </>
        )}
      </div>
      {collapsed ? null : (
        <ScrollArea className="flex-1">
          <div className="p-3">
            {loading ? <p className="text-sm text-muted-foreground">正在读取差异…</p> : null}
            {error ? <CopyableError text={error} /> : null}
            {!loading && !error && empty ? (
              <p className="text-sm text-muted-foreground">与起始分支没有差异</p>
            ) : null}
            {!loading && !error && !empty ? (
              <pre className="overflow-x-auto font-mono text-xs leading-5 whitespace-pre-wrap">
                {text}
              </pre>
            ) : null}
            <div className="pt-3">
              <Button size="sm" variant="outline" onClick={onRefresh}>
                刷新差异
              </Button>
            </div>
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
