import { getRightRailModule } from "./registry";
import type { RightRailContext, RightRailModuleId } from "./types";

type RightRailContentProps = {
  activeId: RightRailModuleId;
  ctx: RightRailContext;
};

export function RightRailContent({ activeId, ctx }: RightRailContentProps) {
  const module = getRightRailModule(activeId);
  if (!module) {
    return (
      <div className="p-3 text-sm text-muted-foreground">未找到模块：{activeId}</div>
    );
  }
  return <div className="min-h-0 flex-1 overflow-y-auto p-3">{module.render(ctx)}</div>;
}
