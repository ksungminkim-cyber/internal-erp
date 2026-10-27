'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatDateTime } from '@/lib/format';
import { ChevronLeft, Shield, BarChart3 } from 'lucide-react';
import { getAdDashboard } from './actions';

// 광고 모니터링 팀이 매일 올리는 대시보드 HTML(조각)을 iframe srcdoc 으로 감싸서 보여준다.
// 대시보드 자체는 로컬 "광고\모니터링" 폴더에서 만들어지고 /api/ads/publish 로 저장된다.
function wrap(html) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`;
}

export default function AdsPage() {
  const router = useRouter();
  const { profile, memberships } = useApp();
  const [state, setState] = useState({ loading: true });

  const isOwner = profile?.is_super_admin === true || profile?.is_executive === true || memberships.some((m) => m.role === 'owner');

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    getAdDashboard().then((r) => { if (alive) setState({ loading: false, ...r }); });
    return () => { alive = false; };
  }, [isOwner]);

  if (!isOwner) {
    return (
      <>
        <PageHeader title="광고 현황" hideSwitcher />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">대표만 이용 가능</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="광고 현황"
        subtitle={state.closed ? `${state.closed} 마감 · 갱신 ${formatDateTime(state.updated)}` : '네이버 · 메타 · 구글 · 당근'}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />
      <main className="fade-in page-main" style={{ padding: 0 }}>
        {state.loading ? (
          <div className="card empty" style={{ margin: 16 }}><div className="empty-desc">불러오는 중…</div></div>
        ) : !state.ok ? (
          <div className="card empty" style={{ margin: 16 }}>
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">{state.forbidden ? '접근 권한 없음' : '불러오지 못했어요'}</div>
            <div className="empty-desc">{state.error}</div>
          </div>
        ) : !state.html ? (
          <div className="card empty" style={{ margin: 16 }}>
            <div className="empty-icon"><BarChart3 size={26} /></div>
            <div className="empty-title">아직 올라온 마감이 없어요</div>
            <div className="empty-desc">광고 모니터링 일 마감이 돌면 여기에 표시됩니다.</div>
          </div>
        ) : (
          <iframe
            title="광고 현황 대시보드"
            srcDoc={wrap(state.html)}
            sandbox="allow-scripts allow-same-origin allow-popups"
            style={{ display: 'block', width: '100%', height: 'calc(100vh - 56px - var(--nav-h, 64px) - env(safe-area-inset-bottom, 0px))', border: 0, background: '#f6f6f3' }}
          />
        )}
      </main>
    </>
  );
}
