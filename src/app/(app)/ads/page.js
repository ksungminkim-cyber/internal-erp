'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { ymd } from '@/lib/date';
import { ChevronLeft, ChevronDown, Shield, BarChart3, AlertTriangle, RefreshCw, FlaskConical, ExternalLink, Check } from 'lucide-react';
import { getAdDashboard, getAdLive, runAdAction, getAdActions } from './actions';
import { buildInsights, bucketize, stats } from '@/lib/adsInsights';

// 광고 현황 — 한 화면: 기간 선택 → 합계 한 줄 → 채널 카드 4개(잔액 포함, 누르면 그 채널의 캠페인·소재·해석·버튼) → 추이(차트/일/주/월) → 할 일.
// 오늘은 광고 API 실시간(5분 캐시), 어제 이전은 매일 09:30 마감 데이터(ad_dashboard.data).
const CH = [
  { k: 'naver', label: '네이버', color: '#00a67e', inL: '클릭' },
  { k: 'google', label: '구글', color: '#f97316', inL: '클릭' },
  { k: 'meta', label: '메타', color: '#3182f6', inL: '프로필 방문' },
  { k: 'karrot', label: '당근', color: '#f59e0b', inL: '클릭' },
];
const BY = Object.fromEntries(CH.map((c) => [c.k, c]));
const TEAM_KEY = { 메타: 'meta', 구글: 'google', 네이버: 'naver', 당근: 'karrot' };
const RANGES = [
  { key: 'today', label: '오늘' }, { key: 'yesterday', label: '어제' }, { key: 'week', label: '이번 주' }, { key: 'lastWeek', label: '지난 주' },
  { key: 'month', label: '이번 달' }, { key: 'lastMonth', label: '지난 달' }, { key: 'd30', label: '30일' },
];
const LIVE_EVERY_MS = 5 * 60 * 1000;
const TREND = [{ key: 'chart', label: '차트' }, { key: 'day', label: '일', limit: 14 }, { key: 'week', label: '주', limit: 8 }, { key: 'month', label: '월', limit: 6 }];
const LEVEL = { bad: ['tag-danger', '문제'], warn: ['tag-warning', '주의'], good: ['tag-success', '좋음'], info: ['', '참고'] };

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function monday(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
// 마감 데이터는 어제까지이므로 모든 기간의 끝은 어제(또는 마감일 중 이른 쪽)
function rangeDates(key, closed) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yday = addDays(today, -1);
  const end = (d) => (ymd(d) > closed ? closed : ymd(d));
  switch (key) {
    case 'yesterday': return { from: end(yday), to: end(yday) };
    case 'week': return { from: ymd(monday(today)), to: end(yday) };
    case 'lastWeek': { const mon = addDays(monday(today), -7); return { from: ymd(mon), to: end(addDays(mon, 6)) }; }
    case 'month': return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: end(yday) };
    case 'lastMonth': { const f = new Date(today.getFullYear(), today.getMonth() - 1, 1); const l = new Date(today.getFullYear(), today.getMonth(), 0); return { from: ymd(f), to: end(l) }; }
    default: return { from: ymd(addDays(yday, -29)), to: end(yday) };
  }
}
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8)}`;
const wd = (d) => '일월화수목금토'[new Date(d + 'T00:00:00').getDay()];
const hm = (iso) => { const t = new Date(iso); return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`; };
const won = (n) => `${formatCurrency(Math.round(n))}원`;
const num = (n) => formatCurrency(Math.round(n));
const sum = (arr, k, f) => arr.reduce((a, x) => a + ((x[k] && x[k][f]) || 0), 0);
const all = (arr, f) => CH.reduce((a, c) => a + sum(arr, c.k, f), 0);
const liveDay = (L) => L ? { d: L.d, naver: L.naver, google: L.google, meta: L.meta, karrot: L.karrot, live: true } : null;
const fkey = (f) => `${f.ch}|${f.title}`;
const opKey = (f, o) => `${fkey(f)}|${o.label}`;

function Delta({ cur, prev }) {
  if (!prev) return null;
  const p = ((cur - prev) / prev) * 100;
  return <span className="num" style={{ fontSize: 11, color: p >= 0 ? '#c2410c' : '#15803d' }}>{p >= 0 ? '▲' : '▼'} {Math.abs(p).toFixed(0)}%</span>;
}
function Dot({ color }) { return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />; }
function Pill({ kind, children }) {
  const cls = kind === 'on' ? 'tag-success' : kind === 'lim' ? 'tag-warning' : kind === 'off' ? 'tag-danger' : '';
  return <span className={`tag ${cls}`} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{children}</span>;
}
const th = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const td = { fontSize: 13, padding: '7px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const left = { textAlign: 'left' };
const Lbl = ({ children }) => <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{children}</span>;

// 해석 한 줄: 배지 + 제목 + 버튼. 펼치면 뜻 · 할 일 · A/B 테스트
function InsightRow({ f, n, runs, onRun }) {
  const ops = f.ops || [];
  return (
    <details style={{ borderRadius: 10, border: '1px solid var(--border)', padding: '7px 10px' }}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 13 }}>
        {n && <span className="num text-muted" style={{ fontSize: 12, width: 14 }}>{n}</span>}
        <span className={`tag ${LEVEL[f.level][0]}`} style={{ fontSize: 10 }}>{LEVEL[f.level][1]}</span>
        {n && <span style={{ fontWeight: 700, color: BY[TEAM_KEY[f.ch]]?.color || 'var(--text-secondary)' }}>{f.ch}</span>}
        <span style={{ flex: 1, minWidth: 160 }}>{n ? f.action : f.title}</span>
        {ops.length > 0 && <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ops.map((o) => { const r = runs[opKey(f, o)] || {}; return (
            <button key={o.label} type="button" className={`btn ${o.kind === 'link' ? 'btn-ghost' : 'btn-primary'}`} disabled={r.busy || r.ok} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRun(f, o); }} style={{ fontSize: 12, padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {r.ok ? <Check size={12} /> : o.kind === 'link' ? <ExternalLink size={12} /> : null}{r.busy ? '적용 중…' : o.label}
            </button>
          ); })}
        </span>}
      </summary>
      {ops.map((o) => { const r = runs[opKey(f, o)]; return r && !r.busy ? <div key={o.label} style={{ fontSize: 12, marginTop: 6, color: r.ok ? '#15803d' : 'var(--danger)' }}>{r.ok ? '적용됨' : '실패'} · {r.msg}</div> : null; })}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', fontSize: 13, marginTop: 8 }}>
        {n && <><Lbl>근거</Lbl><span>{f.title}</span></>}
        {f.meaning && <><Lbl>뜻</Lbl><span className="text-secondary">{f.meaning}</span></>}
        {f.action && !n && <><Lbl>할 일</Lbl><span>{f.action}</span></>}
        {f.test && <><Lbl><FlaskConical size={11} style={{ verticalAlign: -1 }} /> A/B</Lbl><span style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 12 }}><Lbl>비교</Lbl><span>{f.test.what}</span><Lbl>방법</Lbl><span>{f.test.how}</span><Lbl>판정</Lbl><span>{f.test.judge}</span></span></>}
      </div>
    </details>
  );
}

function Table({ cols, rows, empty }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr>{cols.map((c, i) => <th key={i} style={{ ...th, ...(c.left ? left : {}) }}>{c.h}</th>)}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td style={{ ...td, ...left }} colSpan={cols.length} className="text-muted">{empty}</td></tr> : rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} style={{ ...td, ...(cols[j].left ? { ...left, whiteSpace: 'normal', minWidth: 140 } : {}) }} className="num">{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function AdsPage() {
  const router = useRouter();
  const { profile, memberships } = useApp();
  const [state, setState] = useState({ loading: true });
  const [live, setLive] = useState({ loading: true });
  const [range, setRange] = useState('today');
  const [open, setOpen] = useState(null); // 펼친 채널
  const [hover, setHover] = useState(null);
  const [tick, setTick] = useState(0);
  const [trend, setTrend] = useState('chart');
  const [trendCh, setTrendCh] = useState('all');
  const [runs, setRuns] = useState({}); // 버튼 키 → { busy, ok, msg }
  const [actLog, setActLog] = useState([]);

  const isOwner = profile?.is_super_admin === true || profile?.is_executive === true || memberships.some((m) => m.role === 'owner');

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    getAdDashboard().then((r) => { if (alive) setState({ loading: false, ...r }); });
    getAdActions().then((r) => { if (alive && r.ok) setActLog(r.actions); });
    return () => { alive = false; };
  }, [isOwner]);

  // 오늘 실시간: 들어올 때 + 5분마다 + 새로고침 버튼
  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    getAdLive().then((r) => { if (alive) setLive({ loading: false, ...r }); });
    const id = setInterval(() => setTick((t) => t + 1), LIVE_EVERY_MS);
    return () => { alive = false; clearInterval(id); };
  }, [isOwner, tick]);

  const D = state.data;
  const L = live.live;
  const view = useMemo(() => {
    if (!D) return null;
    if (range === 'today') {
      const day = liveDay(L);
      if (!day) return null;
      return { from: day.d, to: day.d, cur: [day], prev: D.days.slice(-1), hasPrev: true, chartDays: [...D.days.slice(-13), day], deltaLabel: '어제 대비' };
    }
    const { from, to } = rangeDates(range, D.closed);
    const cur = D.days.filter((x) => x.d >= from && x.d <= to);
    const len = cur.length;
    const idx = D.days.findIndex((x) => x.d === from);
    const prev = idx > 0 && len ? D.days.slice(Math.max(0, idx - len), idx) : [];
    const hist = D.days.slice(-Math.max(len, 13));
    return { from, to, cur, prev, hasPrev: prev.length === len && len > 0, chartDays: L ? [...hist, liveDay(L)] : hist, deltaLabel: '직전 기간 대비' };
  }, [D, L, range]);

  if (!isOwner) {
    return (<><PageHeader title="광고 현황" hideSwitcher /><main className="page-main"><div className="card empty"><div className="empty-icon"><Shield size={26} /></div><div className="empty-title">접근 권한 없음</div><div className="empty-desc">대표만 이용 가능</div></div></main></>);
  }
  const header = (
    <PageHeader title="광고 현황" subtitle={L ? `실시간 ${hm(L.asOf)} · 마감 ${D ? `${md(D.closed)} (${wd(D.closed)})` : '—'}` : '네이버 · 구글 · 메타 · 당근'} hideSwitcher
      action={<button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>} />
  );
  if (state.loading || !state.ok || !D) {
    return (<>{header}<main className="page-main"><div className="card empty"><div className="empty-icon">{state.loading ? <BarChart3 size={26} /> : <Shield size={26} />}</div><div className="empty-title">{state.loading ? '불러오는 중…' : state.ok ? '아직 올라온 마감이 없어요' : state.forbidden ? '접근 권한 없음' : '불러오지 못했어요'}</div><div className="empty-desc">{state.loading ? '' : state.ok ? '광고 모니터링 일 마감이 돌면 여기에 표시됩니다.' : state.error}</div></div></main></>);
  }

  const rangeBar = (
    <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div className="segment" style={{ overflowX: 'auto', maxWidth: '100%' }}>
        {RANGES.map((r) => <button key={r.key} type="button" className={`segment-item ${range === r.key ? 'is-active' : ''}`} onClick={() => setRange(r.key)} style={{ padding: '6px 11px' }}>{r.label}</button>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }} className="text-muted">
        {view && (view.from === view.to ? `${md(view.from)} (${wd(view.from)})` : `${md(view.from)}~${md(view.to)} · ${view.cur.length}일`)}
        {range === 'today' && <span className="tag tag-accent" style={{ fontSize: 10 }}>실시간 {L ? hm(L.asOf) : ''}</span>}
        <button type="button" className="btn btn-ghost btn-icon" title="실시간 새로고침" onClick={() => { setLive((s) => ({ ...s, loading: true })); setTick((t) => t + 1); }} style={{ opacity: live.loading ? 0.5 : 1 }}><RefreshCw size={15} /></button>
      </div>
    </section>
  );
  if (!view) {
    return (<>{header}<main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{rangeBar}<div className="card empty"><div className="empty-icon">{live.loading ? <BarChart3 size={26} /> : <AlertTriangle size={26} />}</div><div className="empty-title">{live.loading ? '광고 API에서 오늘 수치를 받는 중…' : '오늘 수치를 받지 못했어요'}</div><div className="empty-desc">{live.loading ? '' : live.error}</div></div></main></>);
  }

  const { from, to, cur, prev, hasPrev, chartDays, deltaLabel } = view;
  const liveErrors = (L && L.errors) || {};
  const cost = all(cur, 'cost'), imp = all(cur, 'imp'), inn = all(cur, 'in');
  const pCost = all(prev, 'cost'), pImp = all(prev, 'imp'), pIn = all(prev, 'in');
  const periodLabel = from === to ? `${md(from)} (${wd(from)})` : `${md(from)}~${md(to)}`;
  const liveCamp = {}; // 캠페인 이름 → 오늘 광고비
  if (L) CH.forEach((c) => ((L[c.k] && L[c.k].c) || []).forEach((x) => { liveCamp[x.name] = (liveCamp[x.name] || 0) + x.cost; }));
  const gapDays = (d) => d ? Math.round((new Date(D.closed) - new Date(d)) / 864e5) : null;
  const adState = (a) => {
    if (liveCamp[a.name] > 0) return ['on', '오늘 집행 중'];
    if (/일시중지|중지|꺼짐/.test(a.status)) return ['off', '일시중지'];
    if (/기간종료/.test(a.status)) return ['off', '기간 종료'];
    if (/승인 대기/.test(a.status)) return ['lim', '승인 대기'];
    const g = gapDays(a.lastSpend);
    if (g === null) return ['off', '집행 기록 없음'];
    if (g <= 1) return [/제한|제약/.test(a.status) ? 'lim' : 'on', /제한|제약/.test(a.status) ? '예산 제약' : '운영 중'];
    return ['off', `${g}일째 0원`];
  };
  // 채널 잔액: 네이버는 실시간 비즈머니, 나머지는 마감 때 읽은 값
  const funding = (k) => {
    const f = (D.funding || []).find((x) => x.ch === k) || {};
    const liveBal = k === 'naver' && L && L.naver && L.naver.bal !== null && L.naver.bal !== undefined ? L.naver.bal : null;
    const bal = liveBal ?? f.balance ?? null;
    const days = bal !== null && f.avg ? bal / f.avg : f.daysLeft ?? null;
    return { kind: f.kind || (k === 'meta' ? '후불 (카드)' : '—'), bal, days, live: liveBal !== null, note: f.note, checked: f.checked };
  };
  const chStatus = (k) => { // 채널 상태 한 단어
    const mine = (D.ads || []).filter((a) => a.ch === k && !/기간종료|일시중지/.test(a.status));
    if (L && L[k] && L[k].cost > 0) return ['on', '집행 중'];
    if (!mine.length) return ['off', '광고 없음'];
    const g = Math.min(...mine.map((a) => gapDays(a.lastSpend) ?? 99));
    return g <= 1 ? ['lim', '오늘 0원'] : ['off', `${g}일째 0원`];
  };

  // 해석: 이 기간을 "평소"(기간 직전 마감 28일)와 비교
  const baseEnd = range === 'today' ? D.days.length : D.days.findIndex((x) => x.d === from);
  const base = baseEnd > 0 ? D.days.slice(Math.max(0, baseEnd - 28), baseEnd) : [];
  const { findings, plan } = buildInsights({ cur, prev, base, D, isToday: range === 'today' });
  const runOp = async (f, o) => {
    if (o.kind === 'link') { window.open(o.url, '_blank', 'noopener'); return; }
    if (!window.confirm(`${o.confirm}\n\n지금 바로 적용됩니다. 진행할까요?`)) return;
    const k = opKey(f, o);
    setRuns((r) => ({ ...r, [k]: { busy: true } }));
    const res = await runAdAction({ ch: f.ch, kind: o.kind, label: o.label, args: o.args });
    setRuns((r) => ({ ...r, [k]: { busy: false, ok: res.ok, msg: res.ok ? res.result : res.error } }));
    getAdActions().then((r) => { if (r.ok) setActLog(r.actions); });
  };

  // 추이: 마감 일자 + 오늘(실시간)을 일·주·월로
  const T = TREND.find((t) => t.key === trend);
  const buckets = trend === 'chart' ? [] : bucketize(L ? [...D.days, liveDay(L)] : D.days, trend, { limit: T.limit });
  const bStats = (b) => trendCh === 'all' ? CH.reduce((a, c) => { const s = stats(b.days, c.k); a.cost += s.cost; a.imp += s.imp; a.inn += s.inn; return a; }, { cost: 0, imp: 0, inn: 0 }) : stats(b.days, trendCh);
  const bLabel = (b) => trend === 'day' ? `${md(b.from)} (${wd(b.from)})` : trend === 'week' ? `${md(b.from)}~${md(b.to)}` : `${+b.key.slice(5)}월`;
  const maxBar = Math.max(1, ...chartDays.map((x) => all([x], 'cost')));
  const hovered = hover ? chartDays.find((x) => x.d === hover) : null;

  // 채널 상세 (카드를 누르면)
  const agg = (key, inF) => {
    const m = {};
    cur.forEach((x) => ((x[key] && x[key].c) || []).forEach((c) => { const o = (m[c.name] = m[c.name] || { cost: 0, imp: 0, inn: 0 }); o.cost += c.cost; o.imp += c.imp; o.inn += c[inF] || 0; }));
    return m;
  };
  const detail = (c) => {
    const ads = (D.ads || []).filter((a) => a.ch === c.k).sort((a, b) => (liveCamp[b.name] || 0) - (liveCamp[a.name] || 0) || b.cost - a.cost);
    const per = agg(c.k, c.k === 'meta' ? 'results' : 'clicks');
    const fs = findings.filter((f) => f.ch === c.label);
    const cm = (D.comments || []).filter((x) => x.team === c.label).slice(-2).reverse();
    const f = funding(c.k);
    return (
      <div className="card compact" style={{ borderTop: `3px solid ${c.color}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>캠페인 <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>· {periodLabel} 광고비·{c.inL}, 상태·일예산은 마감 기준</span></div>
          <Table cols={[{ h: '캠페인', left: true }, { h: '상태', left: true }, { h: '오늘' }, { h: '일예산' }, { h: `${periodLabel} 광고비` }, { h: c.inL }, { h: `${c.inL}당` }, { h: '마지막 지출' }]}
            rows={ads.map((a) => { const [k, t] = adState(a); const p = per[a.name] || { cost: 0, inn: 0 }; const tc = liveCamp[a.name]; return [
              <span key="n">{a.name}<div className="text-muted" style={{ fontSize: 11 }}>{a.type}</div></span>, <Pill key="s" kind={k}>{t}</Pill>, tc ? <strong key="t">{won(tc)}</strong> : '—', a.budget ? won(a.budget) : '—', won(p.cost), num(p.inn), p.inn ? won(p.cost / p.inn) : '—', tc ? '오늘' : a.lastSpend ? `${md(a.lastSpend)} (${wd(a.lastSpend)})` : '—'];
            })} empty="캠페인이 없습니다." />
        </div>
        {c.k === 'naver' && (D.naver?.ads || []).length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>소재 <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>· 최근 7일, 마감 기준. 노출이 고르니 클릭률로 비교</span></div>
            <Table cols={[{ h: '소재', left: true }, { h: '광고비' }, { h: '노출' }, { h: '클릭' }, { h: '클릭률' }, { h: '클릭당' }, { h: '상태 (실시간)', left: true }]}
              rows={[...D.naver.ads].filter((a) => a.imp).sort((a, b) => b.clicks / b.imp - a.clicks / a.imp).map((a) => {
                const lv = ((L && L.naver && L.naver.ads) || []).find((x) => x.name === a.name); // 실시간 on/off
                const pf = { ch: '네이버', title: `소재 ${a.name}` };
                const o = lv ? { kind: 'naver.adLock', label: lv.off ? '켜기' : '끄기', args: { name: a.name, lock: !lv.off }, confirm: `네이버 플레이스 소재 「${a.name}」를 ${lv.off ? '켭니다' : '끕니다'}.` } : null;
                const r = o ? runs[opKey(pf, o)] || {} : {};
                return [a.name, won(a.cost), num(a.imp), num(a.clicks), `${((a.clicks / a.imp) * 100).toFixed(1)}%`, a.clicks ? won(a.cost / a.clicks) : '—',
                  <span key="s" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{lv ? <Pill kind={lv.off ? 'off' : 'on'}>{lv.off ? '꺼짐' : '노출 중'}</Pill> : <span className="text-muted">—</span>}
                    {o && <button type="button" className="btn btn-ghost" disabled={r.busy} onClick={() => runOp(pf, o)} style={{ fontSize: 11, padding: '2px 8px' }}>{r.busy ? '적용 중…' : o.label}</button>}
                    {r.msg && !r.busy && <span style={{ fontSize: 11, color: r.ok ? '#15803d' : 'var(--danger)' }}>{r.ok ? '적용됨' : r.msg}</span>}</span>];
              })} empty="" />
          </div>
        )}
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>해석 <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>· {periodLabel}를 평소(직전 {base.length}일 평균)와 비교. 줄을 누르면 뜻·A/B 테스트</span></div>
          {fs.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>특이사항 없음</div> : <div className="stack stack-2">{fs.map((f) => <InsightRow key={fkey(f)} f={f} runs={runs} onRun={runOp} />)}</div>}
        </div>
        {(f.note || cm.length > 0) && (
          <div style={{ fontSize: 12 }} className="text-secondary">
            {f.note && <div>잔액 메모: {f.note} <span className="text-muted">({md(f.checked)})</span></div>}
            {cm.map((x, i) => <div key={i} style={{ marginTop: 4 }}><span className="text-muted">{md(x.date)} 팀 의견</span> · {x.text}</div>)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {header}
      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rangeBar}

        {/* 합계 한 줄 */}
        <section className="card compact" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[['광고비', won(cost), cost, pCost], ['노출', num(imp), imp, pImp], ['유입', num(inn), inn, pIn], ['유입당', inn ? won(cost / inn) : '—', inn ? cost / inn : 0, pIn ? pCost / pIn : 0]].map(([l, v, c, p]) => (
            <div key={l} style={{ minWidth: 0 }}>
              <div className="text-muted" style={{ fontSize: 11 }}>{l}</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap' }}>{v}</div>
              <div style={{ minHeight: 14 }}>{hasPrev && <Delta cur={c} prev={p} />} {hasPrev && p ? <span className="text-muted" style={{ fontSize: 10 }}>{deltaLabel}</span> : null}</div>
            </div>
          ))}
        </section>

        {/* 채널 카드 */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
          {CH.map((c) => {
            const cc = sum(cur, c.k, 'cost'), ci = sum(cur, c.k, 'in'), pc = sum(prev, c.k, 'cost');
            const noLive = range === 'today' && !cur[0][c.k];
            const f = funding(c.k);
            const [sk, st] = chStatus(c.k);
            const balKind = f.days === null ? '' : f.days < 5 ? 'off' : f.days < 10 ? 'lim' : 'on';
            const isOpen = open === c.k;
            return (
              <button key={c.k} type="button" onClick={() => setOpen(isOpen ? null : c.k)} className="card compact" style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `3px solid ${c.color}`, outline: isOpen ? `2px solid ${c.color}` : 'none', font: 'inherit', color: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={c.color} />{c.label}</span>
                  <Pill kind={sk}>{st}</Pill>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num" style={{ fontSize: 20, fontWeight: 800 }}>{noLive ? '—' : won(cc)}</span>
                  {!noLive && hasPrev && <Delta cur={cc} prev={pc} />}
                  {!noLive && cost > 0 && <span className="text-muted num" style={{ fontSize: 11 }}>{Math.round((cc / cost) * 100)}%</span>}
                </div>
                <div className="text-muted num" style={{ fontSize: 12 }}>
                  {noLive ? `조회 실패: ${liveErrors[c.k] || '알 수 없음'}` : <>노출 {num(sum(cur, c.k, 'imp'))} · {c.inL} {num(ci)} · {ci ? won(cc / ci) : '—'}</>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, fontSize: 12, marginTop: 2 }}>
                  <span className="num">{f.bal === null ? <span className="text-muted">{f.kind === '후불 (카드)' ? '후불 · 집행분 카드 청구' : `잔액 확인 불가`}</span> : <>잔액 <strong>{won(f.bal)}</strong>{!f.live && f.checked && <span className="text-muted"> ({md(f.checked)})</span>}</>}</span>
                  {f.days !== null && <Pill kind={balKind}>{f.days < 1 ? '소진' : `${Math.round(f.days)}일 남음`}</Pill>}
                </div>
                <div className="text-muted" style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><ChevronDown size={12} style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }} />{isOpen ? '닫기' : '캠페인 · 소재 · 해석'}</div>
              </button>
            );
          })}
        </section>
        {open && detail(BY[open])}

        {/* 추이 */}
        <section className="card compact">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>추이</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {trend !== 'chart' && <div style={{ display: 'flex', gap: 4 }}>{[['all', '합계'], ...CH.map((c) => [c.k, c.label])].map(([k, l]) => <button key={k} type="button" className={`tag ${trendCh === k ? 'tag-accent' : ''}`} onClick={() => setTrendCh(k)}>{l}</button>)}</div>}
              <div className="segment">{TREND.map((t) => <button key={t.key} type="button" className={`segment-item ${trend === t.key ? 'is-active' : ''}`} onClick={() => setTrend(t.key)} style={{ padding: '4px 10px' }}>{t.label}</button>)}</div>
            </div>
          </div>
          {trend === 'chart' ? (
            <>
              <div style={{ minHeight: 20, marginBottom: 6, fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline' }}>
                {hovered ? <><strong className="num">{md(hovered.d)} ({wd(hovered.d)}){hovered.live ? ' 오늘' : ''}</strong><strong className="num">{won(all([hovered], 'cost'))}</strong>{CH.map((c) => hovered[c.k] ? <span key={c.k} className="num text-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Dot color={c.color} />{won(hovered[c.k].cost)}</span> : null)}</>
                  : <span className="text-muted">일별 광고비. 막대에 올리면 그날 채널별 금액. 마지막 막대는 오늘.</span>}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 11 }} className="text-muted">{CH.map((c) => <span key={c.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Dot color={c.color} />{c.label}</span>)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }} onMouseLeave={() => setHover(null)}>
                {chartDays.map((x) => { const t = all([x], 'cost'); const active = hover === x.d; return (
                  <div key={x.d} onMouseEnter={() => setHover(x.d)} onClick={() => setHover(active ? null : x.d)} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 0, cursor: 'pointer', opacity: hover && !active ? 0.45 : 1, outline: x.live ? '1px dashed var(--accent)' : 'none', outlineOffset: 1, borderRadius: 3 }}>
                    {t === 0 && <div style={{ height: 2, background: 'var(--border)' }} />}
                    {[...CH].reverse().map((c) => { const v = (x[c.k] && x[c.k].cost) || 0; return v > 0 ? <div key={c.k} style={{ height: `${(v / maxBar) * 100}%`, background: c.color, marginTop: 1, borderRadius: 2 }} /> : null; })}
                  </div>
                ); })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}><span>{md(chartDays[0].d)}</span><span>최고 {won(maxBar)}</span><span>오늘</span></div>
            </>
          ) : (
            <Table cols={[{ h: '기간', left: true }, { h: '광고비' }, { h: '노출' }, { h: trendCh === 'all' ? '유입' : BY[trendCh].inL }, { h: '클릭률' }, { h: '유입당' }, { h: '변화' }]}
              rows={[...buckets].reverse().map((b, i, arr) => { const s = bStats(b); const p = arr[i + 1] ? bStats(arr[i + 1]) : null; return [
                <span key="l">{bLabel(b)}{(b.live || b.partial) && <span className="tag tag-accent" style={{ fontSize: 10, marginLeft: 6 }}>{b.live ? '진행 중' : `${b.days.length}일`}</span>}</span>, <strong key="c">{won(s.cost)}</strong>, num(s.imp), num(s.inn), s.imp ? `${((s.inn / s.imp) * 100).toFixed(1)}%` : '—', s.inn ? won(s.cost / s.inn) : '—', <Delta key="d" cur={s.cost} prev={p && !b.partial && !b.live ? p.cost : 0} />];
              })} empty="" />
          )}
        </section>

        {/* 할 일 */}
        <section className="card compact">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>할 일 <span className="text-muted" style={{ fontWeight: 400, fontSize: 11 }}>· {periodLabel} 기준, 우선순위순. 파란 버튼은 광고 설정을 바로 바꾸고(확인창 뒤), 「열기」는 광고 관리자로</span></div>
            {actLog.length > 0 && <details><summary className="text-muted" style={{ fontSize: 11, cursor: 'pointer' }}>실행 기록 {actLog.length}</summary><div className="stack stack-2" style={{ marginTop: 6, fontSize: 12 }}>{actLog.map((x) => <div key={x.id}><span className="text-muted num">{md(ymd(new Date(x.at)))} {hm(x.at)}</span> <span className={`tag ${x.ok ? 'tag-success' : 'tag-danger'}`} style={{ fontSize: 10 }}>{x.ok ? '성공' : '실패'}</span> {x.ch} · {x.label} — {x.result}</div>)}</div></details>}
          </div>
          {plan.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>지금 손볼 일이 없습니다.</div> : <div className="stack stack-2">{plan.map((f, i) => <InsightRow key={fkey(f)} f={f} n={i + 1} runs={runs} onRun={runOp} />)}</div>}
        </section>

        <div className="text-muted" style={{ fontSize: 11 }}>오늘은 네 채널 광고 API 실시간(5분 갱신), 어제 이전은 매일 09:30 마감값. 네이버 잔액은 실시간, 나머지 잔액은 마감 때 읽은 값. 메타는 10/27 개설한 녹턴 광고 계정 기준.</div>
      </main>
    </>
  );
}
