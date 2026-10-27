'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { ChevronLeft, Shield, BarChart3, AlertTriangle, Info, Megaphone } from 'lucide-react';
import { getAdDashboard } from './actions';

// 광고 모니터링 팀이 매일 마감 후 올리는 데이터(ad_dashboard.data)를 ERP 스타일로 그린다.
// 채널 색은 ERP 팔레트 안에서 고정 — 메타 파랑, 구글 주황, 네이버 초록, 당근 노랑.
const CH = [
  { k: 'meta', label: '메타', color: '#3182f6', inL: '프로필 방문' },
  { k: 'google', label: '구글', color: '#f97316', inL: '클릭' },
  { k: 'naver', label: '네이버', color: '#00a67e', inL: '클릭' },
  { k: 'karrot', label: '당근', color: '#f59e0b', inL: '클릭' },
];
const BY = Object.fromEntries(CH.map((c) => [c.k, c]));

const RANGES = [
  { key: 'yesterday', label: '어제' },
  { key: 'week', label: '이번 주' },
  { key: 'lastWeek', label: '지난 주' },
  { key: 'month', label: '이번 달' },
  { key: 'lastMonth', label: '지난 달' },
  { key: 'd30', label: '최근 30일' },
];

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function monday(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
// 광고는 어제까지 마감되므로 모든 기간의 끝은 어제(또는 마감일 중 이른 쪽)
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
const won = (n) => `${formatCurrency(Math.round(n))}원`;
const num = (n) => formatCurrency(Math.round(n));
const sum = (arr, k, f) => arr.reduce((a, x) => a + ((x[k] && x[k][f]) || 0), 0);
const all = (arr, f) => CH.reduce((a, c) => a + sum(arr, c.k, f), 0);

function Delta({ cur, prev }) {
  if (!prev) return <span className="text-muted" style={{ fontSize: 11 }}>직전 기간 없음</span>;
  const p = ((cur - prev) / prev) * 100;
  return <span className="num" style={{ fontSize: 11, color: 'var(--text-muted)' }}>직전 기간 대비 {p >= 0 ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%</span>;
}

function Dot({ color }) { return <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: color, flexShrink: 0 }} />; }

function Pill({ kind, children }) {
  const cls = kind === 'on' ? 'tag-success' : kind === 'lim' ? 'tag-warning' : 'tag-danger';
  return <span className={`tag ${cls}`} style={{ fontSize: 11 }}>{children}</span>;
}

export default function AdsPage() {
  const router = useRouter();
  const { profile, memberships } = useApp();
  const [state, setState] = useState({ loading: true });
  const [range, setRange] = useState('week');
  const [team, setTeam] = useState('');

  const isOwner = profile?.is_super_admin === true || profile?.is_executive === true || memberships.some((m) => m.role === 'owner');

  useEffect(() => {
    if (!isOwner) return;
    let alive = true;
    getAdDashboard().then((r) => { if (alive) setState({ loading: false, ...r }); });
    return () => { alive = false; };
  }, [isOwner]);

  const D = state.data;
  const view = useMemo(() => {
    if (!D) return null;
    const { from, to } = rangeDates(range, D.closed);
    const cur = D.days.filter((x) => x.d >= from && x.d <= to);
    const len = cur.length;
    const idx = D.days.findIndex((x) => x.d === from);
    const prev = idx > 0 && len ? D.days.slice(Math.max(0, idx - len), idx) : [];
    const hasPrev = prev.length === len && len > 0;
    const chartDays = D.days.slice(-Math.max(len, 14));
    return { from, to, cur, prev, hasPrev, chartDays };
  }, [D, range]);

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

  const header = (
    <PageHeader
      title="광고 현황"
      subtitle={D ? `${md(D.closed)} (${wd(D.closed)}) 마감 · 갱신 ${formatDateTime(state.updated)}` : '네이버 · 메타 · 구글 · 당근'}
      hideSwitcher
      action={<button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>}
    />
  );

  if (state.loading || !state.ok || !D) {
    return (
      <>
        {header}
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon">{state.loading ? <BarChart3 size={26} /> : <Shield size={26} />}</div>
            <div className="empty-title">{state.loading ? '불러오는 중…' : state.ok ? '아직 올라온 마감이 없어요' : state.forbidden ? '접근 권한 없음' : '불러오지 못했어요'}</div>
            <div className="empty-desc">{state.loading ? '' : state.ok ? '광고 모니터링 일 마감이 돌면 여기에 표시됩니다.' : state.error}</div>
          </div>
        </main>
      </>
    );
  }

  const { from, to, cur, prev, hasPrev, chartDays } = view;
  const cost = all(cur, 'cost'), imp = all(cur, 'imp'), inn = all(cur, 'in');
  const cpi = inn ? cost / inn : 0;
  const pCost = all(prev, 'cost'), pImp = all(prev, 'imp'), pIn = all(prev, 'in'), pCpi = pIn ? pCost / pIn : 0;
  const maxBar = Math.max(1, ...chartDays.map((x) => all([x], 'cost')));
  const gapDays = (d) => d ? Math.round((new Date(D.closed) - new Date(d)) / 864e5) : null;
  const adState = (a) => {
    const g = gapDays(a.lastSpend);
    if (/일시중지|중지|꺼짐/.test(a.status)) return ['off', '일시중지'];
    if (/기간종료/.test(a.status)) return ['off', '기간 종료'];
    if (/승인 대기/.test(a.status)) return ['lim', '승인 대기'];
    if (g === null) return ['off', '집행 기록 없음'];
    if (g <= 1) return [/제한|제약/.test(a.status) ? 'lim' : 'on', /제한|제약/.test(a.status) ? '운영 중 · 예산 제약' : '운영 중'];
    return ['off', `${g}일째 지출 없음`];
  };
  const agg = (key, inF) => {
    const m = {};
    cur.forEach((x) => ((x[key] && x[key].c) || []).forEach((c) => { const o = (m[c.name] = m[c.name] || { cost: 0, imp: 0, inn: 0 }); o.cost += c.cost; o.imp += c.imp; o.inn += c[inF] || 0; }));
    return Object.entries(m).sort((a, b) => b[1].cost - a[1].cost);
  };
  const comments = (D.comments || []).filter((c) => !team || c.team === team);
  const byDate = {}; comments.forEach((c) => (byDate[c.date] = byDate[c.date] || []).push(c));
  const th = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
  const td = { fontSize: 13, padding: '8px 8px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
  const left = { textAlign: 'left' };
  const periodLabel = from === to ? `${md(from)} (${wd(from)})` : `${md(from)} ~ ${md(to)} · ${cur.length}일`;

  return (
    <>
      {header}
      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 경고 */}
        {(D.alerts || []).length > 0 && (
          <section className="stack stack-2">
            {D.alerts.map((a, i) => (
              <div key={i} className="card dense" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `4px solid ${a.level === 'critical' ? 'var(--danger)' : a.level === 'warning' ? '#f59e0b' : 'var(--accent)'}` }}>
                <span style={{ color: a.level === 'critical' ? 'var(--danger)' : a.level === 'warning' ? '#c2410c' : 'var(--accent)', flexShrink: 0, marginTop: 1 }}>{a.level === 'info' ? <Info size={16} /> : <AlertTriangle size={16} />}</span>
                <div style={{ fontSize: 13, minWidth: 0 }}>
                  <strong>{a.ch}</strong> · {a.text} {a.at && <span className="text-muted" style={{ fontSize: 11 }}>({a.at} 확인)</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* 기간 */}
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{periodLabel}</div>
          <div className="segment" style={{ overflowX: 'auto', maxWidth: '100%' }}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" className={`segment-item ${range === r.key ? 'is-active' : ''}`} onClick={() => setRange(r.key)} style={{ padding: '7px 12px' }}>{r.label}</button>
            ))}
          </div>
        </section>

        {/* 합계 */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {[['광고비', won(cost), cost, pCost], ['노출', num(imp), imp, pImp], ['유입', num(inn), inn, pIn], ['유입당 비용', won(cpi), cpi, pCpi]].map(([l, v, c, p]) => (
            <div key={l} className="bento">
              <div className="bento-label text-secondary">{l}</div>
              <div className="bento-value sm num">{v}</div>
              <div className="bento-sub"><Delta cur={c} prev={hasPrev ? p : 0} /></div>
            </div>
          ))}
        </section>

        {/* 채널별 */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {CH.map((c) => { const cc = sum(cur, c.k, 'cost'), ci = sum(cur, c.k, 'in'); return (
            <div key={c.k} className="card compact" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}><Dot color={c.color} /> {c.label}</div>
              <div className="num" style={{ fontSize: 20, fontWeight: 800 }}>{won(cc)}</div>
              <div className="text-muted num" style={{ fontSize: 12 }}>노출 {num(sum(cur, c.k, 'imp'))} · {c.inL} {num(ci)} · {c.inL}당 {ci ? won(cc / ci) : '—'}</div>
            </div>
          ); })}
        </section>

        {/* 일별 광고비 */}
        <section className="card compact">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>일별 광고비</div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>{CH.map((c) => <span key={c.k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot color={c.color} />{c.label}</span>)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
            {chartDays.map((x) => { const t = all([x], 'cost'); return (
              <div key={x.d} title={`${md(x.d)} ${won(t)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 0 }}>
                {[...CH].reverse().map((c) => { const v = (x[c.k] && x[c.k].cost) || 0; return v > 0 ? <div key={c.k} style={{ height: `${(v / maxBar) * 100}%`, background: c.color, marginTop: 1, borderRadius: 2 }} /> : null; })}
              </div>
            ); })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            <span>{md(chartDays[0].d)}</span><span>{md(chartDays[chartDays.length - 1].d)}</span>
          </div>
        </section>

        {/* 집행 중인 광고 */}
        <section className="card compact">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>집행 중인 광고</div>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>네 채널의 모든 캠페인. 최근 7일 합계와 마지막으로 돈이 나간 날짜.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={{ ...th, ...left }}>채널</th><th style={{ ...th, ...left }}>캠페인</th><th style={{ ...th, ...left }}>상태</th><th style={th}>일예산</th><th style={th}>7일 광고비</th><th style={th}>7일 유입</th><th style={th}>유입당</th><th style={th}>마지막 지출</th></tr></thead>
              <tbody>{(D.ads || []).map((a, i) => { const [k, t] = adState(a); const c = BY[a.ch]; return (
                <tr key={i}>
                  <td style={{ ...td, ...left }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={c.color} />{c.label}</span></td>
                  <td style={{ ...td, ...left, whiteSpace: 'normal', minWidth: 140 }}>{a.name}<div className="text-muted" style={{ fontSize: 11 }}>{a.type}</div></td>
                  <td style={{ ...td, ...left }}><Pill kind={k}>{t}</Pill></td>
                  <td style={td} className="num">{a.budget ? won(a.budget) : '—'}</td>
                  <td style={td} className="num">{won(a.cost)}</td>
                  <td style={td} className="num">{num(a.in)}</td>
                  <td style={td} className="num">{a.in ? won(a.cost / a.in) : '—'}</td>
                  <td style={td} className="num">{a.lastSpend ? `${md(a.lastSpend)} (${wd(a.lastSpend)})` : '—'}</td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        </section>

        {/* 충전 현황 */}
        <section className="card compact">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>충전 현황</div>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>잔액을 최근 7일 평균 지출로 나눈 남은 일수. 5일 아래면 위 경고에 뜹니다.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={{ ...th, ...left }}>채널</th><th style={{ ...th, ...left }}>방식</th><th style={th}>잔액 / 남은 한도</th><th style={th}>7일 평균</th><th style={th}>남은 일수</th><th style={th}>소진 예상</th><th style={{ ...th, ...left }}>비고</th></tr></thead>
              <tbody>{(D.funding || []).map((f) => { const c = BY[f.ch]; const until = f.daysLeft !== null ? ymd(addDays(new Date(D.closed + 'T00:00:00'), f.daysLeft)) : null; return (
                <tr key={f.ch}>
                  <td style={{ ...td, ...left }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Dot color={c.color} />{c.label}</span></td>
                  <td style={{ ...td, ...left }}>{f.kind}</td>
                  <td style={td} className="num">{f.balance === null ? '—' : won(f.balance)}</td>
                  <td style={td} className="num">{won(f.avg)}</td>
                  <td style={td}>{f.daysLeft === null ? '—' : <Pill kind={f.daysLeft < 5 ? 'off' : f.daysLeft < 10 ? 'lim' : 'on'}>{f.daysLeft}일</Pill>}</td>
                  <td style={td} className="num">{until ? `${md(until)} (${wd(until)})` : '—'}</td>
                  <td style={{ ...td, ...left, whiteSpace: 'normal', minWidth: 160 }}>{f.note} <span className="text-muted" style={{ fontSize: 11 }}>{f.checked} 확인</span></td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        </section>

        {/* 일 마감표 */}
        <section className="card compact">
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>일 마감표</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr><th style={{ ...th, ...left }}>날짜</th>{CH.map((c) => <th key={c.k} style={th} colSpan={2}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Dot color={c.color} />{c.label}</span></th>)}<th style={th} colSpan={2}>합계</th></tr>
                <tr><th style={th} /> {CH.map((c) => [<th key={c.k + 'a'} style={th}>광고비</th>, <th key={c.k + 'b'} style={th}>{c.inL}</th>])}<th style={th}>광고비</th><th style={th}>유입</th></tr></thead>
              <tbody>{[...cur].reverse().map((x) => (
                <tr key={x.d}>
                  <td style={{ ...td, ...left }} className="num">{md(x.d)} ({wd(x.d)})</td>
                  {CH.map((c) => x[c.k] ? [<td key={c.k + 'a'} style={td} className="num">{won(x[c.k].cost)}</td>, <td key={c.k + 'b'} style={td} className="num">{num(x[c.k].in)}</td>] : [<td key={c.k + 'a'} style={td}>—</td>, <td key={c.k + 'b'} style={td}>—</td>])}
                  <td style={td} className="num"><strong>{won(all([x], 'cost'))}</strong></td><td style={td} className="num">{num(all([x], 'in'))}</td>
                </tr>
              ))}
              <tr><td style={{ ...td, ...left, fontWeight: 700 }}>합계</td>{CH.map((c) => [<td key={c.k + 'a'} style={{ ...td, fontWeight: 700 }} className="num">{won(sum(cur, c.k, 'cost'))}</td>, <td key={c.k + 'b'} style={{ ...td, fontWeight: 700 }} className="num">{num(sum(cur, c.k, 'in'))}</td>])}<td style={{ ...td, fontWeight: 700 }} className="num">{won(cost)}</td><td style={{ ...td, fontWeight: 700 }} className="num">{num(inn)}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 팀 의견 */}
        <section className="card compact">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>팀 의견</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {['', '종합', ...CH.map((c) => c.label)].map((t) => <button key={t} type="button" className={`tag ${team === t ? 'tag-accent' : ''}`} onClick={() => setTeam(t)}>{t || '전체'}</button>)}
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 10 }}>마감마다 채널 담당 팀이 남기는 관찰과 제안. 다음 집행을 정할 때 참고용이며, 실제 변경은 대표가 결정합니다.</div>
          {comments.length === 0 ? <div className="text-muted" style={{ fontSize: 13 }}>아직 남긴 의견이 없습니다.</div> : Object.keys(byDate).sort().reverse().map((d) => (
            <div key={d} style={{ marginBottom: 12 }}>
              <div className="text-muted num" style={{ fontSize: 12, marginBottom: 6 }}>{d} ({wd(d)})</div>
              <div className="stack stack-2">{byDate[d].map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, padding: '10px 12px', borderRadius: 10, background: 'var(--surface-soft)', fontSize: 13 }}>
                  <span style={{ fontWeight: 700, color: BY[{ 메타: 'meta', 구글: 'google', 네이버: 'naver', 당근: 'karrot' }[c.team]]?.color || 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{c.team}</span>
                  <p style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{c.text}</p>
                </div>
              ))}</div>
            </div>
          ))}
        </section>

        {/* 캠페인·소재 */}
        {[
          ['메타 캠페인', '프로필 방문', agg('meta', 'results')],
          ['구글 캠페인', '클릭', agg('google', 'clicks')],
          ['당근 캠페인', '클릭', agg('karrot', 'clicks')],
          ['네이버 플레이스 소재 (최근 7일)', '클릭', (D.naver?.ads || []).filter((a) => a.imp).sort((a, b) => b.cost - a.cost).map((a) => [a.name, { cost: a.cost, imp: a.imp, inn: a.clicks }])],
        ].map(([title, inL, list]) => (
          <section key={title} className="card compact">
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{title} <span className="text-muted" style={{ fontSize: 11, fontWeight: 500 }}>{title.includes('네이버') ? '' : periodLabel}</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead><tr><th style={{ ...th, ...left }}>이름</th><th style={th}>광고비</th><th style={th}>노출</th><th style={th}>{inL}</th><th style={th}>{inL}당</th></tr></thead>
                <tbody>{list.length === 0 ? <tr><td style={{ ...td, ...left }} colSpan={5} className="text-muted">이 기간에 집행된 항목이 없습니다.</td></tr> : list.map(([n, o]) => (
                  <tr key={n}><td style={{ ...td, ...left, whiteSpace: 'normal', minWidth: 160 }}>{n}</td><td style={td} className="num">{won(o.cost)}</td><td style={td} className="num">{num(o.imp)}</td><td style={td} className="num">{num(o.inn)}</td><td style={td} className="num">{o.inn ? won(o.cost / o.inn) : '—'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ))}

        <div className="text-muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Megaphone size={12} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>매일 아침 전날 마감 기준으로 갱신됩니다 (실시간 아님). 네이버는 검색광고 API, 당근은 당근 광고 MCP, 메타·구글은 광고 관리자 화면에서 읽은 값입니다. 녹턴만 집행 중이며 나울은 광고를 하지 않습니다.</span>
        </div>
      </main>
    </>
  );
}
