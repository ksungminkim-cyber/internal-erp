'use client';

import WorkplaceSwitcher from './WorkplaceSwitcher';

export default function PageHeader({ title, subtitle, action, hideSwitcher = false, large = false }) {
  const topRow = (!hideSwitcher || action) ? (
    <div
      className="mobile-only"
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}
    >
      {hideSwitcher ? <span /> : <WorkplaceSwitcher />}
      {action}
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
          {action && <div className="desktop-only">{action}</div>}
        </div>
      </div>
    </header>
  );
}
