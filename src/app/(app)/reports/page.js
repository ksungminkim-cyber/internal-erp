'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatCurrency } from '@/lib/format';
import { calcLaborBreakdown, MIN_HOURLY_WAGE } from '@/lib/laborCalc';
import { getClosingSourceData } from '@/app/(app)/closing/actions';
import { ymd } from '@/lib/date';
import { getPageCache, setPageCache } from '@/lib/pageCache';
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Calendar,
  Users, DollarSign, MessageCircle, Clock, FileText, Package,
} from 'lucide-react';

function monthStart(year, month) {
  return new Date(year, month, 1, 0, 0, 0, 0);
}
function monthEnd(year, month) {
  return new Date(year, month + 1, 1, 0, 0, 0, 0);
}

export default function ReportsPage() {
  const router = useRouter();
  const { currentWorkplaceId, supabase, currentWorkplace, profile, memberships } = useApp();
  // 열람 권한: 본사 소속(임원·super_admin 포함)만
  const canView =
    profile?.is_super_admin === true
    || profile?.is_executive === true
    || memberships.some((m) => m.workplaces?.name === '본사');
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  const start = useMemo(() => monthStart(year, month), [year, month]);
  const end = useMemo(() => monthEnd(year, month), [year, month]);
  const prevStart = useMemo(() => monthStart(year, month - 1), [year, month]);
  const prevEnd = useMemo(() => monthEnd(year, month - 1), [year, month]);

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !canView) return;
    // 재방문/월 이동 시 캐시된 집계 즉시 표시 후 백그라운드 갱신
    const cacheKey = `reports:${currentWorkplaceId}:${year}-${month}`;
    const cachedData = getPageCache(cacheKey);
    if (cachedData) setData(cachedData);
    // 매출/승인 지출/근태/시급은 월 마감과 동일한 서버 액션으로 조회 → 두 화면 수치가 항상 일치
    const [
      src, prevSales, pendingExpenses, shifts, complaints,
    ] = await Promise.all([
      getClosingSourceData(currentWorkplaceId, start.toISOString(), end.toISOString()),
      supabase
        .from('sales_daily')
        .select('total_amount')
        .eq('workplace_id', currentWorkplaceId)
        .gte('sales_date', ymd(prevStart))
        .lt('sales_date', ymd(prevEnd)),
      supabase
        .from('approval_requests')
        .select('total_amount')
        .eq('workplace_id', currentWorkplaceId)
        .eq('doc_type', 'expense')
        .eq('status', 'pending')
        .gte('submitted_at', start.toISOString())
        .lt('submitted_at', end.toISOString()),
      supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId)
        .gte('start_at', start.toISOString())
        .lt('start_at', end.toISOString()),
      supabase
        .from('customer_complaints')
        .select('category, severity, status')
        .eq('workplace_id', currentWorkplaceId)
        .gte('occurred_at', start.toISOString())
        .lt('occurred_at', end.toISOString()),
    ]);

    // Sales aggregates
    const salesRows = src.sales ?? [];
    const totalSales = salesRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const totalTx = salesRows.reduce((s, r) => s + Number(r.transaction_count || 0), 0);
    const cashSum = salesRows.reduce((s, r) => s + Number(r.cash_amount || 0), 0);
    const cardSum = salesRows.reduce((s, r) => s + Number(r.card_amount || 0), 0);
    const otherSum = salesRows.reduce((s, r) => s + Number(r.other_amount || 0), 0);
    const daysWithSales = salesRows.filter((r) => Number(r.total_amount) > 0).length;
    const avgDaily = daysWithSales ? Math.round(totalSales / daysWithSales) : 0;

    const sortedByAmount = [...salesRows].sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
    const bestDay = sortedByAmount[0];
    const worstDay = sortedByAmount.filter((r) => Number(r.total_amount) > 0).slice(-1)[0];

    const prevTotal = (prevSales.data ?? []).reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const salesGrowth = prevTotal > 0 ? ((totalSales - prevTotal) / prevTotal) * 100 : 0;

    // Expense aggregates — 승인된 지출결의서(doc_type=expense)만. 회계 분류(kind)별 합계도 산출
    const expRows = src.expenses ?? [];
    const totalExpense = expRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const expenseByCat = {};
    const expenseByKind = { cogs: 0, opex: 0, utilities: 0 };
    expRows.forEach((r) => {
      (r.expense_items ?? []).forEach((it) => {
        const k = it.category || '기타';
        const amt = Number(it.amount || 0);
        expenseByCat[k] = (expenseByCat[k] ?? 0) + amt;
        const kind = it.kind || 'opex';
        expenseByKind[kind] = (expenseByKind[kind] ?? 0) + amt;
      });
    });
    const expenseTop = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]);
    const pendRows = pendingExpenses.data ?? [];
    const pendingExpense = {
      count: pendRows.length,
      amount: pendRows.reduce((s, r) => s + Number(r.total_amount || 0), 0),
    };

    // 근무시간·인건비 — 월 마감과 같은 calcLabor 기준 (휴게 차감, 야간/연장/주휴 수당 포함)
    // 시급은 관리자(laborVisible)에게만 내려오므로, 그 외에는 근무시간만 표시
    const { breakdown: userHours, totalLabor } = calcLaborBreakdown(src.attendance, src.profiles, {
      shifts: src.shifts,
      premiums: !src.premiumExempt,
    });
    const totalMinutes = userHours.reduce((s, u) => s + u.minutes, 0);
    const laborVisible = src.laborVisible === true;
    const premiumExempt = src.premiumExempt === true;

    // 손익 (월 마감 손익계산서와 동일 산식)
    const grossProfit = totalSales - expenseByKind.cogs;
    const operatingProfit = grossProfit - totalLabor - expenseByKind.opex - expenseByKind.utilities;

    // Complaints aggregates
    const cmpRows = complaints.data ?? [];
    const openComplaints = cmpRows.filter((c) => c.status !== 'resolved').length;
    const highSeverity = cmpRows.filter((c) => c.severity === 'high').length;

    const nextData = {
      totalSales, totalTx, cashSum, cardSum, otherSum,
      daysWithSales, avgDaily, bestDay, worstDay,
      prevTotal, salesGrowth,
      totalExpense, expenseTop, expenseByKind, pendingExpense,
      userHours, totalMinutes, totalLabor, laborVisible, premiumExempt, grossProfit, operatingProfit,
      shiftsCount: shifts.count ?? 0,
      complaints: { total: cmpRows.length, open: openComplaints, high: highSeverity },
      salesRows,
    };
    setData(nextData);
    setPageCache(cacheKey, nextData);
    setLoading(false);
  }, [supabase, currentWorkplaceId, canView, year, month, start, end, prevStart, prevEnd]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const monthLabel = `${year}년 ${month + 1}월`;
  const profit = data ? data.totalSales - data.totalExpense : 0;
  const profitMargin = data && data.totalSales > 0 ? (profit / data.totalSales) * 100 : 0;
  // 매출 대비 비율 (%)
  const pctOfSales = (v) => (data && data.totalSales > 0 ? (Math.abs(v) / data.totalSales) * 100 : 0);

  return (
    <>
      <PageHeader
        title="리포트"
        subtitle={currentWorkplace?.name ? `${currentWorkplace.name} 월별 분석` : '월별 분석'}
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 월 네비게이터 */}
        <div className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-icon" onClick={prevMonth} aria-label="이전 달"><ChevronLeft size={18} /></button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="h3">{monthLabel}</div>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginTop: 2 }}
              >
                이번 달로
              </button>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={nextMonth} disabled={isCurrentMonth} aria-label="다음 달"><ChevronRight size={18} /></button>
        </div>

        {!canView ? (
          <div className="card empty">
            <div className="empty-title">열람 권한이 없어요</div>
            <div className="empty-desc">월별 리포트는 본사 직원만 볼 수 있습니다.</div>
          </div>
        ) : loading || !data ? (
          <div className="stack stack-3">
            <div className="skeleton" style={{ height: 140 }} />
            <div className="skeleton" style={{ height: 200 }} />
          </div>
        ) : (
          <>
            {/* 핵심 KPI — 매출/지출/이익 */}
            <section className="bento accent" style={{ minHeight: 180 }}>
              <div className="bento-decor" />
              <div className="bento-label">
                <DollarSign size={14} /> 월 매출
              </div>
              <div className="bento-value num" style={{ fontSize: 38 }}>
                {formatCurrency(data.totalSales)}<span style={{ fontSize: 16, opacity: 0.85, marginLeft: 4 }}>원</span>
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, opacity: 0.92 }}>
                <span>📅 {data.daysWithSales}일 영업</span>
                <span>🧾 {data.totalTx}건</span>
                {data.prevTotal > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {data.salesGrowth >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    전월 대비 {data.salesGrowth >= 0 ? '+' : ''}{data.salesGrowth.toFixed(1)}%
                  </span>
                )}
              </div>
            </section>

            {/* 지출 & 인건비(관리자) / 매출-지출(일반) */}
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="bento">
                <div className="bento-label text-secondary">
                  <FileText size={14} /> 지출
                </div>
                <div className="bento-value sm num" style={{ color: 'var(--danger)' }}>
                  {formatCurrency(data.totalExpense)}
                </div>
                <div className="bento-sub text-muted">
                  승인 결의서 · 매출 대비 {pctOfSales(data.totalExpense).toFixed(1)}%
                  {data.pendingExpense.count > 0 && ` · 대기 ${data.pendingExpense.count}건`}
                </div>
              </div>
              {data.laborVisible ? (
                <div className="bento">
                  <div className="bento-label text-secondary">
                    <Users size={14} /> 인건비
                  </div>
                  <div className="bento-value sm num" style={{ color: 'var(--danger)' }}>
                    {formatCurrency(data.totalLabor)}
                  </div>
                  <div className="bento-sub text-muted">
                    근태 × 시급 · 매출 대비 {pctOfSales(data.totalLabor).toFixed(1)}%
                  </div>
                </div>
              ) : (
                <div className="bento">
                  <div className="bento-label text-secondary">
                    <TrendingUp size={14} /> 매출-지출(추정)
                  </div>
                  <div className="bento-value sm num" style={{ color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                  </div>
                  <div className="bento-sub text-muted">
                    마진 {profitMargin.toFixed(1)}% · 인건비 미포함 — 정확한 손익은 월 마감
                  </div>
                </div>
              )}
            </section>

            {/* 손익 — 월 마감 손익계산서와 동일 산식 + 매출 대비 비율 */}
            {data.laborVisible && (
              <section className="card">
                <h2 className="h3" style={{ marginBottom: 12 }}>손익 · 매출 대비 비율</h2>
                <div className="stack stack-2">
                  <PlRow label="매출" value={data.totalSales} pct={100} />
                  <PlRow label="(–) 매출원가 — 식자재·음료·주류" value={-data.expenseByKind.cogs} pct={pctOfSales(data.expenseByKind.cogs)} small />
                  <hr className="divider" style={{ margin: '4px 0' }} />
                  <PlRow
                    label="매출총이익"
                    value={data.grossProfit}
                    pct={pctOfSales(data.grossProfit)}
                    color={data.grossProfit >= 0 ? 'var(--text)' : 'var(--danger)'}
                  />
                  <PlRow label="(–) 인건비" value={-data.totalLabor} pct={pctOfSales(data.totalLabor)} small />
                  <PlRow label="(–) 일반관리비 — 비품·소모품·수리·마케팅" value={-data.expenseByKind.opex} pct={pctOfSales(data.expenseByKind.opex)} small />
                  <PlRow label="(–) 공과잡비 — 전기·수도·가스·통신·임차료" value={-data.expenseByKind.utilities} pct={pctOfSales(data.expenseByKind.utilities)} small />
                  <hr className="divider" style={{ margin: '4px 0', borderColor: 'var(--border-strong)' }} />
                  <PlRow
                    label="영업이익"
                    value={data.operatingProfit}
                    pct={pctOfSales(data.operatingProfit)}
                    color={data.operatingProfit >= 0 ? 'var(--success)' : 'var(--danger)'}
                    large
                  />
                </div>
                <p className="text-muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
                  인건비 = 출퇴근 기록 × 시급 (휴게 차감 · 주휴 주 15h 이상 + 시프트 개근
                  {data.premiumExempt ? ' · 5인 미만 사업장이라 연장·야간 가산 미적용' : ' · 야간 22~06시 +50% · 연장 일 8h/주 40h 초과 +50%'}). 지출 = 이 달에 올린 승인 지출결의서.
                  {data.pendingExpense.count > 0 && ` 승인 대기 ${data.pendingExpense.count}건 ${formatCurrency(data.pendingExpense.amount)}원은 미반영.`}
                  {' '}확정 수치는 월 마감에서 확인.
                </p>
              </section>
            )}

            {/* 일평균/최고/최저 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 12 }}>매출 디테일</h2>
              <div className="stack stack-2" style={{ fontSize: 14 }}>
                <Row label="일평균" value={`${formatCurrency(data.avgDaily)}원`} />
                {data.bestDay && (
                  <Row
                    label="최고 일매출"
                    value={`${data.bestDay.sales_date.slice(5)} · ${formatCurrency(data.bestDay.total_amount)}원`}
                  />
                )}
                {data.worstDay && data.worstDay !== data.bestDay && (
                  <Row
                    label="최저 일매출"
                    value={`${data.worstDay.sales_date.slice(5)} · ${formatCurrency(data.worstDay.total_amount)}원`}
                  />
                )}
                <Row label="카드" value={`${formatCurrency(data.cardSum)}원`} />
                <Row label="현금" value={`${formatCurrency(data.cashSum)}원`} />
                {data.otherSum > 0 && <Row label="기타" value={`${formatCurrency(data.otherSum)}원`} />}
              </div>
            </section>

            {/* 지출 카테고리 Top */}
            {data.expenseTop.length > 0 && (
              <section className="card">
                <h2 className="h3" style={{ marginBottom: 12 }}>지출 카테고리</h2>
                <div className="stack stack-2">
                  {data.expenseTop.slice(0, 5).map(([cat, amt]) => {
                    const pct = data.totalExpense > 0 ? (amt / data.totalExpense) * 100 : 0;
                    return (
                      <div key={cat}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{cat}</span>
                          <span className="num text-secondary" style={{ fontSize: 13, fontWeight: 700 }}>
                            {formatCurrency(amt)}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'var(--surface-soft)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--grad-accent)' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 인건비/근무시간 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 4 }}>근무 시간</h2>
              <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                총 {Math.floor(data.totalMinutes / 60)}시간 {data.totalMinutes % 60}분 · 시프트 {data.shiftsCount}건
                {data.laborVisible && ` · 인건비 ${formatCurrency(data.totalLabor)}원`}
              </p>
              {data.laborVisible && data.userHours.some((u) => u.hourly_wage < MIN_HOURLY_WAGE) && (
                <div style={{ marginBottom: 12, padding: 10, background: 'var(--warning-soft)', color: '#c2410c', borderRadius: 10, fontSize: 12 }}>
                  시급이 미설정이거나 2026년 최저시급({formatCurrency(MIN_HOURLY_WAGE)}원) 미만인 직원이 있습니다. 직원관리에서 시급을 확인해주세요.
                </div>
              )}

              {data.userHours.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>기록 없음</p>
              ) : (
                <div className="stack stack-2">
                  {data.userHours.map((u) => {
                    const hh = Math.floor(u.minutes / 60);
                    const mm = u.minutes % 60;
                    const pct = data.totalMinutes > 0 ? (u.minutes / data.totalMinutes) * 100 : 0;
                    return (
                      <div key={u.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar name={u.name} userId={u.user_id} size="sm" />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</span>
                            <span className="num" style={{ fontSize: 13, fontWeight: 700 }}>
                              {hh}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>h</span> {mm}<span style={{ fontSize: 10, color: 'var(--text-muted)' }}>m</span>
                              {data.laborVisible && (
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{formatCurrency(u.labor)}원</span>
                              )}
                            </span>
                          </div>
                          <div style={{ height: 5, background: 'var(--surface-soft)', borderRadius: 999, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--grad-accent)' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 고객 클레임 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 12 }}>고객 클레임</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <Stat label="전체" value={data.complaints.total} />
                <Stat label="미해결" value={data.complaints.open} color={data.complaints.open > 0 ? 'var(--warning)' : undefined} />
                <Stat label="심각" value={data.complaints.high} color={data.complaints.high > 0 ? 'var(--danger)' : undefined} />
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
      <span className="text-muted">{label}</span>
      <span className="num" style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function PlRow({ label, value, pct, large, small, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, padding: '4px 0' }}>
      <span style={{
        flex: 1,
        fontSize: large ? 15 : small ? 12 : 14,
        fontWeight: large ? 800 : small ? 500 : 700,
        color: small ? 'var(--text-secondary)' : 'var(--text)',
      }}>
        {label}
      </span>
      <span className="num text-muted" style={{ fontSize: 11, minWidth: 44, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
      <span className="num" style={{
        fontSize: large ? 20 : small ? 13 : 15,
        fontWeight: large ? 800 : 700,
        color: color || (small ? 'var(--text-secondary)' : 'var(--text)'),
        minWidth: 96,
        textAlign: 'right',
      }}>
        {value < 0 ? '-' : ''}{formatCurrency(Math.abs(value))}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
      </span>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface-soft)', borderRadius: 12 }}>
      <div className="text-muted" style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
