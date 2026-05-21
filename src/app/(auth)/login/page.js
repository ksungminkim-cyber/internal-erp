'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Sparkles } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/home';

  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const supabase = createClient();
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { name, phone } },
        });
        if (error) throw error;
        if (data.user && !data.session) {
          setInfo('이메일 인증 메일을 확인해주세요');
        } else {
          router.replace(next);
          router.refresh();
        }
      }
    } catch (err) {
      setError(err.message ?? '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pop-in" style={{ width: '100%', maxWidth: 420 }}>
      {/* 로고 영역 */}
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div
          style={{
            width: 72, height: 72, margin: '0 auto 20px',
            borderRadius: 22,
            background: 'var(--grad-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 36, fontWeight: 800,
            boxShadow: 'var(--sh-accent)',
            letterSpacing: '-0.04em',
          }}
        >
          C
        </div>
        <h1 className="h1" style={{ fontSize: 30 }}>Counter</h1>
        <p className="text-secondary" style={{ fontSize: 14, marginTop: 8, fontWeight: 500 }}>
          맥클린 사업장 운영 ERP
        </p>
      </div>

      {/* 폼 카드 */}
      <div className="card elevated" style={{ padding: 24, borderRadius: 22 }}>
        <div className="segment" style={{ width: '100%', marginBottom: 24 }}>
          <button
            type="button"
            className={`segment-item ${mode === 'signin' ? 'is-active' : ''}`}
            onClick={() => setMode('signin')}
            style={{ flex: 1 }}
          >
            로그인
          </button>
          <button
            type="button"
            className={`segment-item ${mode === 'signup' ? 'is-active' : ''}`}
            onClick={() => setMode('signup')}
            style={{ flex: 1 }}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack stack-3">
          {mode === 'signup' && (
            <>
              <div>
                <label className="label">이름</label>
                <input className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="홍길동" />
              </div>
              <div>
                <label className="label">연락처 (선택)</label>
                <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-0000-0000" />
              </div>
            </>
          )}
          <div>
            <label className="label">이메일</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="6자 이상"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && (
            <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)', padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
              {info}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={loading} style={{ marginTop: 4 }}>
            {loading ? '처리 중...' : mode === 'signin' ? (
              <>로그인 <ArrowRight size={18} /></>
            ) : (
              <>가입하기 <ArrowRight size={18} /></>
            )}
          </button>
        </form>
      </div>

      <p className="text-muted" style={{ marginTop: 16, fontSize: 12, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Sparkles size={12} /> 가입 후 관리자 배정이 필요합니다
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'radial-gradient(ellipse at top, var(--accent-soft) 0%, var(--bg) 50%)',
      }}
    >
      <Suspense fallback={<div className="skeleton" style={{ width: 400, height: 500 }} />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
