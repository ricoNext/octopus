import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import {
  attachUnicode11,
  buildTerminalOptions,
  terminalThemes,
} from "@/lib/terminal/xterm-options";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { api, invokeError } from "@/lib/api";

type TerminalPaneProps = {
  sessionId: string;
  cwdId: string;
  active: boolean;
};

type PtyDataEvent = {
  id: string;
  data: string;
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

export function TerminalPane({ sessionId, cwdId, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [eventsReady, setEventsReady] = useState(false);
  const restoreScrollbackRef = useRef(true);
  const ptyWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const darkThemeRef = useRef(document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains("dark");
      darkThemeRef.current = dark;
      if (termRef.current) {
        termRef.current.options.theme = dark ? terminalThemes.dark : terminalThemes.light;
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  function writePty(data: string) {
    const write = ptyWriteQueueRef.current.then(() => api.ptyWrite(sessionId, data));
    ptyWriteQueueRef.current = write.catch(() => undefined);
    void write.catch((err) => setError(invokeError(err)));
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const term = new Terminal(buildTerminalOptions(darkThemeRef.current));
    const fit = new FitAddon();
    term.loadAddon(fit);
    attachUnicode11(term);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    // 每个 xterm 实例初始为空，只在第一次 attach 时恢复 daemon 历史。
    restoreScrollbackRef.current = true;
    queueMicrotask(() => fit.fit());

    const onData = term.onData((data) => {
      writePty(data);
    });

    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type !== "keydown" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        (event.key !== "Delete" && event.key !== "Backspace")
      ) {
        return true;
      }

      // macOS 的 Delete 键会被浏览器报告为 Backspace，因此同时处理两种 key 值。
      // 使用终端标准的行编辑控制序列，删除光标到当前输入行行首的内容。
      // 由 shell/终端程序处理，可以正确保留提示符并适配不同的行编辑器。
      event.preventDefault();
      event.stopPropagation();
      writePty("\u0015");
      return false;
    });

    return () => {
      void api.ptyDetach(sessionId).catch(() => undefined);
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, nonce]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }

    function moveCursorToClick(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const term = termRef.current;
      const screen = container?.querySelector<HTMLElement>(".xterm-screen");
      if (!term || !screen || term.buffer.active.type !== "normal" || term.modes.mouseTrackingMode !== "none") {
        return;
      }
      // 复用 xterm.js 自己的 MouseService。它使用渲染器测量出的真实
      // cell 尺寸，而不是外层 DOM 的宽高估算，能够正确处理缩放、DPR、
      // letterSpacing、lineHeight 以及终端内边距。
      const mouseService = (term as XtermWithCore)._core?._mouseService;
      const coords = mouseService?.getCoords(event, screen, term.cols, term.rows);
      if (!coords) {
        return;
      }
      const [column, row] = coords;
      const targetRow = row - 1;
      if (targetRow !== term.buffer.active.cursorY) {
        return;
      }
      // xterm 的坐标是 1-based；允许点击最后一列，将光标放到行末。
      const targetColumn = Math.min(term.cols, Math.max(0, column - 1));
      const distance = targetColumn - term.buffer.active.cursorX;
      if (distance === 0) {
        return;
      }
      const sequence = distance > 0
        ? term.modes.applicationCursorKeysMode
          ? "\u001bOC"
          : "\u001b[C"
        : term.modes.applicationCursorKeysMode
          ? "\u001bOD"
          : "\u001b[D";
      writePty(sequence.repeat(Math.abs(distance)));
    }

    container.addEventListener("mousedown", moveCursorToClick);
    return () => container.removeEventListener("mousedown", moveCursorToClick);
  }, [active, sessionId]);

  useEffect(() => {
    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let cancelled = false;
    setEventsReady(false);
    const dataListener = listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id !== sessionId) {
        return;
      }
      termRef.current?.write(event.payload.data);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenData = fn;
      }
      return fn;
    });
    const exitListener = listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id !== sessionId) {
        return;
      }
      setExited(true);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenExit = fn;
      }
      return fn;
    });
    void Promise.all([dataListener, exitListener]).then(() => {
      if (!cancelled) {
        setEventsReady(true);
      }
    });
    return () => {
      cancelled = true;
      setEventsReady(false);
      unlistenData?.();
      unlistenExit?.();
    };
  }, [sessionId, nonce]);

  useEffect(() => {
    if (!active || exited || !eventsReady) {
      return;
    }
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) {
      return;
    }
    fit.fit();
    const dims = fit.proposeDimensions();
    const cols = dims?.cols ?? term.cols;
    const rows = dims?.rows ?? term.rows;
    void api
      .ptyOpen(sessionId, cwdId, cols, rows)
      .then((attached) => {
        if (restoreScrollbackRef.current && attached.scrollbackAnsi) {
          term.write(attached.scrollbackAnsi);
        }
        restoreScrollbackRef.current = false;
        return api.ptyResize(sessionId, cols, rows);
      })
      .catch((err) => setError(invokeError(err)));
  }, [active, cwdId, eventsReady, exited, sessionId, nonce]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const fit = fitRef.current;
      const term = termRef.current;
      if (!fit || !term) {
        return;
      }
      fit.fit();
      void api.ptyResize(sessionId, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, sessionId, nonce]);

  function reopen() {
    setError(null);
    setExited(false);
    setNonce((value) => value + 1);
  }

  return (
    <div className="relative h-full min-h-0 bg-background">
      <div ref={containerRef} className="h-full min-h-0" />
      {exited ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80">
          <p className="text-sm">终端已结束</p>
          <Button onClick={reopen}>重新打开终端</Button>
        </div>
      ) : null}
      {error ? (
        <div className="absolute right-3 bottom-3 max-w-md rounded-md border bg-background/95 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
