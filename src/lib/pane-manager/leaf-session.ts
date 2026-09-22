import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  attachUnicode11,
  buildTerminalOptions,
  terminalThemes,
} from "@/lib/terminal/xterm-options";

import { api, invokeError } from "@/lib/api";
import { bumpTerminalMetric } from "@/lib/terminal/terminal-metrics";
import { subscribePtyData, subscribePtyExit } from "./pty-event-bus";

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

export class LeafSession {
  private term: Terminal;
  private fit: FitAddon;
  private container: HTMLElement;
  private sessionId: string;
  private cwdId: string;
  private unsubscribeData?: () => void;
  private unsubscribeExit?: () => void;
  private writeBuffer = "";
  private writeFlushScheduled = false;
  private restoreScrollback = true;
  private resizeObserver?: ResizeObserver;
  private resizeRaf = 0;
  private themeObserver?: MutationObserver;
  private clickHandler?: (event: MouseEvent) => void;
  private active = false;
  private eventsReady = false;
  /** True after a successful ptyOpen; kept across hide/show so switches stay warm. */
  private ptyAttached = false;

  constructor(container: HTMLElement, sessionId: string, cwdId: string) {
    this.container = container;
    this.sessionId = sessionId;
    this.cwdId = cwdId;

    const dark = document.documentElement.classList.contains("dark");
    this.term = new Terminal(buildTerminalOptions(dark));
    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    attachUnicode11(this.term);
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

  private setupEventListeners() {
    this.unsubscribeData = subscribePtyData(this.sessionId, (data) => {
      this.term.write(data);
    });

    this.unsubscribeExit = subscribePtyExit(this.sessionId, () => {
      console.log("PTY exited:", this.sessionId);
    });

    this.eventsReady = true;
    if (this.active) {
      void this.openPty();
    }
  }

  private writePty(data: string) {
    // Coalesce consecutive keystrokes in one microtask (Orca input-queue idea),
    // then fire one ptyWrite. Combined with Rust notify(), typing no longer waits
    // on a per-keystroke daemon round-trip.
    this.writeBuffer += data;
    if (this.writeFlushScheduled) {
      return;
    }
    this.writeFlushScheduled = true;
    queueMicrotask(() => {
      this.writeFlushScheduled = false;
      const payload = this.writeBuffer;
      this.writeBuffer = "";
      if (!payload) {
        return;
      }
      void api.ptyWrite(this.sessionId, payload).catch((err) => {
        console.error("ptyWrite error:", invokeError(err));
      });
    });
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

  private cancelResizeRaf() {
    if (this.resizeRaf) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = 0;
    }
  }

  private scheduleFitAndResize() {
    if (this.resizeRaf) {
      return;
    }
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      this.fit.fit();
      void api.ptyResize(this.sessionId, this.term.cols, this.term.rows).catch(() => undefined);
    });
  }

  private setupResizeObserver() {
    if (this.resizeObserver) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleFitAndResize();
    });
    this.resizeObserver.observe(this.container);
  }

  private teardownResizeObserver() {
    this.cancelResizeRaf();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
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
      this.ptyAttached = true;
      bumpTerminalMetric("ptyOpen");
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
      bumpTerminalMetric("leafActive");
      this.setupClickHandler();
      this.setupResizeObserver();
      // Keep PTY subscribed across sidebar switches (Orca-style warm park).
      // Only open on first show; later shows just refit/focus.
      if (!this.ptyAttached) {
        void this.openPty();
      } else {
        this.scheduleFitAndResize();
      }
      this.focus();
    } else {
      bumpTerminalMetric("leafInactive");
      if (this.clickHandler) {
        this.container.removeEventListener("mousedown", this.clickHandler);
        this.clickHandler = undefined;
      }
      this.teardownResizeObserver();
      // Do not ptyDetach here — detach only on dispose. Detach+reattach on every
      // menu switch made selection feel 1–2s delayed.
    }
  }

  focus() {
    this.term.focus();
  }

  /** Re-fit after the leaf container moved in the layout tree without remounting xterm. */
  refit() {
    if (!this.active) {
      return;
    }
    this.scheduleFitAndResize();
  }

  remount(newContainer: HTMLElement) {
    if (this.clickHandler) {
      this.container.removeEventListener("mousedown", this.clickHandler);
      this.clickHandler = undefined;
    }
    this.teardownResizeObserver();

    this.container = newContainer;

    const terminalElement = this.term.element;
    if (terminalElement && terminalElement.parentElement) {
      newContainer.appendChild(terminalElement);
    }

    this.fit.fit();
    if (this.active) {
      this.setupClickHandler();
      this.setupResizeObserver();
    }
  }

  dispose() {
    bumpTerminalMetric("leafDispose");
    if (this.writeBuffer) {
      const payload = this.writeBuffer;
      this.writeBuffer = "";
      this.writeFlushScheduled = false;
      void api.ptyWrite(this.sessionId, payload).catch(() => undefined);
    }
    void api.ptyDetach(this.sessionId).catch(() => undefined);
    this.themeObserver?.disconnect();
    this.teardownResizeObserver();
    if (this.clickHandler) {
      this.container.removeEventListener("mousedown", this.clickHandler);
    }
    this.unsubscribeData?.();
    this.unsubscribeExit?.();
    this.term.dispose();
  }
}
