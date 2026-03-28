import {
  createContext, useContext, useCallback,
  useState, useRef, type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** ms before auto-dismiss. undefined = never auto-dismiss (used for loading) */
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  /** Show a success toast (default 2400ms) */
  success: (msg: string, duration?: number) => string;
  /** Show an error toast (default 3500ms) */
  error: (msg: string, duration?: number) => string;
  /** Show an info toast (default 2400ms) */
  info: (msg: string, duration?: number) => string;
  /** Show a persistent loading toast — returns id so caller can dismiss it */
  loading: (msg: string) => string;
  /** Dismiss a specific toast by id */
  dismiss: (id: string) => void;
  /** Replace a loading toast with a result (success / error) */
  resolve: (id: string, type: "success" | "error", msg: string, duration?: number) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const add = useCallback((type: ToastType, message: string, duration?: number): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);

    if (duration !== undefined && duration > 0) {
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
        timers.current.delete(id);
      }, duration);
      timers.current.set(id, timer);
    }
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const resolve = useCallback((
    id: string, type: "success" | "error", msg: string, duration = 2400
  ) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts(prev => prev.map(t => t.id === id ? { ...t, type, message: msg } : t));
    const newTimer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timers.current.delete(id);
    }, duration);
    timers.current.set(id, newTimer);
  }, []);

  const value: ToastContextValue = {
    toasts,
    success: (msg, dur = 2400) => add("success", msg, dur),
    error:   (msg, dur = 3500) => add("error",   msg, dur),
    info:    (msg, dur = 2400) => add("info",     msg, dur),
    loading: (msg)             => add("loading",  msg, undefined),
    dismiss,
    resolve,
  };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
