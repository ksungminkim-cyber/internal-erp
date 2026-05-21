'use client';

import WorkplaceSwitcher from './WorkplaceSwitcher';

export default function PageHeader({ title, subtitle, action, hideSwitcher = false, large = false }) {
  return (
    <header className="page-header">
      {!hideSwitcher && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <WorkplaceSwitcher />
          {action}
        </div>
      )}
      {hideSwitcher && action && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>{action}</div>
      )}
      <h1 className={large ? 'h1' : 'h2'} style={{ marginTop: 4 }}>{title}</h1>
      {subtitle && (
        <p className="text-secondary" style={{ fontSize: 14, marginTop: 4, fontWeight: 500 }}>
          {subtitle}
        </p>
      )}
    </header>
  );
}
