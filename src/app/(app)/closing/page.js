'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { downloadCsv, fmtDate } from '@/lib/csvExport';
import {
  ChevronLeft, ChevronRight, Lock, Unlock, Download, Check, AlertCircle,
} from 'lucide-react';

function monthStart(y, m) { return new Date(y, m, 1, 0, 0, 0, 0); }
function monthEnd(y, m) { return new Date(y, m + 1, 1, 0, 0, 0, 0); }
function ymd(d) { return d.toISOString().slice(0, 10); }

export default function ClosingPage() {
  const router = useRouter();
  const { user, profile, currentWorkplaceId, currentWorkplace, supabase, memberships } = useApp();
  const isAdmin =
    profile?.is_super_admin === true
    || profile?.can_close_books === true
    || memberships.some((m) => m.role === 'owner');

  const now = new Date();
  // 기본값: 지난 달 (이번 달이 진행 중일 가능성이 높으므로)
  const defaultDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(defaultDate.getFullYear());
  const [month, setMonth] = useState(defaultDate.getMonth());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [existingClosing, setExistingClosing] = useState(null);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null);

  const start = useMemo(() => monthStart(year, month), [year, month]);
  const end = useMemo(() => monthEnd(year, month), [year, month]);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    setError(null);

    // 기존 마감 스냅샷 확인
    const { data: existing } = await supabase
      .from('month_closings')
      .select('*')
      .eq('workplace_id', currentWorkplaceId)
      .eq('year', year)
      .eq('month', month + 1)
      .maybeSingle();

    if (existing) {
      setExistingClosing(existing);
      setData({
        totalRevenue: Number(existing.total_revenue),
        totalLabor: Number(existing.total_labor),
        totalExpense: Number(existing.total_expense),
        netProfit: Number(existing.net_profit),
        revenueBreakdown: existing.revenue_breakdown || [],
        laborBreakdown: existing.labor_breakdown || [],
        expenseBreakdown: existing.expense_breakdown || [],
      });
      setLoading(false);
      return;
    }
    setExistingClosing(null);

    // 실시간 집계
    const [sales, expenses, attendance, profilesData] = await Promise.all([
      supabase
        .from('sales_daily')
        .select('sales_date, total_amount, transaction_count, cash_amount, card_amount, other_amount')
        .eq('workplace_id', currentWorkplaceId)
        .gte('sales_date', ymd(start))
        .lt('sales_date', ymd(end))
        .order('sales_date'),
      supabase
        .from('approval_requests')
        .select('id, title, total_amount, decided_at, expense_items(category, amount, description)')
        .eq('workplace_id', currentWorkplaceId)
        .eq('status', 'approved')
        .gte('submitted_at', start.toISOString())
        .lt('submitted_at', end.toISOString()),
      supabase
        .from('attendance_logs')
        .select('user_id, event_type, event_at, profiles:profiles!attendance_logs_user_id_fkey(name, hourly_wage)')
        .eq('workplace_id', currentWorkplaceId)
        .gte('event_at', start.toISOString())
        .lt('event_at', end.toISOString())
        .order('event_at'),
      supabase.from('profiles').select('user_id, name, hourly_wage'),
    ]);

    // 매출 집계
    const salesRows = sales.data ?? [];
    const totalRevenue = salesRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);

    // 지출 집계 (카테고리별)
    const expRows = expenses.data ?? [];
    const totalExpense = expRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const expenseByCategory = {};
    expRows.forEach((r) => {
      (r.expense_items ?? []).forEach((it) => {
        const k = it.category || '기타';
        expenseByCategory[k] = (expenseByCategory[k] ?? 0) + Number(it.amount || 0);
      });
    });
    const expenseBreakdown = Object.entries(expenseByCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    // 인건비 집계 (직원별 근무시간 × 시급)
    const wageMap = new Map();
    (profilesData.data ?? []).forEach((p) => {
      wageMap.set(p.user_id, { name: p.name, hourly_wage: Number(p.hourly_wage || 0) });
    });
    const logsByUser = {};
    (attendance.data ?? []).forEach((l) => {
      if (!logsByUser[l.user_id]) logsByUser[l.user_id] = [];
      logsByUser[l.user_id].push(l);
    });
    const laborBreakdown = [];
    let totalLabor = 0;
    for (const [uid, logs] of Object.entries(logsByUser)) {
      let mins = 0;
      let openIn = null;
      let breakStart = null;
      for (const l of logs) {
        const ts = new Date(l.event_at).getTime();
        if (l.event_type === 'clock_in') openIn = ts;
        if (l.event_type === 'break_start' && openIn) breakStart = ts;
        if (l.event_type === 'break_end' && breakStart) {
          mins -= Math.floor((ts - breakStart) / 60000);
          breakStart = null;
        }
        if (l.event_type === 'clock_out' && openIn) {
          mins += Math.floor((ts - openIn) / 60000);
          openIn = null;
        }
      }
      mins = Math.max(0, mins);
      const wage = wageMap.get(uid)?.hourly_wage ?? 0;
      const name = wageMap.get(uid)?.name ?? '—';
      const labor = Math.round((mins / 60) * wage);
      totalLabor += labor;
      laborBreakdown.push({ user_id: uid, name, minutes: mins, hourly_wage: wage, labor });
    }
    laborBreakdown.sort((a, b) => b.labor - a.labor);

    const netProfit = totalRevenue - totalLabor - totalExpense;

    setData({
      totalRevenue, totalLabor, totalExpense, netProfit,
      revenueBreakdown: salesRows.map((r) => ({
        sales_date: r.sales_date,
        total: Number(r.total_amount),
        card: Number(r.card_amount),
        cash: Number(r.cash_amount),
        other: Number(r.other_amount),
      })),
      laborBreakdown,
      expenseBreakdown,
    });
    setLoading(false);
  }, [supabase, currentWorkplaceId, year, month, start, end]);

  useEffect(() => { load(); }, [load]);

  function prevMonth() { if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1); }
  function nextMonth() { if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1); }

  async function confirmClose() {
    if (!data) return;
    if (!confirm(`${year}년 ${month + 1}월 마감을 확정하시겠습니까? 확정 후에도 데이터 수정은 가능하지만 이 스냅샷은 보존됩니다.`)) return;
    setActing(true);
    setError(null);
    const { error } = await supabase.from('month_closings').upsert({
      workplace_id: currentWorkplaceId,
      year, month: month + 1,
      total_revenue: data.totalRevenue,
      total_labor: data.totalLabor,
      total_expense: data.totalExpense,
      net_profit: data.netProfit,
      revenue_breakdown: data.revenueBreakdown,
      labor_breakdown: data.laborBreakdown,
      expense_breakdown: data.expenseBreakdown,
      locked: true,
      closed_by: user.id,
      closed_at: new Date().toISOString(),
    }, { onConflict: 'workplace_id,year,month' });
    if (error) { setError(error.message); setActing(false); return; }
    await load();
    setActing(false);
  }

  async function unlockClose() {
    if (!confirm('마감을 해제하시겠습니까? 다시 실시간 집계가 표시됩니다.')) return;
    setActing(true);
    const { error } = await supabase
      .from('month_closings')
      .delete()
      .eq('workplace_id', currentWorkplaceId)
      .eq('year', year)
      .eq('month', month + 1);
    if (error) { setError(error.message); setActing(false); return; }
    await load();
    setActing(false);
  }

  function exportCsv() {
    if (!data) return;
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    const wp = currentWorkplace?.name ?? '';

    // 종합 + 상세를 한 CSV에 (섹션 헤더 행으로 구분)
    const rows = [];

    rows.push({ section: '월 마감', label: '사업장', value: wp });
    rows.push({ section: '월 마감', label: '기간', value: ym });
    rows.push({ section: '월 마감', label: '매출', value: data.totalRevenue });
    rows.push({ section: '월 마감', label: '인건비', value: data.totalLabor });
    rows.push({ section: '월 마감', label: '지출', value: data.totalExpense });
    rows.push({ section: '월 마감', label: '영업이익', value: data.netProfit });
    rows.push({ section: '', label: '', value: '' });

    rows.push({ section: '직원별 인건비', label: '이름', value: '시급 / 근무시간 / 인건비' });
    data.laborBreakdown.forEach((u) => {
      rows.push({
        section: '직원별 인건비',
        label: u.name,
        value: `${u.hourly_wage} / ${Math.floor(u.minutes / 60)}h ${u.minutes % 60}m / ${u.labor}`,
      });
    });
    rows.push({ section: '', label: '', value: '' });

    rows.push({ section: '카테고리별 지출', label: '카테고리', value: '금액' });
    data.expenseBreakdown.forEach((e) => {
      rows.push({ section: '카테고리별 지출', label: e.category, value: e.amount });
    });
    rows.push({ section: '', label: '', value: '' });

    rows.push({ section: '일별 매출', label: '날짜', value: '총매출 / 카드 / 현금 / 기타' });
    data.revenueBreakdown.forEach((d) => {
      rows.push({
        section: '일별 매출',
        label: d.sales_date,
        value: `${d.total} / ${d.card} / ${d.cash} / ${d.other}`,
      });
    });

    downloadCsv(
      `closing_${wp}_${ym}.csv`,
      [
        { key: 'section', label: '섹션' },
        { key: 'label', label: '항목' },
        { key: 'value', label: '값' },
      ],
      rows
    );
  }

  const monthLabel = `${year}년 ${month + 1}월`;
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth());

  return (
    <>
      <PageHeader
        title="월 마감"
        subtitle="매출 · 인건비 · 지출 통합 손익"
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!data || loading}>
              <Download size={14} /> CSV
            </button>
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
          </div>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 월 네비 */}
        <div className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-icon" onClick={prevMonth} aria-label="이전 달"><ChevronLeft size={18} /></button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="h3" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {monthLabel}
              {existingClosing && <span className="tag tag-success"><Lock size={11} /> 마감 확정</span>}
            </div>
            {existingClosing && (
              <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                {existingClosing.closed_at?.slice(0, 10)} 확정
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={nextMonth} disabled={isFutureMonth} aria-label="다음 달"><ChevronRight size={18} /></button>
        </div>

        {loading || !data ? (
          <div className="stack stack-3">
            <div className="skeleton" style={{ height: 200 }} />
            <div className="skeleton" style={{ height: 200 }} />
          </div>
        ) : (
          <>
            {/* 핵심 수치 — 단순한 테이블 형식 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 14 }}>손익 요약</h2>
              <div className="stack stack-2">
                <Row label="매출" value={data.totalRevenue} />
                <Row label="인건비" value={-data.totalLabor} color="var(--danger)" />
                <Row label="지출" value={-data.totalExpense} color="var(--danger)" />
                <hr className="divider" style={{ margin: '4px 0' }} />
                <Row
                  label="영업이익"
                  value={data.netProfit}
                  color={data.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}
                  large
                />
              </div>
            </section>

            {/* 직원별 인건비 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 12 }}>직원별 인건비</h2>
              {data.laborBreakdown.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>이 기간 출퇴근 기록이 없습니다.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={cellHead}>직원</th>
                      <th style={cellHeadR}>근무시간</th>
                      <th style={cellHeadR}>시급</th>
                      <th style={cellHeadR}>인건비</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.laborBreakdown.map((u) => (
                      <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={cell}>{u.name}</td>
                        <td style={cellR} className="num">
                          {Math.floor(u.minutes / 60)}h {u.minutes % 60}m
                        </td>
                        <td style={cellR} className="num">
                          {u.hourly_wage > 0 ? formatCurrency(u.hourly_wage) : <span className="text-muted">미설정</span>}
                        </td>
                        <td style={cellR} className="num" >
                          <strong>{formatCurrency(u.labor)}</strong>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td style={cellTotal} colSpan={3}>합계</td>
                      <td style={cellTotalR} className="num">{formatCurrency(data.totalLabor)}</td>
                    </tr>
                  </tbody>
                </table>
              )}

              {data.laborBreakdown.some((u) => u.hourly_wage === 0) && (
                <div style={{ marginTop: 10, padding: 10, background: 'var(--warning-soft)', color: '#c2410c', borderRadius: 10, fontSize: 12, display: 'flex', gap: 8 }}>
                  <AlertCircle size={14} />
                  시급이 설정되지 않은 직원은 인건비가 0원으로 계산됩니다. <strong>직원관리</strong>에서 시급을 입력해주세요.
                </div>
              )}
            </section>

            {/* 카테고리별 지출 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 12 }}>카테고리별 지출</h2>
              {data.expenseBreakdown.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>승인된 지출이 없습니다.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={cellHead}>카테고리</th>
                      <th style={cellHeadR}>금액</th>
                      <th style={cellHeadR}>비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expenseBreakdown.map((e) => {
                      const pct = data.totalExpense > 0 ? (e.amount / data.totalExpense) * 100 : 0;
                      return (
                        <tr key={e.category} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={cell}>{e.category}</td>
                          <td style={cellR} className="num">{formatCurrency(e.amount)}</td>
                          <td style={cellR} className="num text-muted">{pct.toFixed(1)}%</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={cellTotal}>합계</td>
                      <td style={cellTotalR} className="num">{formatCurrency(data.totalExpense)}</td>
                      <td style={cellTotalR} className="num">100.0%</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>

            {/* 마감 액션 */}
            {isAdmin && (
              <section className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
                {existingClosing ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Check size={16} color="var(--success)" />
                      <strong>마감 확정됨</strong>
                    </div>
                    <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                      이 스냅샷은 마감 시점 데이터로 저장되어 있습니다.
                      이후 데이터가 변경되어도 이 화면은 마감 당시 수치를 유지합니다.
                    </p>
                    <button type="button" className="btn btn-outline btn-sm" onClick={unlockClose} disabled={acting} style={{ color: 'var(--danger)' }}>
                      <Unlock size={14} /> 마감 해제
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
                      현재 표시되는 수치는 <strong>실시간 집계</strong>입니다.
                      마감을 확정하면 위 수치가 스냅샷으로 저장되어 회계 정합성이 유지됩니다.
                    </p>
                    <button type="button" className="btn btn-primary btn-lg btn-block" onClick={confirmClose} disabled={acting}>
                      <Lock size={16} /> {monthLabel} 마감 확정
                    </button>
                  </div>
                )}
                {error && (
                  <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
                    {error}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

const cellHead = { textAlign: 'left', padding: '8px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' };
const cellHeadR = { ...cellHead, textAlign: 'right' };
const cell = { padding: '10px 6px', fontWeight: 600 };
const cellR = { ...cell, textAlign: 'right' };
const cellTotal = { padding: '10px 6px', fontWeight: 800, color: 'var(--accent)' };
const cellTotalR = { ...cellTotal, textAlign: 'right' };

function Row({ label, value, color, large }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0' }}>
      <span style={{ fontSize: large ? 16 : 14, fontWeight: large ? 800 : 600, color: 'var(--text)' }}>{label}</span>
      <span className="num" style={{
        fontSize: large ? 24 : 16,
        fontWeight: large ? 800 : 700,
        color: color || 'var(--text)',
      }}>
        {value >= 0 ? '' : '-'}{formatCurrency(Math.abs(value))}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
      </span>
    </div>
  );
}
