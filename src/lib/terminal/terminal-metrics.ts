const counters: Record<string, number> = Object.create(null);

function installOnWindow(): void {
  if (typeof globalThis === "undefined") {
    return;
  }
  const g = globalThis as typeof globalThis & {
    window?: Window & { __octopusTerminalMetrics?: Record<string, number> };
    __octopusTerminalMetrics?: Record<string, number>;
  };
  const snapshot = getTerminalMetrics();
  g.__octopusTerminalMetrics = snapshot;
  if (typeof g.window !== "undefined") {
    g.window.__octopusTerminalMetrics = snapshot;
  }
}

export function bumpTerminalMetric(name: string, delta = 1): void {
  counters[name] = (counters[name] ?? 0) + delta;
  installOnWindow();
  if (typeof console !== "undefined" && typeof console.debug === "function") {
    console.debug(`[terminal-metric] ${name}=${counters[name]}`);
  }
}

export function setTerminalMetric(name: string, value: number): void {
  counters[name] = value;
  installOnWindow();
}

export function getTerminalMetrics(): Record<string, number> {
  return { ...counters };
}

export function resetTerminalMetrics(): void {
  for (const key of Object.keys(counters)) {
    delete counters[key];
  }
  installOnWindow();
}
