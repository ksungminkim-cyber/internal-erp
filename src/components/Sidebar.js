'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import {
  Home, Clock, FileText, User, Building2, Calendar, ClipboardCheck,
  ListTodo, Package, TrendingUp, Megaphone, Wrench, BookOpen,
  MessageCircle, BarChart3, LogOut, Crown, Shield, ChevronDown, Lock,
  Target, MessageSquare,
} from 'lucide-react';
import { useState } from 'react';

const MAIN_LINKS = [
  { href: '/home', label: '홈', icon: Home },
  { href: '/attendance', label: '근태', icon: Clock },
  { href: '/approvals', label: '결재', icon: FileText },
];

const OPS_LINKS = [
  { href: '/schedule', label: '시프트', icon: Calendar },
  { href: '/handover', label: '인수인계', icon: ClipboardCheck },
  { href: '/checklists', label: '체크리스트', icon: ListTodo },
  { href: '/inventory', label: '재고·발주', icon: Package },
  { href: '/equipment', label: '장비 점검', icon: Wrench },
  { href: '/recipes', label: '레시피', icon: BookOpen },
  { href: '/complaints', label: '고객 클레임', icon: MessageCircle },
  { href: '/sales', label: '매출', icon: TrendingUp },
  { href: '/kpis', label: 'KPI · OKR', icon: Target },
  { href: '/reports', label: '월별 리포트', icon: BarChart3 },
  { href: '/announcements', label: '공지사항', icon: Megaphone },
  { href: '/suggestions', label: '건의함', icon: MessageSquare },
];

const ADMIN_LINKS = [
  { href: '/closing', label: '월 마감', icon: Lock },
  { href: '/members', label: '직원 관리', icon: User },
];

const ROLE_META = {
  owner:   { label: '대표',   icon: Crown },
  manager: { label: '매니저', icon: Shield },
  staff:   { label: '직원',   icon: User },
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, memberships, currentWorkplaceId, currentWorkplace, switchWorkplace, role, supabase } = useApp();
  const [wpOpen, setWpOpen] = useState(false);
  const isAdmin = profile?.is_super_admin === true || memberships.some((m) => m.role === 'owner');

  const isActive = (href) => pathname === href || pathname.startsWith(href + '/');
  const r = ROLE_META[role] ?? ROLE_META.staff;
  const RoleIcon = r.icon;

  async function logout() {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('signOut error', e);
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '4px 8px' }}>
        <div
          style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'var(--grad-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 16,
            boxShadow: 'var(--sh-sm)',
            letterSpacing: '-0.04em',
          }}
        >
          C
        </div>
        <div>
          <div className="h4" style={{ fontSize: 14 }}>Counter</div>
          <div className="text-muted" style={{ fontSize: 11 }}>매장 운영 플랫폼</div>
        </div>
      </div>

      {/* Workplace switcher */}
      {memberships.length > 0 && (
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <button
            type="button"
            onClick={() => setWpOpen(!wpOpen)}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 12, borderRadius: 12,
              background: 'var(--surface-soft)',
              border: 'none', cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Building2 size={16} color="var(--accent)" />
            <span style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{currentWorkplace?.name ?? '사업장 선택'}</span>
            {memberships.length > 1 && <ChevronDown size={14} className="text-muted" />}
          </button>
          {wpOpen && memberships.length > 1 && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12, padding: 6,
                boxShadow: 'var(--sh-md)',
                zIndex: 50,
              }}
            >
              {memberships.map((m) => (
                <button
                  key={m.workplace_id}
                  type="button"
                  onClick={() => { switchWorkplace(m.workplace_id); setWpOpen(false); }}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: m.workplace_id === currentWorkplaceId ? 'var(--accent-soft)' : 'transparent',
                    color: m.workplace_id === currentWorkplaceId ? 'var(--accent-strong)' : 'var(--text)',
                    fontWeight: 600, fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                >
                  <Building2 size={14} />
                  {m.workplaces?.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main nav */}
      <nav style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {MAIN_LINKS.map(({ href, label, icon: Icon }) => (
          <NavLink key={href} href={href} icon={Icon} label={label} active={isActive(href)} />
        ))}

        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: 0.08, textTransform: 'uppercase',
          padding: '16px 12px 6px',
        }}>
          운영
        </div>
        {OPS_LINKS.map(({ href, label, icon: Icon }) => (
          <NavLink key={href} href={href} icon={Icon} label={label} active={isActive(href)} />
        ))}

        {isAdmin && (
          <>
            <div style={{
              fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
              letterSpacing: 0.08, textTransform: 'uppercase',
              padding: '16px 12px 6px',
            }}>
              관리
            </div>
            {ADMIN_LINKS.map(({ href, label, icon: Icon }) => (
              <NavLink key={href} href={href} icon={Icon} label={label} active={isActive(href)} />
            ))}
          </>
        )}
      </nav>

      {/* Profile footer */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
        <Link href="/me" style={{ textDecoration: 'none' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 10, borderRadius: 12,
              background: isActive('/me') ? 'var(--accent-soft)' : 'transparent',
              transition: 'all var(--t-sm) var(--ease)',
            }}
          >
            <div
              style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--grad-accent)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 13,
              }}
            >
              {(profile?.name ?? '?').slice(0, 1)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.name ?? '—'}
              </div>
              <div className="text-muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <RoleIcon size={10} /> {r.label}
              </div>
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={logout}
          style={{
            width: '100%', marginTop: 4,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 10,
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <LogOut size={14} /> 로그아웃
        </button>
      </div>
    </aside>
  );
}

function NavLink({ href, icon: Icon, label, active }) {
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', borderRadius: 10,
          background: active ? 'var(--accent-soft)' : 'transparent',
          color: active ? 'var(--accent-strong)' : 'var(--text-secondary)',
          fontWeight: active ? 700 : 600,
          fontSize: 13,
          transition: 'all var(--t-sm) var(--ease)',
        }}
      >
        <Icon size={16} strokeWidth={active ? 2.4 : 2} />
        {label}
      </div>
    </Link>
  );
}
