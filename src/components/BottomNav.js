'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Clock, LayoutGrid, FileText, User } from 'lucide-react';

const TABS = [
  { href: '/home', label: '홈', icon: Home },
  { href: '/attendance', label: '근태', icon: Clock },
  { href: '/operations', label: '운영', icon: LayoutGrid, matches: ['/operations', '/schedule', '/handover', '/checklists', '/inventory', '/sales', '/announcements', '/equipment', '/recipes', '/complaints', '/reports'] },
  { href: '/approvals', label: '결재', icon: FileText },
  { href: '/me', label: '내정보', icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        background: 'var(--glass-bg)',
        backdropFilter: 'saturate(180%) blur(24px)',
        WebkitBackdropFilter: 'saturate(180%) blur(24px)',
        borderTop: '1px solid var(--border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        boxShadow: 'var(--sh-dock)',
        zIndex: 50,
      }}
    >
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
          listStyle: 'none',
          height: 'var(--nav-h)',
          padding: '0 8px',
        }}
      >
        {TABS.map(({ href, label, icon: Icon, matches }) => {
          const matchPaths = matches ?? [href];
          const active = matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
          return (
            <li key={href} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Link
                href={href}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  textDecoration: 'none',
                  padding: '8px 6px',
                  borderRadius: 14,
                  width: '100%',
                  position: 'relative',
                  transition: 'all var(--t-sm) var(--ease)',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                <div
                  style={{
                    width: 36, height: 32,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 12,
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    transition: 'all var(--t-sm) var(--ease)',
                  }}
                >
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: active ? 700 : 600,
                    letterSpacing: 0,
                  }}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
