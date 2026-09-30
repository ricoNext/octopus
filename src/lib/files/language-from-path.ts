const languageByExtension: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  html: "html",
  rs: "rust",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
};

export function languageFromRelPath(relPath: string): string {
  const fileName = relPath.split(/[\\/]/).pop() ?? "";
  const lastDot = fileName.lastIndexOf(".");

  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return "plaintext";
  }

  const extension = fileName.slice(lastDot + 1).toLowerCase();
  return languageByExtension[extension] ?? "plaintext";
}
