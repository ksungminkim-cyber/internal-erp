'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { calcLabor } from '@/lib/laborCalc';
import { staffByDateHour, buildStaffing, shiftsToLogs, monthSalesForecast, groupRecs, coveredDates } from '@/lib/staffing';
import { getStaffingData } from '@/lib/reads';
import { ChevronLeft, ChevronRight, Shield, Users, CalendarRange } from 'lucide-react';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월 → 일
const WEEKS_PER_MONTH = 52 / 12;
const MIN_WEEKS = 3; // 근무표가 있는 주가 이보다 적으면 진단하지 않는다
const LIST_LIMIT = 5; // 조정 제안은 종류별로 이만큼만 먼저 보여준다
const TEXT = { over: '#00876c', under: '#c2410c', danger: '#c52f3e' }; // 옅은 배경 위에서 읽히는 글자색

const pct = (r) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const man = (n) => `${formatCurrency(Math.round(n / 10000))}만원`;
const staffTxt = (n) => { const v = Math.round(n * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const md = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

// 요일 묶음을 짧게: 매일·평일·주말, 사흘 이상 이어지면 "월~목"
function daysLabel(days) {
  const pos = DOW_ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  const k = pos.join('');
  if (k === '0123456') return '매일';
  if (k === '01234') return '평일';
  if (k === '56') return '주말';
  const name = (i) => DOW[DOW_ORDER[i]];
  const runs = [];
  for (const i of pos) { const last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); }
  return runs.map(([a, b]) => (a === b ? name(a) : b - a >= 2 ? `${name(a)}~${name(b)}` : `${name(a)}·${name(b)}`)).join('·');
}

function Step({ label, value, color, sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="text-secondary" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div className="num stf-big" style={{ color }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 12, fontWeight: 700, color }}>{sub}</div>}
    </div>
  );
}

// 조정 제안 한 묶음 (줄이기 / 보강). 금액은 월 기준
function RecGroup({ kind, title, groups, expanded }) {
  const color = TEXT[kind];
  const sign = kind === 'over' ? '−' : '+';
  const monthly = (g) => man(Math.abs(g.weeklyDelta) * WEEKS_PER_MONTH);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, paddingBottom: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: 3, background: color }} aria-hidden="true" />
        <span style={{ flex: 1 }}>{title}</span>
        <span className="num" style={{ color }}>월 {sign}{man(groups.reduce((t, g) => t + Math.abs(g.weeklyDelta), 0) * WEEKS_PER_MONTH)}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {(expanded ? groups : groups.slice(0, LIST_LIMIT)).map((g) => (
          <li key={`${g.days.join('')}|${g.fromHour}|${g.to}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '9px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <strong style={{ minWidth: 44 }}>{daysLabel(g.days)}</strong>
            <span className="num" style={{ flex: 1 }}>{g.fromHour}~{g.toHour}시</span>
            <span className="text-muted" style={{ fontSize: 12 }}>{g.to}명으로</span>
            <span className="num" style={{ minWidth: 62, textAlign: 'right', fontWeight: 700, color }}>{sign}{monthly(g)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 한 사람의 시프트 묶음 → 주휴·야간·연장 포함 인건비 (브라우저 = KST 기준)
function laborOf(shifts, wageOf, premiums) {
  const byUser = new Map();
  for (const s of shifts) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }
  let total = 0, base = 0;
  for (const [uid, list] of byUser) {
    const r = calcLabor(shiftsToLogs(list), wageOf(uid), { premiums });
    total += r.totalLabor; base += r.baseCost;
  }
  return { total, base };
}

export default function StaffingPage() {
  const router = useRouter();
  const { profile, memberships, currentWorkplaceId } = useApp();
  // 본사 소속(임원·super_admin 포함)만 — 시급·인건비가 드러나는 화면
  const canView = profile?.is_super_admin === true || profile?.is_executive === true || memberships.some((m) => m.workplaces?.name === '본사');
  const stores = useMemo(() => memberships.filter((m) => m.workplaces?.name && m.workplaces.name !== '본사').map((m) => ({ id: m.workplace_id, name: m.workplaces.name })), [memberships]);
  const [picked, setPicked] = useState(null);
  const wpId = picked ?? (stores.some((s) => s.id === currentWorkplaceId) ? currentWorkplaceId : stores[0]?.id ?? null);
  const [res, setRes] = useState({ key: null, data: null, error: null });
  const [sel, setSel] = useState(null); // 선택한 칸 'dow|hour'
  const [expanded, setExpanded] = useState(false); // 조정 제안 전체 보기

  useEffect(() => {
    if (!canView || !wpId) return undefined;
    let alive = true;
    getStaffingData({ workplaceId: wpId })
      .then((d) => { if (alive) setRes({ key: wpId, data: d?.ok ? d : null, error: d?.ok ? null : (d?.error || '불러오지 못했어요.') }); })
      .catch((e) => { if (alive) setRes({ key: wpId, data: null, error: String(e?.message || e) }); });
    return () => { alive = false; };
  }, [canView, wpId]);

  const loading = res.key !== wpId;
  const D = loading ? null : res.data;

  const calc = useMemo(() => {
    if (!D) return null;
    const wageOf = (u) => D.wages[u] ?? 0;
    const premiums = !D.premiumExempt;
    const demand = new Map(D.demand.map(([d, h, sales, orders, items]) => [`${d}|${h}`, { sales, orders, items }]));
    const allPeriodShifts = D.shifts.filter((s) => s.start_at >= D.periodFrom && s.start_at < D.periodTo && s.status !== 'cancelled');
    // 근무표가 들어 있는 주만 분석 (빈 주가 섞이면 "0명 배치"로 평균돼 왜곡됨)
    const cover = coveredDates(D.dates, allPeriodShifts);
    if (cover.weeksCovered < MIN_WEEKS) return { insufficient: true, cover };
    const used = new Set(cover.dates);
    const kstKey = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    const periodShifts = allPeriodShifts.filter((s) => used.has(kstKey(s.start_at)));
    const pl = laborOf(periodShifts, wageOf, premiums);
    const loadFactor = pl.base > 0 ? pl.total / pl.base : 1; // 기본급 → 주휴·가산 포함 배수
    const r = buildStaffing({ demand, staff: staffByDateHour(periodShifts, wageOf), dates: cover.dates, rules: D.rules, loadFactor });

    // 이번 달·다음 달 예상: 근무표가 들어와 있으면 그 근무표로, 없으면 최근 패턴 그대로 간다고 가정
    const now = new Date();
    const months = [0, 1].map((off) => {
      const first = new Date(now.getFullYear(), now.getMonth() + off, 1), next = new Date(now.getFullYear(), now.getMonth() + off + 1, 1);
      const days = Math.round((next - first) / 86400e3);
      const ms = D.shifts.filter((s) => { const t = new Date(s.start_at); return t >= first && t < next && s.status !== 'cancelled'; });
      const sales = monthSalesForecast(r.byDow, first.getFullYear(), first.getMonth());
      const scheduled = ms.length > 0;
      const labor = scheduled ? laborOf(ms, wageOf, premiums).total : r.summary.weeklyLabor * (days / 7);
      const trimmed = labor - r.summary.weeklySaving * (days / 7);
      return { label: `${first.getMonth() + 1}월`, scheduled, shiftCount: ms.length, sales, labor, ratio: sales > 0 ? labor / sales : null, trimmed, trimmedRatio: sales > 0 ? trimmed / sales : null };
    });
    return { r, loadFactor, months, cover };
  }, [D]);

  const back = <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로"><ChevronLeft size={20} /></button>;
  if (!canView) {
    return (<><PageHeader title="인력 배치" hideSwitcher action={back} /><main className="page-main"><div className="card empty"><div className="empty-icon"><Shield size={26} /></div><div className="empty-title">접근 권한 없음</div><div className="empty-desc">인력 배치 진단은 본사만 볼 수 있습니다.</div></div></main></>);
  }

  const r = calc?.r;
  const S = r?.summary;
  const hours = r ? [...new Set(r.slots.map((s) => s.hour))].sort((a, b) => a - b) : [];
  const slotOf = (dow, hour) => r?.slots.find((s) => s.dow === dow && s.hour === hour);
  const groups = r ? groupRecs(r.recs) : [];
  const overs = groups.filter((g) => g.kind === 'over'), unders = groups.filter((g) => g.kind === 'under');
  const hiddenCount = Math.max(0, overs.length - LIST_LIMIT) + Math.max(0, unders.length - LIST_LIMIT);
  const selSlot = sel ? slotOf(Number(sel.split('|')[0]), Number(sel.split('|')[1])) : null;
  const target = S ? `${Math.round(S.targetRatio * 1000) / 10}%` : '';
  const barMax = r ? Math.max(0.5, ...r.byDow.map((x) => x.ratio ?? 0)) : 0.5; // 요일별 막대의 오른쪽 끝

  return (
    <>
      <PageHeader title="인력 배치" subtitle="매출 대비 근무 인원 진단 · 본사 전용" hideSwitcher action={back} />
      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div className="segment">
            {stores.map((s) => <button key={s.id} type="button" className={`segment-item ${wpId === s.id ? 'is-active' : ''}`} onClick={() => { setPicked(s.id); setSel(null); setExpanded(false); }}>{s.name}</button>)}
          </div>
          {D && <span className="text-muted" style={{ fontSize: 12 }}>최근 {D.dates.length / 7}주 · {md(D.dates[0])}~{md(D.dates[D.dates.length - 1])}{calc && !calc.insufficient && calc.cover.weeksCovered < calc.cover.weeksTotal ? ` 중 근무표 있는 ${calc.cover.weeksCovered}주` : ''}</span>}
        </div>

        {loading && <div className="skeleton" style={{ height: 320 }} />}
        {!loading && res.error && <div className="card" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', boxShadow: 'none', fontSize: 13 }}>{res.error}</div>}
        {!loading && D && calc.insufficient && (
          <div className="card empty">
            <div className="empty-icon"><CalendarRange size={26} /></div>
            <div className="empty-title">근무표가 부족해 진단할 수 없어요</div>
            <div className="empty-desc">
              최근 {calc.cover.weeksTotal}주 중 {D.workplaceName} 시프트가 들어 있는 주가 {calc.cover.weeksCovered}주뿐이에요{calc.cover.lastShiftDate ? ` (마지막 시프트 ${md(calc.cover.lastShiftDate)})` : ''}.
              Counter 시프트에 근무표를 {MIN_WEEKS}주 이상 넣으면 인건비율과 권장 인원이 계산됩니다. 매출 주문 {formatCurrency(D.orderCount)}건은 확인됐어요.
            </div>
          </div>
        )}

        {!loading && D && !calc.insufficient && (
          <>
            {/* 요약: 지금 → 줄이면 → 목표 */}
            <section className="card">
              <div className="stf-flow">
                <Step label="지금 인건비율" value={pct(S.ratio)} color={S.ratio > S.targetRatio ? TEXT.danger : 'var(--text)'} />
                {S.weeklySaving > 0 && (
                  <>
                    <ChevronRight size={18} className="stf-flow-arrow" aria-hidden="true" />
                    <Step label="겹침 줄이면" value={pct(S.ratioIfTrimmed)} color={TEXT.over} sub={`월 −${man(S.weeklySaving * WEEKS_PER_MONTH)}`} />
                  </>
                )}
                <ChevronRight size={18} className="stf-flow-arrow" aria-hidden="true" />
                <Step label="목표" value={target} color="var(--text-muted)" />
              </div>
              <p style={{ fontSize: 13, marginTop: 14, fontWeight: 600 }}>
                {S.ratio <= S.targetRatio ? '지금 목표 안이에요.'
                  : S.ratioIfTrimmed <= S.targetRatio ? '겹치는 시간만 줄여도 목표 안으로 들어와요.'
                  : `겹치는 시간을 다 줄여도 목표까지 ${((S.ratioIfTrimmed - S.targetRatio) * 100).toFixed(1)}%p 남아요.`}
              </p>
              <p className="text-muted num" style={{ fontSize: 12, marginTop: 2 }}>
                주 평균 매출 {man(S.weeklySales)} · 인건비 {man(S.weeklyLabor)} (주휴{D.premiumExempt ? '' : '·야간'} 포함){S.weeklyAdd > 0 ? ` · 붐비는 시간까지 보강하면 ${pct(S.ratioIfApplied)}` : ''}
              </p>
            </section>

            <div className="stf-cols">
              {/* 한 주 시간표 */}
              <section className="card">
                <h2 className="h3">한 주 시간표</h2>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>숫자는 권장 인원. 색이 있는 칸만 지금 근무표와 달라요.</p>
                <div className="stf-grid" style={{ marginTop: 12 }}>
                  <div />
                  {DOW_ORDER.map((d) => <div key={d} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, paddingBottom: 2, color: d === 0 ? TEXT.danger : d === 6 ? 'var(--accent)' : 'var(--text-secondary)' }}>{DOW[d]}</div>)}
                  {hours.map((h) => (
                    <div key={h} style={{ display: 'contents' }}>
                      {h === D.rules.barStartHour && (
                        <div className="text-muted" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, margin: '6px 0 2px' }}>
                          바 시간<span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        </div>
                      )}
                      <div className="num text-muted" style={{ textAlign: 'right', paddingRight: 4, fontSize: 11, alignSelf: 'center' }}>{h}시</div>
                      {DOW_ORDER.map((d) => {
                        const s = slotOf(d, h);
                        const k = `${d}|${h}`;
                        if (!s) return <div key={k} className="stf-cell is-off" aria-label={`${DOW[d]} ${h}시 영업 없음`} />;
                        return (
                          <button key={k} type="button" onClick={() => setSel(sel === k ? null : k)}
                            className={`stf-cell num is-${s.kind}${sel === k ? ' is-sel' : ''}`}
                            aria-label={`${DOW[d]} ${h}시 지금 ${staffTxt(s.avgStaff)}명 권장 ${s.rec}명`}>
                            {s.rec}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 12, minHeight: 38 }}>
                  {selSlot ? (
                    <div style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-soft)', lineHeight: 1.6 }}>
                      <strong>{DOW[selSlot.dow]} {selSlot.hour}시</strong> · 지금 평균 {staffTxt(selSlot.avgStaff)}명 → 권장 {selSlot.rec}명<br />
                      <span className="text-secondary num">주문 평균 {staffTxt(selSlot.avgItems)}잔(바쁜 주 {staffTxt(selSlot.p75Items)}잔) · 1명이 시간당 {staffTxt(r.capacity[selSlot.daypart])}잔까지 · 매출 {man(selSlot.avgSales)}</span>
                    </div>
                  ) : (
                    <div className="text-secondary" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px' }}>
                      <span><span className="stf-swatch" style={{ background: 'var(--success-soft)' }} />줄일 수 있음</span>
                      <span><span className="stf-swatch" style={{ background: 'var(--warning-soft)' }} />붐빔 · 보강 검토</span>
                      <span className="text-muted">칸을 누르면 근거가 보여요</span>
                    </div>
                  )}
                </div>
              </section>

              {/* 조정 제안 */}
              <section className="card">
                <h2 className="h3">조정 제안</h2>
                {groups.length === 0 && <p style={{ fontSize: 13, marginTop: 10 }}>지금 근무표가 주문량과 잘 맞아요. 조정할 곳이 없습니다.</p>}
                {overs.length > 0 && <RecGroup kind="over" title="줄일 수 있는 시간" groups={overs} expanded={expanded} />}
                {unders.length > 0 && <RecGroup kind="under" title="붐비는 시간 · 보강 검토" groups={unders} expanded={expanded} />}
                {hiddenCount > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 6 }} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
                    {expanded ? '접기' : `${hiddenCount}곳 더 보기`}
                  </button>
                )}
              </section>
            </div>

            <div className="stf-cols">
              {/* 요일별 */}
              <section className="card">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <h2 className="h3">요일별 인건비율</h2>
                  <span className="text-muted" style={{ fontSize: 12 }}>세로선 = 목표 {target}</span>
                </div>
                <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 12 }}>
                  {DOW_ORDER.map((d) => {
                    const x = r.byDow[d];
                    const ratio = x.ratio ?? 0;
                    const over = ratio > S.targetRatio;
                    const w = (v) => `${(v / barMax) * 100}%`;
                    return (
                      <li key={d} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr) auto 48px', alignItems: 'center', gap: 10, fontSize: 13 }}>
                        <span style={{ fontWeight: 700 }}>{DOW[d]}</span>
                        <div style={{ position: 'relative', height: 10, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden' }} aria-hidden="true">
                          <div style={{ position: 'absolute', inset: '0 auto 0 0', width: w(Math.min(ratio, S.targetRatio)), background: 'var(--border-strong)' }} />
                          {over && <div style={{ position: 'absolute', top: 0, bottom: 0, left: w(S.targetRatio), width: w(ratio - S.targetRatio), background: 'var(--danger)' }} />}
                          <div style={{ position: 'absolute', top: 0, bottom: 0, left: w(S.targetRatio), width: 2, marginLeft: -1, background: 'var(--text)' }} />
                        </div>
                        <span className="text-muted num" style={{ fontSize: 11 }}>매출 {man(x.sales)}</span>
                        <span className="num" style={{ fontWeight: 800, textAlign: 'right', color: over ? TEXT.danger : 'var(--text)' }}>{pct(x.ratio)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* 예상 인건비 */}
              <section className="card">
                <h2 className="h3">예상 인건비</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
                  {calc.months.map((m) => (
                    <div key={m.label} style={{ padding: 14, borderRadius: 12, background: 'var(--surface-soft)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{m.label}</strong>
                        <span className="tag" style={{ fontSize: 10, background: 'var(--surface)' }}>{m.scheduled ? '근무표 기준' : '최근 패턴 가정'}</span>
                      </div>
                      <div className="num" style={{ fontSize: 24, fontWeight: 800, marginTop: 6, color: m.ratio != null && m.ratio > S.targetRatio ? TEXT.danger : 'var(--text)' }}>{pct(m.ratio)}</div>
                      <div className="text-secondary num" style={{ fontSize: 12, lineHeight: 1.6 }}>인건비 {man(m.labor)}<br />매출 {man(m.sales)}</div>
                      {S.weeklySaving > 0 && <div className="num" style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: TEXT.over }}>겹침 줄이면 {pct(m.trimmedRatio)}</div>}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <details className="stf-details">
              <summary>계산 방식과 한계</summary>
              <ul>
                <li>주문량은 토스 주문의 잔 수예요. 바 테이블은 주문을 연 시각부터 결제할 때까지 고르게 나눠 셉니다.</li>
                <li>1명 처리량은 바빴던 시간대(상위 10%)의 1인당 주문량이에요. 낮 {staffTxt(r.capacity.day)}잔, 바 {staffTxt(r.capacity.bar)}잔/시간.</li>
                <li>권장 인원은 바쁜 주 주문량 ÷ 1명 처리량(올림). 최소 낮 {D.rules.dayFloor}명·바 {D.rules.barFloor}명, 평소 세우는 최대 인원 이내입니다.</li>
                <li>인건비는 근무표 × 시급에 주휴{D.premiumExempt ? '' : '·야간·연장'}을 더한 추정치(기본급의 {calc.loadFactor.toFixed(2)}배)라 실제 급여와 다를 수 있어요.</li>
                <li>예상 매출은 요일별 평균 × 그 달의 요일 수. 근무표를 넣거나 고치면 다시 계산됩니다.</li>
                <li>청소·준비처럼 주문에 안 잡히는 일과 방문객 수는 반영되지 않았어요. 최종 판단은 현장 사정과 함께 해 주세요.</li>
              </ul>
            </details>
          </>
        )}
        {!loading && !D && !res.error && stores.length === 0 && <div className="card empty"><div className="empty-icon"><Users size={26} /></div><div className="empty-title">매장이 없어요</div></div>}
      </main>
    </>
  );
}
