import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { fileNameFromRel } from "@/lib/files/preview-chip";

export type FilePreviewProps = {
  rootPath: string;
  relPath: string;
  content: string;
  onClose: () => void;
  /** When false, chip is sole chrome; default true keeps header X (same as chip close). */
  showHeader?: boolean;
};

export function FilePreview({
  relPath,
  content,
  onClose,
  showHeader = true,
}: FilePreviewProps) {
  const fileName = fileNameFromRel(relPath);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {showHeader ? (
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
      ) : null}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  );
}
