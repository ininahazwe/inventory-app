// src/components/Toast.tsx
import React, { useEffect } from 'react';

export interface ToastProps {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  onClose: (id: string) => void;
  duration?: number; // ms, default 4000
}

const Toast: React.FC<ToastProps> = ({
                                       id,
                                       type,
                                       title,
                                       message,
                                       onClose,
                                       duration = 4000,
                                     }) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, onClose]);

  const bgColor = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    info: 'bg-blue-50 border-blue-200',
    warning: 'bg-yellow-50 border-yellow-200',
  }[type];

  const textColor = {
    success: 'text-green-800',
    error: 'text-red-800',
    info: 'text-blue-800',
    warning: 'text-yellow-800',
  }[type];

  const titleColor = {
    success: 'text-green-900',
    error: 'text-red-900',
    info: 'text-blue-900',
    warning: 'text-yellow-900',
  }[type];

  const icon = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
  }[type];

  return (
    <div
      className={`${bgColor} border rounded-lg p-4 mb-3 shadow-md transition-all duration-300 animate-slideIn`}
      role="alert"
    >
      <div className="flex gap-3">
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <h3 className={`font-semibold ${titleColor}`}>{title}</h3>
          <p className={`text-sm ${textColor}`}>{message}</p>
        </div>
        <button
          onClick={() => onClose(id)}
          className="text-gray-400 hover:text-gray-600 self-start"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default Toast;
