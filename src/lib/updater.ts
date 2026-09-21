import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  body: string;
};

export type UpdatePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "downloading"; received: number; total: number | null }
  | { kind: "installing" }
  | { kind: "restarting" };

export type ManualCheckStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "error"; message: string };

/**
 * 应用内更新：启动后静默检查 + 设置页手动检查。
 * 发现新版本时弹窗展示更新说明，用户确认后才下载安装，安装完成后重启。
 */
export function useAppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [manualStatus, setManualStatus] = useState<ManualCheckStatus>({ kind: "idle" });
  const [currentVersion, setCurrentVersion] = useState("");
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    void getVersion()
      .then(setCurrentVersion)
      .catch(() => undefined);
  }, []);

  const check = useCallback(async (mode: "silent" | "manual") => {
    if (mode === "manual") {
      setManualStatus({ kind: "checking" });
    }
    try {
      const update = await checkForUpdate();
      if (update?.available) {
        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          currentVersion: update.currentVersion,
          body: update.body ?? "",
        });
        setDialogError(null);
        setPhase({ kind: "available" });
        setDialogOpen(true);
        setManualStatus({ kind: "idle" });
      } else if (mode === "manual") {
        setManualStatus({ kind: "uptodate" });
      }
    } catch (error) {
      if (mode === "manual") {
        setManualStatus({ kind: "error", message: describeError(error) });
      } else {
        // 启动时的静默检查失败不打扰用户，保留下次手动检查的机会。
        console.warn("启动检查更新失败", error);
      }
    }
  }, []);

  const install = useCallback(async () => {
    const update = updateRef.current;
    if (!update) {
      return;
    }
    setDialogError(null);
    setPhase({ kind: "downloading", received: 0, total: null });
    try {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          setPhase({ kind: "downloading", received: 0, total });
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          setPhase({ kind: "downloading", received, total });
        } else {
          setPhase({ kind: "installing" });
        }
      });
      setPhase({ kind: "restarting" });
      await relaunch();
    } catch (error) {
      // 下载或安装失败时退回"有更新"状态，保留当前版本可用。
      setPhase({ kind: "available" });
      setDialogError(describeError(error));
    }
  }, []);

  const dismiss = useCallback(() => {
    setDialogOpen(false);
    setDialogError(null);
    setPhase({ kind: "idle" });
    setUpdateInfo(null);
    updateRef.current = null;
  }, []);

  return {
    phase,
    dialogOpen,
    dialogError,
    updateInfo,
    manualStatus,
    currentVersion,
    check,
    install,
    dismiss,
  };
}

function describeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
