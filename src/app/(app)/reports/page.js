'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatCurrency } from '@/lib/format';
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
function ymd(d) { return d.toISOString().slice(0, 10); }

export default function ReportsPage() {
  const router = useRouter();
  const { currentWorkplaceId, supabase, currentWorkplace } = useApp();
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
    if (!currentWorkplaceId) return;
    const [
      sales, prevSales, expenses, attendance, shifts, complaints,
    ] = await Promise.all([
      supabase
        .from('sales_daily')
        .select('sales_date, total_amount, transaction_count, cash_amount, card_amount, other_amount')
        .eq('workplace_id', currentWorkplaceId)
        .gte('sales_date', ymd(start))
        .lt('sales_date', ymd(end))
        .order('sales_date'),
      supabase
        .from('sales_daily')
        .select('total_amount')
        .eq('workplace_id', currentWorkplaceId)
        .gte('sales_date', ymd(prevStart))
        .lt('sales_date', ymd(prevEnd)),
      supabase
        .from('approval_requests')
        .select('total_amount, expense_items(category, amount)')
        .eq('workplace_id', currentWorkplaceId)
        .eq('status', 'approved')
        .gte('submitted_at', start.toISOString())
        .lt('submitted_at', end.toISOString()),
      supabase
        .from('attendance_logs')
        .select('user_id, event_type, event_at, profiles:profiles!attendance_logs_user_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .gte('event_at', start.toISOString())
        .lt('event_at', end.toISOString())
        .order('event_at'),
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
    const salesRows = sales.data ?? [];
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

    // Expense aggregates
    const expRows = expenses.data ?? [];
    const totalExpense = expRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const expenseByCat = {};
    expRows.forEach((r) => {
      (r.expense_items ?? []).forEach((it) => {
        const k = it.category || '기타';
        expenseByCat[k] = (expenseByCat[k] ?? 0) + Number(it.amount || 0);
      });
    });
    const expenseTop = Object.entries(expenseByCat).sort((a, b) => b[1] - a[1]);

    // Attendance hours (clock_in to clock_out pairs, by user)
    const logsByUser = {};
    (attendance.data ?? []).forEach((l) => {
      const uid = l.user_id;
      if (!logsByUser[uid]) logsByUser[uid] = { name: l.profiles?.name ?? '—', logs: [] };
      logsByUser[uid].logs.push(l);
    });
    const userHours = Object.entries(logsByUser).map(([uid, { name, logs }]) => {
      let mins = 0;
      let openIn = null;
      logs.forEach((l) => {
        if (l.event_type === 'clock_in') openIn = new Date(l.event_at).getTime();
        if (l.event_type === 'clock_out' && openIn) {
          mins += Math.max(0, Math.floor((new Date(l.event_at).getTime() - openIn) / 60000));
          openIn = null;
        }
      });
      return { user_id: uid, name, minutes: mins };
    }).sort((a, b) => b.minutes - a.minutes);
    const totalMinutes = userHours.reduce((s, u) => s + u.minutes, 0);

    // Complaints aggregates
    const cmpRows = complaints.data ?? [];
    const openComplaints = cmpRows.filter((c) => c.status !== 'resolved').length;
    const highSeverity = cmpRows.filter((c) => c.severity === 'high').length;

    setData({
      totalSales, totalTx, cashSum, cardSum, otherSum,
      daysWithSales, avgDaily, bestDay, worstDay,
      prevTotal, salesGrowth,
      totalExpense, expenseTop,
      userHours, totalMinutes,
      shiftsCount: shifts.count ?? 0,
      complaints: { total: cmpRows.length, open: openComplaints, high: highSeverity },
      salesRows,
    });
    setLoading(false);
  }, [supabase, currentWorkplaceId, start, end, prevStart, prevEnd]);

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

        {loading || !data ? (
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

            {/* 지출 & 이익 */}
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="bento">
                <div className="bento-label text-secondary">
                  <FileText size={14} /> 지출
                </div>
                <div className="bento-value sm num" style={{ color: 'var(--danger)' }}>
                  {formatCurrency(data.totalExpense)}
                </div>
                <div className="bento-sub text-muted">승인된 지출결의서</div>
              </div>
              <div className="bento">
                <div className="bento-label text-secondary">
                  <TrendingUp size={14} /> 순이익(추정)
                </div>
                <div className="bento-value sm num" style={{ color: profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {profit >= 0 ? '+' : ''}{formatCurrency(profit)}
                </div>
                <div className="bento-sub text-muted">
                  마진 {profitMargin.toFixed(1)}%
                </div>
              </div>
            </section>

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
              </p>

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

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: 12, background: 'var(--surface-soft)', borderRadius: 12 }}>
      <div className="text-muted" style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
