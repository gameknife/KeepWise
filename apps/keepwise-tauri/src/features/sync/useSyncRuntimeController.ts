import { startTransition, useEffect, useRef, useState } from "react";

import {
  syncPollRemoteUpdate,
  syncReconcile,
  syncSetupCreate,
  syncSetupLink,
  syncShareCodeGenerate,
  syncStatus,
  type SyncReconcilePayload,
  type SyncStatusPayload,
} from "../../api/desktop";

const SYNC_REMOTE_POLL_INTERVAL_MS = 8_000;

function toErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
}

export function useSyncRuntimeController({
  onDataRefresh,
  onNeedsSettings,
}: {
  onDataRefresh: () => void;
  onNeedsSettings: () => void;
}) {
  const [status, setStatus] = useState<SyncStatusPayload | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [shareCode, setShareCode] = useState("");
  const [createForm, setCreateForm] = useState({
    secret_id: "",
    secret_key: "",
    region: "ap-shanghai",
    app_id: "",
    sync_password: "",
  });
  const [linkForm, setLinkForm] = useState({ share_code: "", sync_password: "" });
  const [pendingLocalWrite, setPendingLocalWrite] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const reconcileBusyRef = useRef(false);
  const callbacksRef = useRef({ onDataRefresh, onNeedsSettings });
  callbacksRef.current = { onDataRefresh, onNeedsSettings };

  async function refreshStatus() {
    try {
      const next = await syncStatus();
      startTransition(() => setStatus(next));
    } catch {
      // Sync is optional before first setup.
    }
  }

  async function triggerReconcile(): Promise<SyncReconcilePayload | null> {
    if (reconcileBusyRef.current) return null;
    let started = false;
    try {
      const current = await syncStatus();
      startTransition(() => setStatus(current));
      if (!current.configured || current.syncing) return null;
      reconcileBusyRef.current = true;
      started = true;
      setQuickBusy(true);
      startTransition(() => setStatus({ ...current, syncing: true }));
      const result = await syncReconcile();
      startTransition(() => setStatus(result.status));
      if (result.ok && !result.status.conflict) setPendingLocalWrite(false);
      return result;
    } catch {
      if (started) void refreshStatus();
      return null;
    } finally {
      reconcileBusyRef.current = false;
      if (started) setQuickBusy(false);
    }
  }

  async function syncNow() {
    if (quickBusy) return;
    setQuickBusy(true);
    try {
      const result = await triggerReconcile();
      if (result?.ok) {
        setActionMessage("同步完成，正在刷新本地数据视图...");
        callbacksRef.current.onDataRefresh();
      }
      await refreshStatus();
    } finally {
      setQuickBusy(false);
    }
  }

  async function handleQuickIndicatorClick() {
    if (!status?.configured) {
      callbacksRef.current.onNeedsSettings();
      setActionMessage("请先在设置中完成云同步配置");
      return;
    }
    await syncNow();
  }

  async function setupCreate() {
    const req = {
      secret_id: createForm.secret_id.trim(),
      secret_key: createForm.secret_key.trim(),
      region: createForm.region.trim(),
      app_id: createForm.app_id.trim(),
      sync_password: createForm.sync_password,
    };
    if (!req.secret_id || !req.secret_key || !req.region || !req.app_id || !req.sync_password) {
      setSetupError("请完整填写 SecretId / SecretKey / Region / AppID / 同步密码");
      return;
    }
    setSetupBusy(true);
    setSetupError("");
    setActionMessage("");
    try {
      const payload = await syncSetupCreate(req);
      startTransition(() => {
        setShareCode(payload.share_code || "");
        setStatus(payload.status);
        setActionMessage("同步库创建并绑定成功");
      });
      setPendingLocalWrite(false);
    } catch (err) {
      setSetupError(toErrorMessage(err));
    } finally {
      setSetupBusy(false);
    }
  }

  async function setupLink() {
    const req = { share_code: linkForm.share_code.trim(), sync_password: linkForm.sync_password };
    if (!req.share_code || !req.sync_password) {
      setSetupError("请填写同步链接码与同步密码");
      return;
    }
    setSetupBusy(true);
    setSetupError("");
    setActionMessage("");
    try {
      const payload = await syncSetupLink(req);
      startTransition(() => {
        setStatus(payload.status);
        setActionMessage("同步库链接成功");
      });
      setPendingLocalWrite(false);
    } catch (err) {
      setSetupError(toErrorMessage(err));
    } finally {
      setSetupBusy(false);
    }
  }

  async function refreshShareCode() {
    const syncPassword = createForm.sync_password.trim();
    if (!syncPassword) {
      setSetupError("请输入同步密码后再生成同步链接码");
      return;
    }
    setSetupBusy(true);
    setSetupError("");
    setActionMessage("");
    try {
      const payload = await syncShareCodeGenerate({ sync_password: syncPassword });
      startTransition(() => {
        setShareCode(payload.share_code || "");
        setActionMessage("同步链接码已刷新");
      });
    } catch (err) {
      setSetupError(toErrorMessage(err));
    } finally {
      setSetupBusy(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !status?.configured) return;
    let canceled = false;
    const pollOnce = async () => {
      if (canceled || reconcileBusyRef.current || quickBusy) return;
      try {
        const poll = await syncPollRemoteUpdate();
        startTransition(() => setStatus(poll.status));
        if (!poll.configured || !poll.has_remote_update) return;
        const result = await triggerReconcile();
        if (result?.ok) callbacksRef.current.onDataRefresh();
      } catch {
        // Remote polling remains best-effort.
      }
    };
    const timer = window.setInterval(() => void pollOnce(), SYNC_REMOTE_POLL_INTERVAL_MS);
    void pollOnce();
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [status?.configured, quickBusy]);

  const quickState: "syncing" | "pending" | "synced" = quickBusy || status?.syncing
    ? "syncing"
    : !status?.configured || pendingLocalWrite
      ? "pending"
      : "synced";
  const quickTitle = quickState === "syncing"
    ? "同步中..."
    : quickState === "pending"
      ? status?.configured ? "有本地更新待同步，点击立即同步" : "未配置云同步，点击前往设置"
      : "已同步";

  return {
    status,
    setupBusy,
    setupError,
    actionMessage,
    shareCode,
    createForm,
    setCreateForm,
    linkForm,
    setLinkForm,
    syncNow,
    setupCreate,
    setupLink,
    refreshShareCode,
    markLocalMutation: () => setPendingLocalWrite(true),
    quickState,
    quickTitle,
    quickAriaLabel: quickState === "syncing" ? "同步中" : quickState === "pending" ? "待同步" : "已同步",
    handleQuickIndicatorClick,
  };
}
