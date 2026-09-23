import { describe, expect, it } from "vitest";
import { createLeaf } from "@/lib/terminal/pane-layout";
import type { TerminalTab } from "@/lib/terminal/terminal-tab";
import { findSessionLocation } from "./resolve-session";

function tab(partial: Partial<TerminalTab> & Pick<TerminalTab, "id" | "activeLeafId" | "sessionByLeafId">): TerminalTab {
  return {
    label: "终端 1",
    layout: createLeaf(partial.activeLeafId),
    ...partial,
  };
}

describe("findSessionLocation", () => {
  it("finds session across contexts", () => {
    const tabsByContext: Record<string, TerminalTab[]> = {
      ctxA: [tab({ id: "t1", activeLeafId: "l1", sessionByLeafId: { l1: "s1" } })],
      ctxB: [tab({ id: "t2", activeLeafId: "l2", sessionByLeafId: { l2: "s2" } })],
    };
    expect(findSessionLocation(tabsByContext, "s2")).toEqual({
      contextId: "ctxB",
      tabId: "t2",
      leafId: "l2",
    });
  });

  it("returns null when missing", () => {
    expect(findSessionLocation({}, "nope")).toBeNull();
  });
});
