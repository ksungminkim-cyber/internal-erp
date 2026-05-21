'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { LogOut, Save, Building2, Crown, User as UserIcon, Shield } from 'lucide-react';

const ROLE_META = {
  staff:   { label: '직원',     icon: UserIcon, tag: 'tag' },
  manager: { label: '매니저',   icon: Shield,   tag: 'tag-accent' },
  owner:   { label: '대표',     icon: Crown,    tag: 'tag-warning' },
};

export default function MePage() {
  const router = useRouter();
  const { user, profile, memberships, supabase, refresh } = useApp();
  const [name, setName] = useState(profile?.name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true); setError(null); setInfo(null);
    const { error } = await supabase
      .from('profiles')
      .update({ name: name.trim(), phone: phone.trim() || null, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    if (error) setError(error.message);
    else {
      setInfo('저장되었습니다');
      refresh?.();
      setTimeout(() => setInfo(null), 2000);
    }
    setSaving(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <PageHeader title="내정보" subtitle={user?.email} hideSwitcher />

      <main className="fade-in" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 프로필 카드 */}
        <section className="card" style={{ textAlign: 'center', paddingTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <Avatar name={profile?.name} userId={user?.id} size="lg" />
          </div>
          <h2 className="h2">{profile?.name || '이름 없음'}</h2>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>{user?.email}</p>
        </section>

        {/* 프로필 편집 */}
        <form onSubmit={saveProfile} className="card">
          <h2 className="h3" style={{ marginBottom: 14 }}>기본 정보</h2>

          <label className="label">이름</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />

          <label className="label" style={{ marginTop: 12 }}>연락처</label>
          <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />

          {error && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--success-soft)', color: '#00876c', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              ✓ {info}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={saving}>
            <Save size={14} /> {saving ? '저장 중...' : '저장'}
          </button>
        </form>

        {/* 소속 */}
        <section className="card">
          <h2 className="h3" style={{ marginBottom: 14 }}>소속 사업장</h2>
          {memberships.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>아직 사업장에 배정되지 않았어요</p>
          ) : (
            <div className="stack stack-2">
              {memberships.map((m) => {
                const r = ROLE_META[m.role] ?? ROLE_META.staff;
                const RoleIcon = r.icon;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: 14, borderRadius: 14,
                      background: 'var(--surface-soft)',
                    }}
                  >
                    <div
                      style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'var(--accent-soft)', color: 'var(--accent)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Building2 size={20} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="h4">{m.workplaces?.name}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>매장</div>
                    </div>
                    <span className={`tag ${r.tag} dot`}>
                      <RoleIcon size={11} /> {r.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <button type="button" className="btn btn-outline btn-lg" onClick={logout} style={{ color: 'var(--danger)' }}>
          <LogOut size={14} /> 로그아웃
        </button>

        <p className="text-faint" style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>
          Internal ERP v0.1 · 사내 전용
        </p>
      </main>
    </>
  );
}
