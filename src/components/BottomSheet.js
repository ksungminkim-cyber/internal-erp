'use client';

import { useEffect, useState } from 'react';

export default function BottomSheet({ children, onClose, maxWidth = 480 }) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
        display: 'flex',
        alignItems: isDesktop ? 'center' : 'flex-end',
        justifyContent: 'center',
        padding: isDesktop ? 20 : 0,
        animation: 'fadeIn .2s var(--ease)',
      }}
      onClick={onClose}
    >
      <div
        className={isDesktop ? 'pop-in' : 'slide-up'}
        style={{
          width: '100%',
          maxWidth: isDesktop ? Math.max(maxWidth, 520) : maxWidth,
          background: 'var(--surface)',
          borderRadius: isDesktop ? 20 : 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: 24,
          paddingBottom: isDesktop ? 24 : 'calc(24px + env(safe-area-inset-bottom, 0px))',
          maxHeight: isDesktop ? '90dvh' : '85dvh',
          overflowY: 'auto',
          boxShadow: 'var(--sh-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!isDesktop && (
          <div style={{
            width: 36, height: 4, borderRadius: 999,
            background: 'var(--border-strong)',
            margin: '0 auto 16px',
          }} />
        )}
        {children}
      </div>
    </div>
  );
}
