export function fileNameFromRel(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || relPath;
}
