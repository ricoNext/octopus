import { describe, expect, it } from "vitest";
import { relPathLabel } from "./rel-path-label";

describe("relPathLabel", () => {
  it("maps root", () => {
    expect(relPathLabel("")).toBe("根");
    expect(relPathLabel("packages/foo")).toBe("packages/foo");
  });

  it("maps '.' to root label", () => {
    expect(relPathLabel(".")).toBe("根");
  });
});
