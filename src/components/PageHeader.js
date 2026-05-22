'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { HelpCircle } from 'lucide-react';
import WorkplaceSwitcher from './WorkplaceSwitcher';
import NotificationBell from './NotificationBell';
import HelpModal from './HelpModal';
import { getPageHelp } from '@/lib/pageHelp';

export default function PageHeader({ title, subtitle, action, hideSwitcher = false, large = false }) {
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);
  const hasHelp = !!getPageHelp(pathname);

  const helpButton = hasHelp ? (
    <button
      type="button"
      onClick={() => setHelpOpen(true)}
      className="btn btn-ghost btn-icon"
      aria-label="이 화면 사용법"
      title="이 화면 사용법"
    >
      <HelpCircle size={18} />
    </button>
  ) : null;

  const topRow = (!hideSwitcher || action || hasHelp) ? (
    <div
      className="mobile-only-flex"
      style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}
    >
      {hideSwitcher ? <span /> : <WorkplaceSwitcher />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {helpButton}
        <NotificationBell inline />
        {action}
      </div>
    </div>
  ) : null;

  return (
    <>
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
              {helpButton}
              <NotificationBell inline />
              {action}
            </div>
          </div>
        </div>
      </header>
      {helpOpen && <HelpModal pathname={pathname} onClose={() => setHelpOpen(false)} />}
    </>
  );
}
