import { describe, expect, it } from "vitest";
import { closePreviewState, fileNameFromRel } from "./preview-chip";

describe("preview-chip", () => {
  it("basename from relPath", () => {
    expect(fileNameFromRel("src/App.tsx")).toBe("App.tsx");
    expect(fileNameFromRel("README.md")).toBe("README.md");
  });

  it("close from preview returns to terminal", () => {
    expect(closePreviewState("preview")).toEqual({
      filePreview: null,
      centerSurface: "terminal",
    });
  });

  it("close while already on terminal still clears preview", () => {
    expect(closePreviewState("terminal")).toEqual({
      filePreview: null,
      centerSurface: "terminal",
    });
  });
});
