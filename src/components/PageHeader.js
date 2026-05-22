'use client';

import WorkplaceSwitcher from './WorkplaceSwitcher';
import NotificationBell from './NotificationBell';

export default function PageHeader({ title, subtitle, action, hideSwitcher = false, large = false }) {
  const topRow = (!hideSwitcher || action) ? (
    <div
      className="mobile-only-flex"
      style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}
    >
      {hideSwitcher ? <span /> : <WorkplaceSwitcher />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <NotificationBell inline />
        {action}
      </div>
    </div>
  ) : null;

  return (
    <header className="page-header">
      <div className="page-header-inner">
        {topRow}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className={large ? 'h1' : 'h2'} style={{ marginTop: 4 }}>{title}</h1>
            {subtitle && (
              <p className="text-secondary" style={{ fontSize: 14, marginTop: 4, fontWeight: 500 }}>
                {subtitle}
              </p>
            )}
          </div>
          <div className="desktop-only-flex" style={{ alignItems: 'center', gap: 6 }}>
            <NotificationBell inline />
            {action}
          </div>
        </div>
      </div>
    </header>
  );
}
