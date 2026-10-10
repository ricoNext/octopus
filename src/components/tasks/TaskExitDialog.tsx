import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { taskApi } from "@/lib/tasks";
import { invokeError } from "@/lib/api";

export function TaskExitDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const unlisten = listen("tasks-exit-requested", () => setOpen(true));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
  async function exit(stop: boolean) {
    setBusy(true);
    try {
      await taskApi.exit(stop);
    } catch (e) {
      toast.error(invokeError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>仍有任务正在执行</DialogTitle>
          <DialogDescription>
            可以让任务在后台继续运行，或停止全部任务后退出。对话与已修改文件都会保留。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            取消
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void exit(true)}
          >
            {busy ? "正在处理…" : "停止任务后退出"}
          </Button>
          <Button disabled={busy} onClick={() => void exit(false)}>
            后台继续并退出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
