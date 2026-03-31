// src/hooks/useToast.ts
import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  duration?: number;
}

export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = (title: string, message: string, duration?: number) => {
    addToast({ type: 'success', title, message, duration });
  };

  const error = (title: string, message: string, duration?: number) => {
    addToast({ type: 'error', title, message, duration });
  };

  const info = (title: string, message: string, duration?: number) => {
    addToast({ type: 'info', title, message, duration });
  };

  const warning = (title: string, message: string, duration?: number) => {
    addToast({ type: 'warning', title, message, duration });
  };

  return {
    toasts,
    addToast,
    removeToast,
    success,
    error,
    info,
    warning,
  };
};
