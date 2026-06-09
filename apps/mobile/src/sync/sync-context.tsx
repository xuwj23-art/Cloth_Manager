import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { countPendingOps } from "../db/outbox";
import { isOnline, syncAll } from "./sync";

interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  lastSyncedAt: Date | null;
  /** 手动触发一次同步 */
  syncNow: () => Promise<void>;
  /** 重新统计待同步数量（下单后调用） */
  refreshPending: () => Promise<void>;
}

const SyncContext = createContext<SyncState | null>(null);

const AUTO_SYNC_INTERVAL_MS = 15000;

export function SyncProvider({
  enabled,
  children,
}: {
  enabled: boolean; // 登录后才启用
  children: ReactNode;
}) {
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const running = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount(await countPendingOps());
    } catch {
      // ignore
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setSyncing(true);
    try {
      const ok = await isOnline();
      setOnline(ok);
      if (ok) {
        await syncAll();
        setLastSyncedAt(new Date());
      }
    } catch {
      setOnline(false);
    } finally {
      await refreshPending();
      setSyncing(false);
      running.current = false;
    }
  }, [refreshPending]);

  useEffect(() => {
    if (!enabled) return;
    void syncNow();
    const timer = setInterval(() => void syncNow(), AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, syncNow]);

  const value = useMemo<SyncState>(
    () => ({ online, syncing, pendingCount, lastSyncedAt, syncNow, refreshPending }),
    [online, syncing, pendingCount, lastSyncedAt, syncNow, refreshPending],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync 必须在 SyncProvider 内使用");
  return ctx;
}
