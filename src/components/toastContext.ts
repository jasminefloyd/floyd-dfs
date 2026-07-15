import { createContext } from 'react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastContextValue {
  showToast: (message: string, variant: ToastVariant) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
