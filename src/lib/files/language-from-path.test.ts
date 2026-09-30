import { describe, expect, it } from "vitest";
import { languageFromRelPath } from "./language-from-path";

describe("languageFromRelPath", () => {
  it.each([
    ["foo.js", "javascript"],
    ["component.JSX", "javascript"],
    ["src/a.tsx", "typescript"],
    ["types.TS", "typescript"],
    ["data.json", "json"],
    ["README.md", "markdown"],
    ["docs/guide.MARKDOWN", "markdown"],
    ["styles.css", "css"],
    ["index.html", "html"],
    ["src/main.rs", "rust"],
    ["config.toml", "toml"],
    [".config/app.YAML", "yaml"],
    ["config.yml", "yaml"],
  ])("maps %s to %s", (relPath, expected) => {
    expect(languageFromRelPath(relPath)).toBe(expected);
  });

  it("uses the final extension for nested and multi-dot paths", () => {
    expect(languageFromRelPath("src/components/Button.test.tsx")).toBe(
      "typescript",
    );
  });

  it("falls back to plaintext for unknown or extensionless paths", () => {
    expect(languageFromRelPath("x.unknown")).toBe("plaintext");
    expect(languageFromRelPath("Makefile")).toBe("plaintext");
  });
});
