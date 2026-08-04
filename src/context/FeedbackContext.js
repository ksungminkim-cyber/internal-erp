'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react';

// 네이티브 alert()/confirm() 대체 — 앱 톤에 맞는 토스트 + 확인 다이얼로그
const FeedbackContext = createContext(null);

const TOAST_ICON = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const idRef = useRef(0);

  const toast = useCallback((message, type = 'info') => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  // confirmDialog('메시지') 또는 confirmDialog({ title, message, confirmLabel, danger })
  const confirmDialog = useCallback((opts) => {
    const o = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise((resolve) => {
      setConfirmState({ ...o, resolve });
    });
  }, []);

  const settle = (result) => {
    confirmState?.resolve(result);
    setConfirmState(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirmDialog }}>
      {children}

      {/* 토스트 스택 */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => {
          const Icon = TOAST_ICON[t.type] ?? Info;
          return (
            <div key={t.id} className={`toast toast-${t.type}`}>
              <Icon size={16} />
              <span>{t.message}</span>
            </div>
          );
        })}
      </div>

      {/* 확인 다이얼로그 */}
      {confirmState && (
        <div className="dialog-overlay" onClick={() => settle(false)}>
          <div
            className="dialog-card"
            role="alertdialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`dialog-icon ${confirmState.danger ? 'danger' : ''}`}>
              <AlertTriangle size={20} />
            </div>
            {confirmState.title && <div className="h3" style={{ marginBottom: 6 }}>{confirmState.title}</div>}
            <p className="dialog-message">{confirmState.message}</p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-soft" onClick={() => settle(false)}>
                취소
              </button>
              <button
                type="button"
                className={`btn ${confirmState.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
                autoFocus
              >
                {confirmState.confirmLabel ?? '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback must be used within FeedbackProvider');
  return ctx;
}
