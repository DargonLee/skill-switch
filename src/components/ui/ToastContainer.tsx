import { useToast, type ToastItem } from "./Toast";
import { CheckCircle, XCircle, Info, Loader, X } from "lucide-react";
import s from "./ToastContainer.module.css";

function ToastIcon({ type }: { type: ToastItem["type"] }) {
  switch (type) {
    case "success": return <CheckCircle size={15} className={s.iconSuccess} />;
    case "error":   return <XCircle     size={15} className={s.iconError} />;
    case "loading": return <Loader      size={15} className={s.iconLoading} />;
    default:        return <Info        size={15} className={s.iconInfo} />;
  }
}

function ToastEntry({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  return (
    <div className={`${s.toast} ${s[`toast_${item.type}`]}`}>
      <ToastIcon type={item.type} />
      <span className={s.message}>{item.message}</span>
      <button className={s.close} onClick={onDismiss}><X size={12} /></button>
    </div>
  );
}

/** Mount this once in App.tsx — renders all active toasts */
export function ToastContainer() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;
  return (
    <div className={s.container}>
      {toasts.map(t => (
        <ToastEntry key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}
