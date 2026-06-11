'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatCurrency } from '@/lib/format';
import { safeMutate } from '@/lib/safeMutate';
import { updateMyProfile } from './actions';
import { LogOut, Save, Building2, Crown, User as UserIcon, Shield, Wallet, KeyRound, Eye, EyeOff } from 'lucide-react';

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

  // 비밀번호 변경 상태
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwNew2, setPwNew2] = useState('');
  const [pwShow, setPwShow] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwInfo, setPwInfo] = useState(null);
  const [pwError, setPwError] = useState(null);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true); setError(null); setInfo(null);
    try {
    const res = await updateMyProfile({ name, phone });
    if (res?.error) setError(res.error);
    else {
      setInfo('저장되었습니다');
      refresh?.();
      setTimeout(() => setInfo(null), 2000);
    }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwSaving(true); setPwError(null); setPwInfo(null);
    try {
      if (pwNew.length < 8) throw new Error('새 비밀번호는 8자 이상이어야 합니다');
      if (pwNew !== pwNew2) throw new Error('새 비밀번호가 일치하지 않습니다');
      // 현재 비밀번호 검증 (재인증)
      const { error: signErr } = await safeMutate(supabase.auth.signInWithPassword({
        email: user.email,
        password: pwOld,
      }));
      if (signErr) throw new Error('현재 비밀번호가 올바르지 않습니다');
      // 비밀번호 변경
      const { error: updErr } = await safeMutate(supabase.auth.updateUser({ password: pwNew }));
      if (updErr) throw new Error(updErr.message);
      setPwOld(''); setPwNew(''); setPwNew2('');
      setPwInfo('비밀번호가 변경되었습니다');
      setTimeout(() => setPwInfo(null), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  async function logout() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
    }
    window.location.href = '/api/auth/logout';
  }

  return (
    <>
      <PageHeader title="내정보" subtitle={user?.email} hideSwitcher />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

        {/* 시급 (수정 불가 — 관리자만 변경) */}
        {Number(profile?.hourly_wage) > 0 && (
          <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'var(--accent-soft)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Wallet size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase' }}>시급</div>
              <div className="h3 num" style={{ marginTop: 2 }}>
                {formatCurrency(profile.hourly_wage)}<span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginLeft: 4 }}>원/시간</span>
              </div>
            </div>
            <span className="text-faint" style={{ fontSize: 11 }}>변경은 관리자 문의</span>
          </section>
        )}

        {/* 비밀번호 변경 */}
        <form onSubmit={changePassword} className="card">
          <h2 className="h3" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyRound size={18} color="var(--accent)" /> 비밀번호 변경
          </h2>

          <label className="label">현재 비밀번호</label>
          <input
            className="input"
            type={pwShow ? 'text' : 'password'}
            value={pwOld}
            onChange={(e) => setPwOld(e.target.value)}
            autoComplete="current-password"
            required
          />

          <label className="label" style={{ marginTop: 12 }}>새 비밀번호 (8자 이상)</label>
          <input
            className="input"
            type={pwShow ? 'text' : 'password'}
            value={pwNew}
            onChange={(e) => setPwNew(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />

          <label className="label" style={{ marginTop: 12 }}>새 비밀번호 확인</label>
          <input
            className="input"
            type={pwShow ? 'text' : 'password'}
            value={pwNew2}
            onChange={(e) => setPwNew2(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={pwShow}
              onChange={(e) => setPwShow(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            {pwShow ? <Eye size={12} /> : <EyeOff size={12} />} 비밀번호 보기
          </label>

          {pwError && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
              {pwError}
            </div>
          )}
          {pwInfo && (
            <div style={{ marginTop: 10, padding: 10, background: 'var(--success-soft)', color: '#00876c', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              ✓ {pwInfo}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={pwSaving}>
            <KeyRound size={14} /> {pwSaving ? '변경 중...' : '비밀번호 변경'}
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
