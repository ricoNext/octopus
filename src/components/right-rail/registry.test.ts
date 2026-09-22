import { describe, expect, it } from "vitest";

import {
  DEFAULT_RIGHT_RAIL_MODULE_ID,
  getRightRailModule,
  listVisibleRightRailModules,
  RIGHT_RAIL_MODULES,
} from "./registry";

describe("right-rail registry", () => {
  it("exposes built-in placeholder modules", () => {
    expect(RIGHT_RAIL_MODULES.map((module) => module.id)).toEqual(["files", "git"]);
    expect(DEFAULT_RIGHT_RAIL_MODULE_ID).toBe("files");
    expect(getRightRailModule("git")?.title).toBe("Git");
  });

  it("lists visible modules", () => {
    expect(listVisibleRightRailModules().map((module) => module.id)).toEqual(["files", "git"]);
  });
});
