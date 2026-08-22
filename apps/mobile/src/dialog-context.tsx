import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AppDialog } from "./components/AppDialog";

export type ConfirmOpts = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Queued =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | {
      kind: "notice";
      opts: { title: string; message?: string; confirmLabel?: string };
      resolve: () => void;
    };

type DialogCtx = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  notice: (title: string, message?: string) => Promise<void>;
};

const DialogContext = createContext<DialogCtx | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const current = queue[0] ?? null;

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { kind: "confirm", opts, resolve }]);
    });
  }, []);

  const notice = useCallback((title: string, message?: string) => {
    return new Promise<void>((resolve) => {
      setQueue((q) => [...q, { kind: "notice", opts: { title, message }, resolve }]);
    });
  }, []);

  const value = useMemo(() => ({ confirm, notice }), [confirm, notice]);

  function pop() {
    setQueue((q) => q.slice(1));
  }

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current?.kind === "confirm" ? (
        <AppDialog
          visible
          title={current.opts.title}
          message={current.opts.message}
          confirmLabel={current.opts.confirmLabel ?? "确定"}
          cancelLabel={current.opts.cancelLabel ?? "取消"}
          destructive={current.opts.destructive}
          onConfirm={() => {
            current.resolve(true);
            pop();
          }}
          onCancel={() => {
            current.resolve(false);
            pop();
          }}
        />
      ) : null}
      {current?.kind === "notice" ? (
        <AppDialog
          visible
          title={current.opts.title}
          message={current.opts.message}
          confirmLabel={current.opts.confirmLabel ?? "确定"}
          onConfirm={() => {
            current.resolve();
            pop();
          }}
          onCancel={() => {
            current.resolve();
            pop();
          }}
        />
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog 必须在 DialogProvider 内使用");
  return ctx;
}
