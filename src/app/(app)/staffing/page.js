'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { calcLabor } from '@/lib/laborCalc';
import { staffByDateHour, buildStaffing, shiftsToLogs, monthSalesForecast, groupRecs, coveredDates } from '@/lib/staffing';
import { getStaffingData } from '@/lib/reads';
import { ChevronLeft, Shield, Users, TrendingDown, TrendingUp, CalendarRange, Info } from 'lucide-react';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월 → 일
const WEEKS_PER_MONTH = 52 / 12;
const MIN_WEEKS = 3; // 근무표가 있는 주가 이보다 적으면 진단하지 않는다

const pct = (r) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const man = (n) => `${formatCurrency(Math.round(n / 10000))}만원`;
const staffTxt = (n) => { const v = Math.round(n * 10) / 10; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
const md = (key) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;

function daysLabel(days) {
  const set = new Set(days);
  const has = (arr) => arr.length === set.size && arr.every((d) => set.has(d));
  if (has([0, 1, 2, 3, 4, 5, 6])) return '매일';
  if (has([1, 2, 3, 4, 5])) return '평일';
  if (has([0, 6])) return '주말';
  return DOW_ORDER.filter((d) => set.has(d)).map((d) => DOW[d]).join('·');
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
  const maxItems = r ? Math.max(1, ...r.slots.map((s) => s.p75Items)) : 1;
  const groups = r ? groupRecs(r.recs) : [];
  const overs = groups.filter((g) => g.kind === 'over'), unders = groups.filter((g) => g.kind === 'under');
  const selSlot = sel ? slotOf(Number(sel.split('|')[0]), Number(sel.split('|')[1])) : null;
  const overTarget = S && S.ratio != null && S.ratio > S.targetRatio;

  return (
    <>
      <PageHeader title="인력 배치" subtitle="매출 대비 근무 인원 진단 · 본사 전용" hideSwitcher action={back} />
      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div className="segment">
            {stores.map((s) => <button key={s.id} type="button" className={`segment-item ${wpId === s.id ? 'is-active' : ''}`} onClick={() => { setPicked(s.id); setSel(null); }}>{s.name}</button>)}
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
            {/* 요약 */}
            <section className="card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div className="text-secondary" style={{ fontSize: 13, fontWeight: 700 }}>인건비율</div>
                <div className="num" style={{ fontSize: 32, fontWeight: 800, color: overTarget ? 'var(--danger)' : 'var(--text)' }}>{pct(S.ratio)}</div>
                <span className="tag" style={{ fontSize: 11 }}>목표 {pct(S.targetRatio)}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                주 평균 매출 {man(S.weeklySales)} · 인건비 {man(S.weeklyLabor)} (주휴{D.premiumExempt ? '' : '·야간'} 포함, 근무표 기준)
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--success-soft)' }}>
                  <TrendingDown size={18} color="#00876c" />
                  <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                    <strong>겹치는 시간만 줄이면 {pct(S.ratioIfTrimmed)}</strong>
                    <div className="text-secondary" style={{ fontSize: 12 }}>주 {man(S.weeklySaving)} · 월 약 {man(S.weeklySaving * WEEKS_PER_MONTH)} 절감</div>
                  </div>
                </div>
                {S.weeklyAdd > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--surface-soft)' }}>
                    <TrendingUp size={18} color="var(--text-secondary)" />
                    <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                      <strong>붐비는 시간까지 보강하면 {pct(S.ratioIfApplied)}</strong>
                      <div className="text-secondary" style={{ fontSize: 12 }}>보강에 주 {man(S.weeklyAdd)} · 순 변화 월 약 {S.weeklyAdd - S.weeklySaving <= 0 ? '−' : '+'}{man(Math.abs(S.weeklyAdd - S.weeklySaving) * WEEKS_PER_MONTH)}</div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 조정 제안 */}
            <section className="card">
              <h2 className="h3">조정 제안</h2>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>평균 배치 인원과 권장 인원이 0.5명 이상 다른 시간대만 묶었어요.</p>
              {overs.length === 0 && unders.length === 0 && <p style={{ fontSize: 13, marginTop: 10 }}>지금 근무표가 수요와 잘 맞습니다. 조정할 곳이 없어요.</p>}
              {overs.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#00876c', marginBottom: 2 }}>줄일 수 있는 시간</div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {overs.map((g) => (
                      <li key={`o${g.days.join('')}${g.fromHour}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ flex: 1 }}><strong>{daysLabel(g.days)}</strong> {g.fromHour}~{g.toHour}시 → {g.to}명이면 충분</span>
                        <span className="num" style={{ fontWeight: 800, color: '#00876c', whiteSpace: 'nowrap' }}>월 −{man(-g.weeklyDelta * WEEKS_PER_MONTH)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {unders.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#c2410c', marginBottom: 2 }}>붐비는 시간 (보강 검토)</div>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {unders.map((g) => (
                      <li key={`u${g.days.join('')}${g.fromHour}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                        <span style={{ flex: 1 }}><strong>{daysLabel(g.days)}</strong> {g.fromHour}~{g.toHour}시 → {g.to}명 권장</span>
                        <span className="num text-secondary" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>월 +{man(g.weeklyDelta * WEEKS_PER_MONTH)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* 시간대 표 */}
            <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px 10px' }}>
                <h2 className="h3">요일·시간대별 인원</h2>
                <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>숫자는 권장 인원. 지금 배치와 다르면 &ldquo;지금→권장&rdquo;으로 표시해요. 아래 막대는 그 시간의 주문량.</p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '34px repeat(7, minmax(0, 1fr))', fontSize: 12 }}>
                <div />
                {DOW_ORDER.map((d) => <div key={d} style={{ textAlign: 'center', fontWeight: 700, padding: '6px 0', color: d === 0 ? 'var(--danger)' : d === 6 ? 'var(--accent)' : 'var(--text-secondary)' }}>{DOW[d]}</div>)}
                {hours.map((h) => (
                  <div key={h} style={{ display: 'contents' }}>
                    <div className="num text-muted" style={{ textAlign: 'right', padding: '8px 6px 0 0', fontSize: 11, borderTop: h === D.rules.barStartHour ? '2px solid var(--border-strong)' : '1px solid var(--border)' }}>{h}시</div>
                    {DOW_ORDER.map((d) => {
                      const s = slotOf(d, h);
                      const k = `${d}|${h}`;
                      const bg = !s ? 'var(--surface-soft)' : s.kind === 'over' ? 'var(--success-soft)' : s.kind === 'under' ? 'var(--warning-soft)' : 'transparent';
                      return (
                        <button key={k} type="button" disabled={!s} onClick={() => setSel(sel === k ? null : k)}
                          aria-label={s ? `${DOW[d]} ${h}시 현재 ${staffTxt(s.avgStaff)}명 권장 ${s.rec}명` : `${DOW[d]} ${h}시 영업 없음`}
                          style={{ border: 'none', borderTop: h === D.rules.barStartHour ? '2px solid var(--border-strong)' : '1px solid var(--border)', borderLeft: '1px solid var(--border)', background: bg, padding: '6px 2px 4px', cursor: s ? 'pointer' : 'default', outline: sel === k ? '2px solid var(--accent)' : 'none', outlineOffset: -2, font: 'inherit', color: 'inherit', minHeight: 36 }}>
                          {s && (
                            <>
                              <div className="num" style={{ fontWeight: s.kind === 'ok' ? 600 : 800, fontSize: 12, whiteSpace: 'nowrap', color: s.kind === 'over' ? '#00876c' : s.kind === 'under' ? '#c2410c' : 'var(--text)' }}>
                                {s.kind === 'ok' ? s.rec : `${staffTxt(s.avgStaff)}→${s.rec}`}
                              </div>
                              <div style={{ height: 3, borderRadius: 999, background: 'var(--surface-soft)', margin: '3px 4px 0', overflow: 'hidden' }} aria-hidden="true">
                                <div style={{ width: `${Math.round((s.p75Items / maxItems) * 100)}%`, height: '100%', background: 'var(--accent)', opacity: 0.55 }} />
                              </div>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ padding: '10px 16px 14px', fontSize: 12 }}>
                {selSlot ? (
                  <div style={{ lineHeight: 1.6 }}>
                    <strong>{DOW[selSlot.dow]} {selSlot.hour}시</strong> ({selSlot.daypart === 'bar' ? '바' : '낮'}) · 평균 배치 {staffTxt(selSlot.avgStaff)}명 → 권장 {selSlot.rec}명<br />
                    <span className="text-secondary">평균 매출 {formatCurrency(selSlot.avgSales)}원 · 주문량 평균 {staffTxt(selSlot.avgItems)}잔, 바쁜 주 {staffTxt(selSlot.p75Items)}잔 · 1명 처리량 {staffTxt(r.capacity[selSlot.daypart])}잔/시간</span>
                  </div>
                ) : (
                  <div className="text-muted" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--success-soft)', border: '1px solid #00876c', marginRight: 4, verticalAlign: -1 }} />줄일 수 있음</span>
                    <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--warning-soft)', border: '1px solid #c2410c', marginRight: 4, verticalAlign: -1 }} />붐빔</span>
                    <span>굵은 선 아래는 바 시간 · 칸을 누르면 근거가 보여요</span>
                  </div>
                )}
              </div>
            </section>

            {/* 요일별 */}
            <section className="card">
              <h2 className="h3">요일별 인건비율</h2>
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
                {DOW_ORDER.map((d) => {
                  const x = r.byDow[d];
                  const over = x.ratio != null && x.ratio > S.targetRatio;
                  const w = x.ratio == null ? 0 : Math.min(100, (x.ratio / 0.5) * 100); // 50% 를 막대 끝으로
                  return (
                    <li key={d} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{DOW[d]}</span>
                      <div>
                        <div style={{ position: 'relative', height: 8, borderRadius: 999, background: 'var(--surface-soft)' }}>
                          <div style={{ width: `${w}%`, height: '100%', borderRadius: 999, background: over ? 'var(--danger)' : 'var(--accent)' }} />
                          <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${(S.targetRatio / 0.5) * 100}%`, width: 2, background: 'var(--text-secondary)' }} title="목표" />
                        </div>
                        <div className="text-muted num" style={{ fontSize: 11, marginTop: 3 }}>하루 매출 {man(x.sales)} · 인건비 {man(x.laborCost)}</div>
                      </div>
                      <span className="num" style={{ fontWeight: 800, fontSize: 14, color: over ? 'var(--danger)' : 'var(--text)' }}>{pct(x.ratio)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* 예상 인건비 */}
            <section className="card">
              <h2 className="h3">예상 인건비</h2>
              <p className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>예상 매출은 요일별 평균 × 그 달의 요일 수. 근무표를 고치면 다시 계산됩니다.</p>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                {calc.months.map((m) => (
                  <div key={m.label} style={{ padding: 12, borderRadius: 12, background: 'var(--surface-soft)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <strong style={{ fontSize: 14 }}>{m.label}</strong>
                      <span className="tag" style={{ fontSize: 10 }}>{m.scheduled ? `입력된 근무표 ${m.shiftCount}건 기준` : '근무표 없음 — 최근 패턴 가정'}</span>
                      <span className="num" style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 16, color: m.ratio != null && m.ratio > S.targetRatio ? 'var(--danger)' : 'var(--text)' }}>{pct(m.ratio)}</span>
                    </div>
                    <div className="text-secondary num" style={{ fontSize: 12, marginTop: 4 }}>예상 매출 {man(m.sales)} · 예상 인건비 {man(m.labor)}</div>
                    {S.weeklySaving > 0 && <div className="num" style={{ fontSize: 12, marginTop: 2, color: '#00876c' }}>겹치는 시간을 줄이면 {man(m.trimmed)} ({pct(m.trimmedRatio)})</div>}
                  </div>
                ))}
              </div>
            </section>

            <section className="text-muted" style={{ fontSize: 11, lineHeight: 1.6, display: 'flex', gap: 6 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                계산 방식 — 주문량은 토스 주문의 품목 수량(잔 수)이고, 바 테이블은 주문을 연 시각부터 결제 시각까지 고르게 나눠 셉니다(결제 시각만 보면 초저녁이 비어 보이기 때문). 1명 처리량은 근무자가 있던 시간대의 1인당 주문량 중 상위 10% 값(낮 {staffTxt(r.capacity.day)}잔, 바 {staffTxt(r.capacity.bar)}잔/시간). 권장 인원 = 바쁜 주 주문량 ÷ 1명 처리량을 올림, 최소 낮 {D.rules.dayFloor}명·바 {D.rules.barFloor}명, 평소 세우는 최대 인원 이내. 인건비는 근무표 × 시급에 주휴{D.premiumExempt ? '' : '·야간·연장 가산'}을 더한 추정치(×{calc.loadFactor.toFixed(2)})이며 실제 급여와 다를 수 있습니다. 방문객 수는 데이터가 없어 주문량으로 대신합니다. 청소·준비처럼 주문에 안 잡히는 일은 반영되지 않으니 최종 판단은 현장 사정과 함께 해 주세요.
              </div>
            </section>
          </>
        )}
        {!loading && !D && !res.error && stores.length === 0 && <div className="card empty"><div className="empty-icon"><Users size={26} /></div><div className="empty-title">매장이 없어요</div></div>}
      </main>
    </>
  );
}
