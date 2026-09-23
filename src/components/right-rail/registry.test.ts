import { describe, expect, it } from "vitest";

import {
  DEFAULT_RIGHT_RAIL_MODULE_ID,
  getRightRailModule,
  listVisibleRightRailModules,
  RIGHT_RAIL_MODULES,
} from "./registry";

describe("right-rail registry", () => {
  it("exposes Agents as the only built-in module", () => {
    expect(RIGHT_RAIL_MODULES.map((module) => module.id)).toEqual(["agents"]);
    expect(DEFAULT_RIGHT_RAIL_MODULE_ID).toBe("agents");
    expect(getRightRailModule("agents")?.title).toBe("Agents");
    expect(getRightRailModule("files")).toBeUndefined();
    expect(getRightRailModule("git")).toBeUndefined();
  });

  it("lists visible modules", () => {
    expect(listVisibleRightRailModules().map((module) => module.id)).toEqual(["agents"]);
  });
});
