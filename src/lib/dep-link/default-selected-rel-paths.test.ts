import { describe, expect, it } from "vitest";
import { defaultSelectedRelPaths } from "./default-selected-rel-paths";

describe("defaultSelectedRelPaths", () => {
  it("link selects all", () => {
    expect(
      defaultSelectedRelPaths({
        mode: "link",
        available: ["", "packages/a"],
        recorded: [""],
      }),
    ).toEqual(["", "packages/a"]);
  });

  it("relink prefers recorded intersection", () => {
    expect(
      defaultSelectedRelPaths({
        mode: "relink",
        available: ["", "packages/a", "packages/b"],
        recorded: ["", "packages/b", "packages/gone"],
      }),
    ).toEqual(["", "packages/b"]);
  });

  it("relink falls back to all available when intersection empty", () => {
    expect(
      defaultSelectedRelPaths({
        mode: "relink",
        available: ["", "packages/a"],
        recorded: ["packages/gone"],
      }),
    ).toEqual(["", "packages/a"]);
  });
});
