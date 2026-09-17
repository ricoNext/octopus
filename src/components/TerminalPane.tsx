import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { api, invokeError } from "@/lib/api";

type TerminalPaneProps = {
  worktreeId: string;
  active: boolean;
};

type PtyDataEvent = {
  id: string;
  data: number[];
};

type PtyExitEvent = {
  id: string;
};

export function TerminalPane({ worktreeId, active }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      theme: {
        background: "#141414",
        foreground: "#f4f4f5",
        cursor: "#f4f4f5",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;
    queueMicrotask(() => fit.fit());

    const onData = term.onData((data) => {
      void api.ptyWrite(worktreeId, data).catch((err) => setError(invokeError(err)));
    });

    return () => {
      onData.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [worktreeId, nonce]);

  useEffect(() => {
    let unlistenData: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    void listen<PtyDataEvent>("pty-data", (event) => {
      if (event.payload.id !== worktreeId) {
        return;
      }
      termRef.current?.write(new Uint8Array(event.payload.data));
    }).then((fn) => {
      unlistenData = fn;
    });
    void listen<PtyExitEvent>("pty-exit", (event) => {
      if (event.payload.id !== worktreeId) {
        return;
      }
      setExited(true);
    }).then((fn) => {
      unlistenExit = fn;
    });
    return () => {
      unlistenData?.();
      unlistenExit?.();
    };
  }, [worktreeId, nonce]);

  useEffect(() => {
    if (!active || exited) {
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
      .ptyOpen(worktreeId, cols, rows)
      .then(() => api.ptyResize(worktreeId, cols, rows))
      .catch((err) => setError(invokeError(err)));
  }, [active, exited, worktreeId, nonce]);

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
      void api.ptyResize(worktreeId, term.cols, term.rows).catch(() => undefined);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, worktreeId, nonce]);

  function reopen() {
    setError(null);
    setExited(false);
    setNonce((value) => value + 1);
  }

  return (
    <div className="relative h-full min-h-0 bg-[#141414]">
      <div ref={containerRef} className="h-full min-h-0 p-2" />
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
