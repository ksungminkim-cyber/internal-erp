// src/components/TrendPicksCard.js
'use client';

import { useEffect, useState } from 'react';
import { Sparkles, ChevronDown, Coffee, Wine, TrendingUp, TrendingDown } from 'lucide-react';
import { getTrendPicks } from '@/app/(app)/home/actions';

// 기준 주(월요일 시작)를 날짜로 — "10.5~10.11 기준"
function fmtWeek(weekStart) {
  if (!weekStart) return '';
  const [y, m, d] = String(weekStart).split('-').map(Number);
  const a = new Date(Date.UTC(y, m - 1, d)), b = new Date(Date.UTC(y, m - 1, d + 6));
  return `${a.getUTCMonth() + 1}.${a.getUTCDate()}~${b.getUTCMonth() + 1}.${b.getUTCDate()} 기준`;
}

function fmtCount(n) {
  if (n == null) return null;
  const v = Number(n);
  if (v >= 10000) return `${Math.round(v / 10000)}만`;
  return new Intl.NumberFormat('ko-KR').format(v);
}

// 13주 검색 추이 — 작은 선 그래프
function Sparkline({ series, rising }) {
  const xs = (series ?? []).map((v) => Number(v) || 0);
  if (xs.length < 2) return null;
  const w = 72, h = 22, max = Math.max(...xs, 1);
  const pts = xs.map((v, i) => `${(i / (xs.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      <polyline points={pts} fill="none" stroke={rising ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IdeaList({ icon: Icon, label, ideas }) {
  if (!ideas?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
        <Icon size={12} /> {label}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {ideas.map((it, i) => (
          <li key={`${i}-${it.name}`} style={{ padding: '8px 10px', background: 'var(--surface-soft)', borderRadius: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{it.name}</div>
            <div className="text-secondary" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.45 }}>{it.why}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrendRow({ item, open, onToggle }) {
  const rising = item.change_pct == null || item.change_pct >= 0;
  const change = item.change_pct == null ? '새로 떠오름' : `${item.change_pct >= 0 ? '+' : ''}${item.change_pct}%`;
  return (
    <li style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}
      >
        <span className="num text-muted" style={{ width: 16, fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{item.rank}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800 }}>{item.keyword}</span>
            <span className="num" style={{ fontSize: 12, fontWeight: 700, color: rising ? 'var(--accent-strong)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {rising ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{change}
            </span>
          </span>
          {item.headline && <span className="text-secondary" style={{ display: 'block', fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.headline}</span>}
        </span>
        <Sparkline series={item.series} rising={rising} />
        <ChevronDown size={16} className="text-muted" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ paddingBottom: 12, paddingLeft: 26 }}>
          <div className="text-muted" style={{ fontSize: 11, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>최근 4주 검색 {change}</span>
            {item.blog_posts != null && <span>블로그 {fmtCount(item.blog_posts)}건</span>}
            {item.internal && <span style={{ color: 'var(--accent-strong)', fontWeight: 600 }}>우리 매장: {item.internal}</span>}
          </div>
          <IdeaList icon={Coffee} label="카페 메뉴 후보" ideas={item.cafe} />
          <IdeaList icon={Wine} label="바 메뉴 후보" ideas={item.bar} />
          {!item.cafe?.length && !item.bar?.length && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>메뉴 후보는 다음 갱신 때 생성됩니다.</div>
          )}
        </div>
      )}
    </li>
  );
}

/** 홈 "이번 주 트렌드 픽" — 네이버 검색 추이 + 매장 레시피 기반 메뉴 개발 후보 */
export default function TrendPicksCard({ workplaceId }) {
  const [result, setResult] = useState({ key: null, data: null, error: null });
  const [openRank, setOpenRank] = useState(1);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('home:trendCardOpen') === '0'; } catch { return false; }
  });

  useEffect(() => {
    if (!workplaceId) return undefined;
    let alive = true;
    getTrendPicks({ workplaceId })
      .then((data) => { if (alive) setResult({ key: workplaceId, data, error: null }); })
      .catch((e) => { if (!alive) return; console.error('getTrendPicks', e); setResult({ key: workplaceId, data: null, error: 'fail' }); });
    return () => { alive = false; };
  }, [workplaceId]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('home:trendCardOpen', next ? '0' : '1'); } catch { /* 무시 */ }
  }

  const loading = result.key !== workplaceId;
  const data = loading ? null : result.data;
  const items = data?.items ?? [];
  if (!loading && (!data || items.length === 0)) return null;

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        role="button" tabIndex={0} aria-expanded={!collapsed}
        onClick={toggleCollapsed}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed(); } }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer' }}
      >
        <Sparkles size={18} color="var(--accent-strong)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h3">이번 주 트렌드 픽{data ? <span className="text-muted" style={{ fontSize: 12, fontWeight: 600, marginLeft: 8 }}>{fmtWeek(data.week_start)}</span> : null}</div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>네이버 검색 추이로 고른 제철·유행 키워드와 우리 레시피로 만들 수 있는 메뉴 후보</div>
        </div>
        <ChevronDown size={18} className="text-muted" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)', flexShrink: 0 }} />
      </div>

      {!collapsed && (
        <div style={{ padding: '0 16px 12px' }}>
          {loading ? (
            <div className="stack stack-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}</div>
          ) : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {items.map((it) => (
                <TrendRow key={it.keyword} item={it} open={openRank === it.rank} onToggle={() => setOpenRank((r) => (r === it.rank ? null : it.rank))} />
              ))}
            </ol>
          )}
          <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
            매주 화요일 새벽 갱신 · 검색량은 관심의 지표이지 판매 보장이 아니에요. 후보는 검토용입니다.
          </div>
        </div>
      )}
    </section>
  );
}
