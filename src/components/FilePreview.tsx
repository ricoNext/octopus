import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type FilePreviewProps = {
  rootPath: string;
  relPath: string;
  content: string;
  onClose: () => void;
};

function fileNameFromRel(relPath: string): string {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || relPath;
}

export function FilePreview({ relPath, content, onClose }: FilePreviewProps) {
  const fileName = fileNameFromRel(relPath);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
        <span className="min-w-0 flex-1 truncate text-sm" title={relPath}>
          {fileName}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label="关闭预览"
          title="关闭预览"
        >
          <XIcon />
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}
