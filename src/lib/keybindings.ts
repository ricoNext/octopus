export type KeybindingAction =
  | "tab.newTerminal"
  | "terminal.splitRight"
  | "terminal.splitDown"
  | "terminal.closePane"
  | "terminal.focusNextPane"
  | "sidebar.toggle";

export function matchKeybinding(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): KeybindingAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return null;
  const k = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const code = event.code ?? "";
  const isT = k === "t" || code === "KeyT";
  const isD = k === "d" || code === "KeyD";
  const isW = k === "w" || code === "KeyW";
  const isB = k === "b" || code === "KeyB";
  const isBracket = k === "]" || code === "BracketRight";
  if (isT && !event.shiftKey) return "tab.newTerminal";
  if (isD && event.shiftKey) return "terminal.splitDown";
  if (isD && !event.shiftKey) return "terminal.splitRight";
  if (isW && !event.shiftKey) return "terminal.closePane";
  if (isBracket && !event.shiftKey) return "terminal.focusNextPane";
  if (isB && !event.shiftKey) return "sidebar.toggle";
  return null;
}
