import { describe, expect, it } from "vitest";
import { flexDirectionFor } from "./utils";

describe("flexDirectionFor", () => {
  it("maps vertical to row (left-right panes)", () => {
    expect(flexDirectionFor("vertical")).toBe("row");
  });

  it("maps horizontal to column (top-bottom panes)", () => {
    expect(flexDirectionFor("horizontal")).toBe("column");
  });
});
