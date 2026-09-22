export type KeybindingAction =
  | "tab.newTerminal"
  | "terminal.splitRight"
  | "terminal.splitDown"
  | "terminal.closePane"
  | "terminal.focusNextPane"
  | "sidebar.toggle";

export function matchKeybinding(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): KeybindingAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return null;
  const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (k === "t" && !event.shiftKey) return "tab.newTerminal";
  if (k === "d" && event.shiftKey) return "terminal.splitDown";
  if (k === "d" && !event.shiftKey) return "terminal.splitRight";
  if (k === "w" && !event.shiftKey) return "terminal.closePane";
  if (k === "]" && !event.shiftKey) return "terminal.focusNextPane";
  if (k === "b" && !event.shiftKey) return "sidebar.toggle";
  return null;
}
