import { describe, expect, it } from "vitest";
import { agentDisplayName } from "./labels";

describe("agentDisplayName", () => {
  it("maps whitelist ids", () => {
    expect(agentDisplayName("codex")).toBe("Codex");
    expect(agentDisplayName("codebuddy")).toBe("CodeBuddy");
  });
});
