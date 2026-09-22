import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type PtyDataEvent = {
  id: string;
  data: string;
};

type PtyExitEvent = {
  id: string;
};

type DataHandler = (data: string) => void;
type ExitHandler = () => void;

const dataHandlers = new Map<string, Set<DataHandler>>();
const exitHandlers = new Map<string, Set<ExitHandler>>();

let dataListenPromise: Promise<void> | null = null;
let exitListenPromise: Promise<void> | null = null;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;

function ensureDataListen(): Promise<void> {
  if (dataListenPromise) {
    return dataListenPromise;
  }
  dataListenPromise = listen<PtyDataEvent>("pty-data", (event) => {
    const handlers = dataHandlers.get(event.payload.id);
    if (!handlers || handlers.size === 0) {
      return;
    }
    const data = event.payload.data;
    for (const handler of handlers) {
      handler(data);
    }
  }).then((unlisten) => {
    unlistenData = unlisten;
  });
  return dataListenPromise;
}

function ensureExitListen(): Promise<void> {
  if (exitListenPromise) {
    return exitListenPromise;
  }
  exitListenPromise = listen<PtyExitEvent>("pty-exit", (event) => {
    const handlers = exitHandlers.get(event.payload.id);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      handler();
    }
  }).then((unlisten) => {
    unlistenExit = unlisten;
  });
  return exitListenPromise;
}

async function maybeTeardown() {
  if (dataHandlers.size === 0 && unlistenData) {
    unlistenData();
    unlistenData = null;
    dataListenPromise = null;
  }
  if (exitHandlers.size === 0 && unlistenExit) {
    unlistenExit();
    unlistenExit = null;
    exitListenPromise = null;
  }
}

export function subscribePtyData(sessionId: string, handler: DataHandler): () => void {
  let set = dataHandlers.get(sessionId);
  if (!set) {
    set = new Set();
    dataHandlers.set(sessionId, set);
  }
  set.add(handler);
  void ensureDataListen();
  return () => {
    const current = dataHandlers.get(sessionId);
    if (!current) {
      return;
    }
    current.delete(handler);
    if (current.size === 0) {
      dataHandlers.delete(sessionId);
    }
    void maybeTeardown();
  };
}

export function subscribePtyExit(sessionId: string, handler: ExitHandler): () => void {
  let set = exitHandlers.get(sessionId);
  if (!set) {
    set = new Set();
    exitHandlers.set(sessionId, set);
  }
  set.add(handler);
  void ensureExitListen();
  return () => {
    const current = exitHandlers.get(sessionId);
    if (!current) {
      return;
    }
    current.delete(handler);
    if (current.size === 0) {
      exitHandlers.delete(sessionId);
    }
    void maybeTeardown();
  };
}
