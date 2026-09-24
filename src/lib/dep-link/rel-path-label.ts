export function relPathLabel(relPath: string): string {
  return relPath === "" || relPath === "." ? "根" : relPath;
}
