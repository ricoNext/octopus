import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyableError({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-destructive">错误详情</p>
        <Button type="button" size="xs" variant="outline" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-destructive">
        {text}
      </pre>
    </div>
  );
}
