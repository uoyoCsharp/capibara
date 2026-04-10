import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastOptions {
  duration?: number;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  add: (type: ToastType, message: string, opts?: ToastOptions) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (type, message, opts) => {
    const duration = opts?.duration ?? (type === 'error' ? 6000 : 4000);
    const id = `toast-${++counter}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration, action: opts?.action }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers */
export const toast = {
  success: (msg: string, opts?: ToastOptions) => useToastStore.getState().add('success', msg, opts),
  error: (msg: string, opts?: ToastOptions) => useToastStore.getState().add('error', msg, { duration: 6000, ...opts }),
  info: (msg: string, opts?: ToastOptions) => useToastStore.getState().add('info', msg, opts),
  warning: (msg: string, opts?: ToastOptions) => useToastStore.getState().add('warning', msg, opts),
};
