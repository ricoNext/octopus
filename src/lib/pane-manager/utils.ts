import type { SplitDirection } from "@/lib/terminal/pane-layout";

export function flexDirectionFor(direction: SplitDirection): "row" | "column" {
  return direction === "vertical" ? "row" : "column";
}
