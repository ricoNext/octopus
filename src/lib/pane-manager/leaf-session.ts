import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

import { api, invokeError } from "@/lib/api";

type PtyDataEvent = {
  id: string;
  data: number[];
};

type PtyExitEvent = {
  id: string;
};

type XtermMouseService = {
  getCoords: (
    event: Pick<MouseEvent, "clientX" | "clientY">,
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined;
};

type XtermWithCore = Terminal & {
  _core?: {
    _mouseService?: XtermMouseService;
  };
};

const terminalThemes = {
  light: { background: "#ffffff", foreground: "#18181b", cursor: "#18181b" },
  dark: { background: "#141414", foreground: "#f4f4f5", cursor: "#f4f4f5" },
} as const;

export class LeafSession {
  private term: Terminal;
  private fit: FitAddon;
  private container: HTMLElement;
  private sessionId: string;
  private cwdId: string;
  private unlistenData?: UnlistenFn;
  private unlistenExit?: UnlistenFn;
  private ptyWriteQueue: Promise<void> = Promise.resolve();
  private restoreScrollback = true;
  private resizeObserver?: ResizeObserver;
  private themeObserver?: MutationObserver;
  private clickHandler?: (event: MouseEvent) => void;
  private active = false;
  private eventsReady = false;

  constructor(container: HTMLElement, sessionId: string, cwdId: string) {
    this.container = container;
    this.sessionId = sessionId;
    this.cwdId = cwdId;

    const dark = document.documentElement.classList.contains("dark");
    this.term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      theme: dark ? terminalThemes.dark : terminalThemes.light,
    });
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.open(container);

    queueMicrotask(() => this.fit.fit());

    this.term.onData((data) => {
      this.writePty(data);
    });

    this.term.attachCustomKeyEventHandler((event) => {
      if (
        event.type !== "keydown" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      this.writePty("\u0015");
      return false;
    });

    this.setupThemeObserver();
    this.setupEventListeners();
  }

  private setupThemeObserver() {
    this.themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains("dark");
      this.term.options.theme = dark ? terminalThemes.dark : terminalThemes.light;
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  private async setupEventListeners() {
    this.unlistenData = await listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id !== this.sessionId) {
        return;
      }
      const bytes = new Uint8Array(event.payload.data);
      this.term.write(bytes);
    });

    this.unlistenExit = await listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id !== this.sessionId) {
        return;
      }
      // Handle exit - for now just log
      console.log("PTY exited:", this.sessionId);
    });

    this.eventsReady = true;
    if (this.active) {
      this.openPty();
    }
  }

  private writePty(data: string) {
    const write = this.ptyWriteQueue.then(() => api.ptyWrite(this.sessionId, data));
    this.ptyWriteQueue = write.catch(() => undefined);
    void write.catch((err) => console.error("ptyWrite error:", invokeError(err)));
  }

  private setupClickHandler() {
    this.clickHandler = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const screen = this.container.querySelector<HTMLElement>(".xterm-screen");
      if (
        !screen ||
        this.term.buffer.active.type !== "normal" ||
        this.term.modes.mouseTrackingMode !== "none"
      ) {
        return;
      }
      const mouseService = (this.term as XtermWithCore)._core?._mouseService;
      const coords = mouseService?.getCoords(event, screen, this.term.cols, this.term.rows);
      if (!coords) {
        return;
      }
      const [column, row] = coords;
      const targetRow = row - 1;
      if (targetRow !== this.term.buffer.active.cursorY) {
        return;
      }
      const targetColumn = Math.min(this.term.cols, Math.max(0, column - 1));
      const distance = targetColumn - this.term.buffer.active.cursorX;
      if (distance === 0) {
        return;
      }
      const sequence =
        distance > 0
          ? this.term.modes.applicationCursorKeysMode
            ? "\u001bOC"
            : "\u001b[C"
          : this.term.modes.applicationCursorKeysMode
            ? "\u001bOD"
            : "\u001b[D";
      this.writePty(sequence.repeat(Math.abs(distance)));
    };
    this.container.addEventListener("mousedown", this.clickHandler);
  }

  private setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      this.fit.fit();
      void api.ptyResize(this.sessionId, this.term.cols, this.term.rows).catch(() => undefined);
    });
    this.resizeObserver.observe(this.container);
  }

  private async openPty() {
    if (!this.eventsReady) {
      return;
    }
    this.fit.fit();
    const dims = this.fit.proposeDimensions();
    const cols = dims?.cols ?? this.term.cols;
    const rows = dims?.rows ?? this.term.rows;
    try {
      const attached = await api.ptyOpen(this.sessionId, this.cwdId, cols, rows);
      if (this.restoreScrollback && attached.scrollbackAnsi) {
        this.term.write(attached.scrollbackAnsi);
      }
      this.restoreScrollback = false;
      await api.ptyResize(this.sessionId, cols, rows);
    } catch (err) {
      console.error("ptyOpen error:", invokeError(err));
    }
  }

  setActive(active: boolean) {
    if (this.active === active) {
      return;
    }
    this.active = active;

    if (active) {
      this.setupClickHandler();
      this.setupResizeObserver();
      this.openPty();
    } else {
      if (this.clickHandler) {
        this.container.removeEventListener("mousedown", this.clickHandler);
        this.clickHandler = undefined;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = undefined;
      }
      void api.ptyDetach(this.sessionId).catch(() => undefined);
    }
  }

  focus() {
    this.term.focus();
  }

  dispose() {
    void api.ptyDetach(this.sessionId).catch(() => undefined);
    this.themeObserver?.disconnect();
    this.resizeObserver?.disconnect();
    if (this.clickHandler) {
      this.container.removeEventListener("mousedown", this.clickHandler);
    }
    this.unlistenData?.();
    this.unlistenExit?.();
    this.term.dispose();
  }
}
