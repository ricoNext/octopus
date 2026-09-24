/** First link: all scan hits. Relink: recorded ∩ available; if intersection empty → all available. */
export function defaultSelectedRelPaths(args: {
  mode: "link" | "relink";
  available: string[];
  recorded: string[];
}): string[] {
  const available = args.available;
  if (args.mode === "link") {
    return [...available];
  }
  const set = new Set(available);
  const preferred = args.recorded.filter((r) => set.has(r));
  return preferred.length > 0 ? preferred : [...available];
}
