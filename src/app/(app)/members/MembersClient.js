'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative, formatCurrency } from '@/lib/format';
import { downloadCsv } from '@/lib/csvExport';
import { saveMemberAssignment } from './actions';
import {
  ChevronLeft, UserPlus, X, Crown, Shield, User as UserIcon,
  MoreVertical, Building2, Sparkles, Download,
} from 'lucide-react';

const ROLE_META = {
  staff:   { label: '직원',   tag: 'tag',        icon: UserIcon },
  manager: { label: '매니저', tag: 'tag-accent', icon: Shield },
  owner:   { label: '대표',   tag: 'tag-accent', icon: Crown },
};
const STORE_ROLES = [
  { key: 'manager', label: '매니저', icon: Shield },
  { key: 'staff',   label: '직원',   icon: UserIcon },
];
const HQ_ROLES = [
  { key: 'owner',   label: '대표',   icon: Crown },
  { key: 'manager', label: '관리자', icon: Shield },
  { key: 'staff',   label: '직원',   icon: UserIcon },
];

export default function MembersClient({ workplaces, profiles, memberships, currentUserId, isExecutive = false }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);

  const activeByUser = new Map();
  memberships.filter((m) => m.active).forEach((m) => {
    if (!activeByUser.has(m.user_id)) activeByUser.set(m.user_id, []);
    activeByUser.get(m.user_id).push(m);
  });

  const unassigned = profiles.filter((p) => !(activeByUser.get(p.user_id)?.length));
  const assigned   = profiles.filter((p) =>   activeByUser.get(p.user_id)?.length);

  function exportCsv() {
    const rows = assigned.map((p) => {
      const mems = activeByUser.get(p.user_id) ?? [];
      const wpNames = mems
        .map((m) => `${workplaces.find((w) => w.id === m.workplace_id)?.name ?? '-'}(${ROLE_META[m.role]?.label ?? m.role})`)
        .join(' / ');
      return {
        name: p.name ?? '',
        phone: p.phone ?? '',
        hourly_wage: p.hourly_wage ?? 0,
        workplaces: wpNames,
        created_at: p.created_at,
      };
    });
    downloadCsv(
      'members.csv',
      [
        { key: 'name',        label: '이름' },
        { key: 'phone',       label: '연락처' },
        { key: 'hourly_wage', label: '시급(원)' },
        { key: 'workplaces',  label: '소속 사업장 / 역할' },
        { key: 'created_at',  label: '가입일', format: (v) => v?.slice(0, 10) },
      ],
      rows
    );
  }

  return (
    <>
      <PageHeader
        title="직원 관리"
        subtitle="회원가입한 직원에게 사업장·역할·시급 배정"
        hideSwitcher
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!assigned.length}>
              <Download size={14} /> CSV
            </button>
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
              <ChevronLeft size={20} />
            </button>
          </div>
        }
      />

      <main
        className="fade-in page-main"
        style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
        onClick={() => setMenuOpenId(null)}
      >
        {/* 미배정 */}
        <section className="stack stack-3">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 className="h3">배정 대기</h2>
            {unassigned.length > 0 && (
              <span className="tag tag-warning">{unassigned.length}명</span>
            )}
          </div>

          {unassigned.length === 0 ? (
            <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
              <p className="text-muted" style={{ fontSize: 13, textAlign: 'center' }}>모두 배정되어 있어요</p>
            </div>
          ) : (
            <div className="stack stack-2">
              {unassigned.map((p) => (
                <div key={p.user_id} className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={p.name} userId={p.user_id} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="h4">{p.name || '이름 없음'}</div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {p.phone || '연락처 없음'} · 가입 {formatRelative(p.created_at)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setEditing({ profile: p, mode: 'assign' })}
                  >
                    <UserPlus size={14} /> 배정
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 배정된 멤버 */}
        <section className="stack stack-3">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 className="h3">현재 멤버</h2>
            <span className="text-muted" style={{ fontSize: 12 }}>{assigned.length}명</span>
          </div>

          {assigned.length === 0 ? (
            <div className="card empty">
              <div className="empty-desc">아직 등록된 멤버가 없어요</div>
            </div>
          ) : (
            <div className="stack stack-2">
              {assigned.map((p) => {
                const mems = activeByUser.get(p.user_id) ?? [];
                const isMe = p.user_id === currentUserId;
                return (
                  <div key={p.user_id} className="card compact" style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={p.name} userId={p.user_id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <div className="h4">{p.name || '이름 없음'}</div>
                          {isMe && <span className="tag tag-accent">나</span>}
                          {(p.is_super_admin || p.is_executive) && <span className="tag tag-accent"><Crown size={10} /> 전체관리</span>}
                          {p.can_close_books && !p.is_super_admin && !p.is_executive && <span className="tag tag-mint">마감권한</span>}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {p.phone || '연락처 없음'}
                        </div>
                      </div>

                      {isExecutive && (
                        <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(menuOpenId === p.user_id ? null : p.user_id);
                            }}
                          >
                            <MoreVertical size={16} />
                          </button>
                          {menuOpenId === p.user_id && (
                            <div style={{
                              position: 'absolute', top: '100%', right: 0, marginTop: 4,
                              background: 'var(--surface)', border: '1px solid var(--border)',
                              borderRadius: 12, padding: 4,
                              boxShadow: 'var(--sh-md)', minWidth: 160, zIndex: 30,
                            }}>
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); setEditing({ profile: p, mode: 'edit' }); }}
                                style={menuItemStyle}
                              >
                                <Building2 size={14} /> 배정 수정
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {mems.map((m) => {
                        const wp = workplaces.find((w) => w.id === m.workplace_id);
                        return (
                          <span key={m.id} className="tag dot">
                            <Building2 size={10} /> {wp?.name ?? '—'}
                          </span>
                        );
                      })}
                      {Number(p.hourly_wage) > 0 && (
                        <span className="tag" style={{ marginLeft: 'auto', fontWeight: 700 }}>
                          시급 <span className="num">{formatCurrency(p.hourly_wage)}</span>원
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Sparkles size={18} color="var(--accent)" />
            <div style={{ flex: 1 }}>
              <div className="h4" style={{ marginBottom: 4 }}>배정 흐름</div>
              <ul style={{ listStyle: 'none', padding: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>1. 직원이 사이트에서 회원가입 (이메일·비번)</li>
                <li>2. 이 페이지 &ldquo;배정 대기&rdquo; 목록에 자동 표시</li>
                <li>3. &ldquo;배정&rdquo; 버튼 → 사업장·역할 선택 → 완료</li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      {editing && (
        <AssignDialog
          profile={editing.profile}
          mode={editing.mode}
          workplaces={workplaces}
          currentMemberships={memberships.filter((m) => m.user_id === editing.profile.user_id)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}
    </>
  );
}

const menuItemStyle = {
  width: '100%', padding: '10px 12px',
  border: 'none', background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 13, fontWeight: 600, textAlign: 'left',
  borderRadius: 8,
};

function AssignDialog({ profile, mode, workplaces, currentMemberships, onClose, onSaved }) {
  const [state, setState] = useState(() => {
    const s = {};
    workplaces.forEach((w) => {
      const m = currentMemberships.find((mm) => mm.workplace_id === w.id);
      s[w.id] = { active: m?.active ?? false, role: m?.role ?? 'staff' };
    });
    return s;
  });
  const [hourlyWage, setHourlyWage]   = useState(profile?.hourly_wage ?? 0);
  const [canCloseBooks, setCanCloseBooks] = useState(profile?.can_close_books === true);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  function setRole(wpId, role) {
    setState((p) => ({ ...p, [wpId]: { ...p[wpId], role, active: true } }));
  }
  function toggleActive(wpId) {
    setState((p) => ({ ...p, [wpId]: { ...p[wpId], active: !p[wpId].active } }));
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const wageChanged  = Number(hourlyWage) !== Number(profile?.hourly_wage ?? 0);
      const permChanged  = canCloseBooks !== (profile?.can_close_books === true);
      const profileChanged = wageChanged || permChanged;

      const updates = workplaces.map((w) => {
        const s        = state[w.id];
        const existing = currentMemberships.find((m) => m.workplace_id === w.id);
        const changed  = existing
          ? (s.active !== existing.active || s.role !== existing.role)
          : s.active;
        if (!changed) return null;
        return { workplaceId: w.id, active: s.active, role: s.role, existingId: existing?.id ?? null };
      }).filter(Boolean);

      if (!profileChanged && updates.length === 0) { onClose(); return; }

      await saveMemberAssignment({
        userId:    profile.user_id,
        userName:  profile.name  ?? null,
        userPhone: profile.phone ?? null,
        hourlyWage: Number(hourlyWage) || 0,
        canCloseBooks,
        profileChanged,
        updates,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">{mode === 'assign' ? '사업장 배정' : '배정 수정'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>
      <div className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
        <strong style={{ color: 'var(--text)' }}>{profile.name || '이름 없음'}</strong>
        {profile.phone && ` · ${profile.phone}`}
      </div>

      <div className="stack stack-3">
        {workplaces.map((w) => {
          const s = state[w.id];
          return (
            <div
              key={w.id}
              style={{
                padding: 14, borderRadius: 14,
                background: s.active ? 'var(--accent-soft)' : 'var(--surface-soft)',
                border: s.active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                transition: 'all var(--t-sm) var(--ease)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: s.active ? 12 : 0 }}>
                <Building2 size={18} color={s.active ? 'var(--accent)' : 'var(--text-muted)'} />
                <div style={{ flex: 1 }}><div className="h4">{w.name}</div></div>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  color: s.active ? 'var(--accent-strong)' : 'var(--text-muted)',
                }}>
                  <input
                    type="checkbox"
                    checked={s.active}
                    onChange={() => toggleActive(w.id)}
                    style={{ accentColor: 'var(--accent)', width: 16, height: 16 }}
                  />
                  소속
                </label>
              </div>

              {s.active && (
                <>
                  <div className="segment" style={{ width: '100%' }}>
                    {(w.name === '본사' ? HQ_ROLES : STORE_ROLES).map((m) => {
                      const RoleIcon = m.icon;
                      return (
                        <button
                          key={m.key}
                          type="button"
                          className={`segment-item ${s.role === m.key ? 'is-active' : ''}`}
                          onClick={() => setRole(w.id, m.key)}
                          style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        >
                          <RoleIcon size={12} /> {m.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                    {w.name === '본사'
                      ? s.role === 'owner'
                        ? '→ 대표. 전 매장 접근 + 결재 최종 승인 가능.'
                        : '→ 본사 멤버. 전 매장 접근 가능.'
                      : s.role === 'manager'
                        ? '→ 매니저. 결재 중간 승인 가능.'
                        : '→ 직원. 일반 업무만 가능.'}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 16, padding: 14, borderRadius: 14, background: 'var(--surface-soft)' }}>
        <label className="label">시급 (원/시간)</label>
        <input
          className="input num"
          type="number"
          inputMode="numeric"
          value={hourlyWage}
          onChange={(e) => setHourlyWage(e.target.value)}
          placeholder="예) 10500"
        />
        <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
          월 마감 인건비 자동 계산에 사용됩니다 (근무시간 × 시급)
        </p>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginTop: 12, padding: 14, borderRadius: 14,
        background: canCloseBooks ? 'var(--accent-soft)' : 'var(--surface-soft)',
        border: canCloseBooks ? '1.5px solid var(--accent)' : '1.5px solid transparent',
        cursor: 'pointer',
        transition: 'all var(--t-sm) var(--ease)',
      }}>
        <input
          type="checkbox"
          checked={canCloseBooks}
          onChange={(e) => setCanCloseBooks(e.target.checked)}
          style={{ accentColor: 'var(--accent)', width: 18, height: 18 }}
        />
        <div style={{ flex: 1 }}>
          <div className="h4" style={{ fontSize: 14, color: canCloseBooks ? 'var(--accent-strong)' : 'var(--text)' }}>
            월 마감 권한
          </div>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
            대표 외에 이 직원에게도 월 마감 확정/해제 권한을 부여합니다
          </p>
        </div>
      </label>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}
