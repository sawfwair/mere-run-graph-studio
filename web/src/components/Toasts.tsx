import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ReactElement } from 'react';

export interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

const icons = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }): ReactElement | null {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone];
        return (
          <div className={`toast ${toast.tone}`} key={toast.id} role="status">
            <Icon size={16} />
            <div className="toast-copy">
              <strong>{toast.title}</strong>
              {toast.message ? <small>{toast.message}</small> : null}
            </div>
            <button className="toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
