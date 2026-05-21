'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { formatRelative } from '@/lib/format';
import {
  ChevronLeft, UserPlus, X, Crown, Shield, User as UserIcon,
  MoreVertical, Trash2, Building2, Sparkles,
} from 'lucide-react';

const ROLE_META = {
  staff:   { label: '직원',   tag: 'tag',         icon: UserIcon },
  manager: { label: '매니저', tag: 'tag-accent',  icon: Shield },
  owner:   { label: '대표',   tag: 'tag-warning', icon: Crown },
};

export default function MembersPage() {
  const router = useRouter();
  const { user, profile, supabase, memberships: myMemberships, isManager } = useApp();
  const isSuperAdmin = profile?.is_super_admin === true;

  const [workplaces, setWorkplaces] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [allMemberships, setAllMemberships] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { profile } or null
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [error, setError] = useState(null);

  // 사장님/대표는 super_admin or owner 권한이어야 들어올 수 있음
  const canManage = isSuperAdmin || myMemberships.some((m) => m.role === 'owner');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: wps }, { data: profs }, { data: mems }] = await Promise.all([
      supabase.from('workplaces').select('id, name').order('name'),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase
        .from('memberships')
        .select('id, user_id, workplace_id, role, active'),
    ]);
    setWorkplaces(wps ?? []);
    setAllProfiles(profs ?? []);
    setAllMemberships(mems ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (canManage) load(); }, [load, canManage]);

  useEffect(() => {
    function onDocClick() { setMenuOpenId(null); }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, []);

  if (!canManage) {
    return (
      <>
        <PageHeader
          title="직원 관리"
          hideSwitcher
          action={<button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>}
        />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">대표(owner) 또는 전체 관리자만 이용할 수 있어요.</div>
          </div>
        </main>
      </>
    );
  }

  const activeByUser = new Map();
  allMemberships.filter((m) => m.active).forEach((m) => {
    if (!activeByUser.has(m.user_id)) activeByUser.set(m.user_id, []);
    activeByUser.get(m.user_id).push(m);
  });

  // 미배정: profiles 중에 active membership 없음 + 본인 제외하면 더 깔끔
  const unassigned = allProfiles.filter((p) => !(activeByUser.get(p.user_id)?.length));
  const assigned = allProfiles.filter((p) => activeByUser.get(p.user_id)?.length);

  return (
    <>
      <PageHeader
        title="직원 관리"
        subtitle="회원가입한 직원에게 사업장·역할 배정"
        hideSwitcher
        action={<button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>}
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 미배정 사용자 */}
        <section className="stack stack-3">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 className="h3">배정 대기</h2>
            {unassigned.length > 0 && (
              <span className="tag tag-warning">{unassigned.length}명</span>
            )}
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: 80 }} />
          ) : unassigned.length === 0 ? (
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

          {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : assigned.length === 0 ? (
            <div className="card empty">
              <div className="empty-desc">아직 등록된 멤버가 없어요</div>
            </div>
          ) : (
            <div className="stack stack-2">
              {assigned.map((p) => {
                const mems = activeByUser.get(p.user_id) ?? [];
                const isMe = p.user_id === user?.id;
                return (
                  <div key={p.user_id} className="card compact" style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={p.name} userId={p.user_id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div className="h4">{p.name || '이름 없음'}</div>
                          {isMe && <span className="tag tag-accent">나</span>}
                          {p.is_super_admin && <span className="tag tag-warning"><Crown size={10} /> 전체관리</span>}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {p.phone || '연락처 없음'}
                        </div>
                      </div>
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
                          <div
                            style={{
                              position: 'absolute', top: '100%', right: 0, marginTop: 4,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: 12, padding: 4,
                              boxShadow: 'var(--sh-md)',
                              minWidth: 160,
                              zIndex: 30,
                            }}
                          >
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
                    </div>

                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {mems.map((m) => {
                        const wp = workplaces.find((w) => w.id === m.workplace_id);
                        const r = ROLE_META[m.role] ?? ROLE_META.staff;
                        const RoleIcon = r.icon;
                        return (
                          <span key={m.id} className={`tag ${r.tag} dot`}>
                            <Building2 size={10} /> {wp?.name ?? '—'}
                            <span style={{ marginLeft: 6, opacity: 0.7, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <RoleIcon size={9} /> {r.label}
                            </span>
                          </span>
                        );
                      })}
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
                <li>2. 이 페이지 "배정 대기" 목록에 자동 표시</li>
                <li>3. "배정" 버튼 → 사업장·역할 선택 → 완료</li>
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
          currentMemberships={allMemberships.filter((m) => m.user_id === editing.profile.user_id)}
          supabase={supabase}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
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

function AssignDialog({ profile, mode, workplaces, currentMemberships, supabase, onClose, onSaved }) {
  // 사업장별 멤버십 상태: { workplace_id: { active: bool, role: 'staff'|'manager'|'owner' } }
  const [state, setState] = useState(() => {
    const s = {};
    workplaces.forEach((w) => {
      const m = currentMemberships.find((mm) => mm.workplace_id === w.id);
      s[w.id] = {
        active: m?.active ?? false,
        role: m?.role ?? 'staff',
      };
    });
    return s;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
      for (const w of workplaces) {
        const s = state[w.id];
        const existing = currentMemberships.find((m) => m.workplace_id === w.id);
        if (existing) {
          if (s.active !== existing.active || s.role !== existing.role) {
            const { error } = await supabase
              .from('memberships')
              .update({ active: s.active, role: s.role })
              .eq('id', existing.id);
            if (error) throw error;
          }
        } else if (s.active) {
          const { error } = await supabase
            .from('memberships')
            .insert({
              user_id: profile.user_id,
              workplace_id: w.id,
              role: s.role,
              active: true,
            });
          if (error) throw error;
        }
      }
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
                <div style={{ flex: 1 }}>
                  <div className="h4">{w.name}</div>
                </div>
                <label
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    color: s.active ? 'var(--accent-strong)' : 'var(--text-muted)',
                  }}
                >
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
                <div className="segment" style={{ width: '100%' }}>
                  {Object.entries(ROLE_META).map(([k, m]) => {
                    const RoleIcon = m.icon;
                    return (
                      <button
                        key={k}
                        type="button"
                        className={`segment-item ${s.role === k ? 'is-active' : ''}`}
                        onClick={() => setRole(w.id, k)}
                        style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      >
                        <RoleIcon size={12} /> {m.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

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
