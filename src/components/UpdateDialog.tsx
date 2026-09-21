import { DownloadIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UpdateInfo, UpdatePhase } from "@/lib/updater";

type UpdateDialogProps = {
  open: boolean;
  phase: UpdatePhase;
  info: UpdateInfo | null;
  error: string | null;
  onInstall: () => void;
  onDismiss: () => void;
};

export function UpdateDialog({ open, phase, info, error, onInstall, onDismiss }: UpdateDialogProps) {
  const busy = phase.kind === "downloading" || phase.kind === "installing" || phase.kind === "restarting";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onDismiss()}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{dialogTitle(phase, info)}</DialogTitle>
          <DialogDescription>{dialogDescription(phase, info)}</DialogDescription>
        </DialogHeader>

        {phase.kind === "available" && info ? (
          <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
            {info.body.trim() ? renderNotes(info.body) : <p className="text-muted-foreground">本次更新没有附带说明，可到 GitHub Releases 查看详情。</p>}
          </div>
        ) : null}

        {phase.kind === "downloading" ? <DownloadProgress received={phase.received} total={phase.total} /> : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {phase.kind === "available" ? (
            <>
              <Button variant="outline" onClick={onDismiss}>
                暂不更新
              </Button>
              <Button onClick={onInstall}>
                <DownloadIcon />
                立即更新
              </Button>
            </>
          ) : null}
          {busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              {phase.kind === "downloading" ? "正在下载更新…" : phase.kind === "installing" ? "正在安装更新…" : "即将重启应用…"}
            </p>
          ) : null}
          {phase.kind === "checking" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              正在检查更新…
            </p>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function dialogTitle(phase: UpdatePhase, info: UpdateInfo | null): string {
  if (phase.kind === "available" && info) {
    return `发现新版本 v${info.version}`;
  }
  return "软件更新";
}

function dialogDescription(phase: UpdatePhase, info: UpdateInfo | null): string {
  if (phase.kind === "available" && info) {
    return `当前版本 v${info.currentVersion}，更新前请先保存终端里的工作。`;
  }
  return "";
}

function DownloadProgress({ received, total }: { received: number; total: number | null }) {
  const percent = total ? Math.min(100, Math.round((received / total) * 100)) : null;
  const receivedMb = (received / 1024 / 1024).toFixed(1);
  const totalMb = total ? (total / 1024 / 1024).toFixed(1) : null;

  return (
    <div className="space-y-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: percent !== null ? `${percent}%` : "33%" }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {totalMb
          ? `${receivedMb} MB / ${totalMb} MB${percent !== null ? `（${percent}%）` : ""}`
          : `已下载 ${receivedMb} MB`}
      </p>
    </div>
  );
}

/** 更新说明来自 GitHub Release 的 changelog 段落，这里按行做轻量渲染。 */
function renderNotes(body: string) {
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  const bullets: string[] = [];
  const blocks: React.ReactNode[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) {
      return;
    }
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5">
        {bullets.splice(0).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushBullets();
      blocks.push(
        <p key={`h-${blocks.length}`} className="font-medium">
          {heading[2]}
        </p>,
      );
    } else if (bullet) {
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      blocks.push(<p key={`p-${blocks.length}`}>{line.trim()}</p>);
    }
  }
  flushBullets();

  return <div className="space-y-2">{blocks}</div>;
}
