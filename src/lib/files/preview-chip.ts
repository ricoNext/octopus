export type CenterSurface = "terminal" | "preview";

export function fileNameFromRel(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || relPath;
}

export function closePreviewState(surface: CenterSurface): {
  filePreview: null;
  centerSurface: CenterSurface;
} {
  return {
    filePreview: null,
    centerSurface: surface === "preview" ? "terminal" : surface,
  };
}
