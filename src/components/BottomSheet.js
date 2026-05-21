'use client';

import { useEffect } from 'react';

export default function BottomSheet({ children, onClose, maxWidth = 480 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fadeIn .2s var(--ease)',
      }}
      onClick={onClose}
    >
      <div
        className="pop-in"
        style={{
          width: '100%', maxWidth,
          background: 'var(--surface)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 24,
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          maxHeight: '85dvh', overflowY: 'auto',
          boxShadow: 'var(--sh-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 999,
          background: 'var(--border-strong)',
          margin: '0 auto 16px',
        }} />
        {children}
      </div>
    </div>
  );
}
