import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { ITerminalOptions, Terminal } from "@xterm/xterm";

/** Font stack: system mono first, then common Nerd Fonts for Powerline/box glyphs. */
export const TERMINAL_FONT_FAMILY =
  '"SF Mono", "Menlo", "Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Symbols Nerd Font Mono", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", monospace';

export const terminalThemes = {
  light: {
    background: "#ffffff",
    foreground: "#18181b",
    cursor: "#18181b",
    // xterm 6 draws its own scrollbar via SmoothScrollableElement.
    scrollbarSliderBackground: "rgba(0, 0, 0, 0.14)",
    scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0.28)",
    scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0.4)",
  },
  dark: {
    background: "#141414",
    foreground: "#f4f4f5",
    cursor: "#f4f4f5",
    scrollbarSliderBackground: "rgba(255, 255, 255, 0.14)",
    scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.28)",
    scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.4)",
  },
} as const;

export function buildTerminalOptions(dark: boolean): ITerminalOptions {
  return {
    allowProposedApi: true,
    cursorBlink: true,
    fontSize: 13,
    fontFamily: TERMINAL_FONT_FAMILY,
    // Draw box-drawing / block elements in the canvas renderer for continuous lines.
    customGlyphs: true,
    scrollback: 5000,
    overviewRuler: { width: 8 },
    theme: dark ? terminalThemes.dark : terminalThemes.light,
  };
}

/** Load Unicode 11 widths so CJK / emoji / modern symbols match native terminals. */
export function attachUnicode11(term: Terminal): Unicode11Addon {
  const addon = new Unicode11Addon();
  term.loadAddon(addon);
  term.unicode.activeVersion = "11";
  return addon;
}
