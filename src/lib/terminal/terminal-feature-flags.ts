const WARM_RETAIN_KEY = "octopus.terminalWarmRetain";

/** Kill switch for warm retain. Missing → enabled; only exact `"false"` disables. */
export function isTerminalWarmRetainEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") {
      return true;
    }
    return localStorage.getItem(WARM_RETAIN_KEY) !== "false";
  } catch {
    return true;
  }
}
