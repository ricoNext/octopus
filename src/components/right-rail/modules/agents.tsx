import type { AgentRowView } from "@/lib/agents/types";

type AgentsModuleProps = {
  rows: AgentRowView[];
  onFocus?: (sessionId: string) => void;
};

export function AgentsModule({ rows, onFocus }: AgentsModuleProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-sidebar-border bg-sidebar-accent/40 px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">暂无运行中的 agent</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-1">
      {rows.map((row) => (
        <button
          key={row.sessionId}
          type="button"
          className="w-full rounded-md px-2 py-1.5 text-left hover:bg-sidebar-accent"
          onClick={() => onFocus?.(row.sessionId)}
        >
          <div className="flex items-center gap-1.5 text-xs text-sidebar-foreground">
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="truncate font-medium">
              {row.projectName}
              {row.branchName ? ` · ${row.branchName}` : ""}
            </span>
          </div>
          <div className="mt-0.5 truncate pl-3 text-[11px] text-muted-foreground">
            {row.terminalLabel} / {row.agentLabel}
          </div>
        </button>
      ))}
    </div>
  );
}
