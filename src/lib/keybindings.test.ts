import { describe, expect, it } from "vitest";
import { matchKeybinding } from "./keybindings";

function key(partial: Partial<KeyboardEvent> & { key: string; code?: string }) {
  return {
    key: partial.key,
    code: partial.code,
    metaKey: Boolean(partial.metaKey),
    ctrlKey: Boolean(partial.ctrlKey),
    shiftKey: Boolean(partial.shiftKey),
    altKey: Boolean(partial.altKey),
  };
}

describe("matchKeybinding", () => {
  it("matches Mac chord defaults", () => {
    expect(matchKeybinding(key({ key: "t", metaKey: true }))).toBe("tab.newTerminal");
    expect(matchKeybinding(key({ key: "d", metaKey: true }))).toBe("terminal.splitRight");
    expect(matchKeybinding(key({ key: "d", metaKey: true, shiftKey: true }))).toBe(
      "terminal.splitDown",
    );
    expect(matchKeybinding(key({ key: "w", metaKey: true }))).toBe("terminal.closePane");
    expect(matchKeybinding(key({ key: "]", metaKey: true }))).toBe("terminal.focusNextPane");
    expect(matchKeybinding(key({ key: "b", metaKey: true }))).toBe("sidebar.toggle");
  });

  it("matches by event.code when key is non-latin", () => {
    expect(matchKeybinding(key({ key: "∂", code: "KeyD", metaKey: true }))).toBe(
      "terminal.splitRight",
    );
  });

  it("returns null for unmatched", () => {
    expect(matchKeybinding(key({ key: "t" }))).toBeNull();
  });
});
