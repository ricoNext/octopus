import { describe, expect, it } from "vitest";
import { fileNameFromRel } from "./preview-chip";

describe("preview-chip", () => {
  it("basename from relPath", () => {
    expect(fileNameFromRel("src/App.tsx")).toBe("App.tsx");
    expect(fileNameFromRel("README.md")).toBe("README.md");
  });

  it("handles nested paths and backslashes", () => {
    expect(fileNameFromRel("a/b/c.ts")).toBe("c.ts");
    expect(fileNameFromRel("a\\b\\c.ts")).toBe("c.ts");
  });
});
