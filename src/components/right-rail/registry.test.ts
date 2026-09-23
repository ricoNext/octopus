import { describe, expect, it } from "vitest";

import {
  DEFAULT_RIGHT_RAIL_MODULE_ID,
  getRightRailModule,
  listVisibleRightRailModules,
  RIGHT_RAIL_MODULES,
} from "./registry";

describe("right-rail registry", () => {
  it("exposes built-in modules with Agents first", () => {
    expect(RIGHT_RAIL_MODULES.map((module) => module.id)).toEqual([
      "agents",
      "files",
      "git",
    ]);
    expect(DEFAULT_RIGHT_RAIL_MODULE_ID).toBe("agents");
    expect(getRightRailModule("git")?.title).toBe("Git");
    expect(getRightRailModule("agents")?.title).toBe("Agents");
  });

  it("lists visible modules", () => {
    expect(listVisibleRightRailModules().map((module) => module.id)).toEqual([
      "agents",
      "files",
      "git",
    ]);
  });
});
