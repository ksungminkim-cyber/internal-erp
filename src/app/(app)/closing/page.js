'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import { downloadCsv, fmtDate } from '@/lib/csvExport';
import { calcLabor, formatMinutes } from '@/lib/laborCalc';
import { safeMutate } from '@/lib/safeMutate';
import {
  ChevronLeft, ChevronRight, Lock, Unlock, Download, Check, AlertCircle,
  Send, Printer, X, Plus, Clock, FileCheck,
} from 'lucide-react';

function monthStart(y, m) { return new Date(y, m, 1, 0, 0, 0, 0); }
function monthEnd(y, m) { return new Date(y, m + 1, 1, 0, 0, 0, 0); }
function ymd(d) { return d.toISOString().slice(0, 10); }

// 카테고리 → 회계분류 매핑 (스냅샷에서 재구성용 — approvals/new와 동일)
function getCategoryKind(cat) {
  if (['식자재', '음료/시럽', '주류'].includes(cat)) return 'cogs';
  if (['전기', '수도', '가스', '통신', '임차료', '보험·세금', '공과잡비'].includes(cat)) return 'utilities';
  return 'opex';
}

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
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [existingClosing, setExistingClosing] = useState(null);
  const [closingApproval, setClosingApproval] = useState(null);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);

  const start = useMemo(() => monthStart(year, month), [year, month]);
  const end = useMemo(() => monthEnd(year, month), [year, month]);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
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
      // 회계 분류는 expense_breakdown(category 기반)에서 재계산
      const expBd = existing.expense_breakdown || [];
      const byKind = { cogs: 0, opex: 0, utilities: 0 };
      expBd.forEach((e) => {
        const k = getCategoryKind(e.category);
        byKind[k] = (byKind[k] ?? 0) + Number(e.amount || 0);
      });
      const totalRevenue = Number(existing.total_revenue);
      const totalLabor = Number(existing.total_labor);
      const grossProfit = totalRevenue - byKind.cogs;
      const operatingProfit = grossProfit - totalLabor - byKind.opex - byKind.utilities;
      setData({
        totalRevenue,
        totalLabor,
        totalExpense: Number(existing.total_expense),
        netProfit: Number(existing.net_profit),
        totalCogs: byKind.cogs,
        totalOpex: byKind.opex,
        totalUtilities: byKind.utilities,
        grossProfit,
        operatingProfit,
        revenueBreakdown: existing.revenue_breakdown || [],
        laborBreakdown: existing.labor_breakdown || [],
        expenseBreakdown: expBd,
      });
      // 연결된 마감 결재 조회
      if (existing.approval_request_id) {
        const { data: appr } = await supabase
          .from('approval_requests')
          .select('id, status, title, submitted_at, decided_at')
          .eq('id', existing.approval_request_id)
          .maybeSingle();
        setClosingApproval(appr ?? null);
      } else {
        setClosingApproval(null);
      }
      setLoading(false);
      return;
    }
    setExistingClosing(null);
    setClosingApproval(null);

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
        .select('id, title, total_amount, decided_at, expense_items(category, amount, description, kind)')
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

    // 지출 집계 — 회계 분류(kind)별 + 카테고리별
    const expRows = expenses.data ?? [];
    const totalExpense = expRows.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const expenseByCategory = {};
    const expenseByKind = { cogs: 0, opex: 0, utilities: 0 };
    expRows.forEach((r) => {
      (r.expense_items ?? []).forEach((it) => {
        const k = it.category || '기타';
        const amt = Number(it.amount || 0);
        expenseByCategory[k] = (expenseByCategory[k] ?? 0) + amt;
        const kind = it.kind || 'opex';
        expenseByKind[kind] = (expenseByKind[kind] ?? 0) + amt;
      });
    });
    const expenseBreakdown = Object.entries(expenseByCategory)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    const totalCogs = expenseByKind.cogs;
    const totalOpex = expenseByKind.opex;
    const totalUtilities = expenseByKind.utilities;

    // 인건비 집계 (근로기준법 — 야간/연장/주휴 수당 자동 산정)
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
      const wage = wageMap.get(uid)?.hourly_wage ?? 0;
      const name = wageMap.get(uid)?.name ?? '—';
      const calc = calcLabor(logs, wage);
      totalLabor += calc.totalLabor;
      laborBreakdown.push({
        user_id: uid,
        name,
        hourly_wage: wage,
        minutes: calc.baseMinutes,
        night_minutes: calc.nightMinutes,
        overtime_minutes: calc.overtimeMinutes,
        weekly_rest_minutes: calc.weeklyRestMinutes,
        base_cost: calc.baseCost,
        night_premium: calc.nightPremium,
        overtime_premium: calc.overtimePremium,
        weekly_rest_pay: calc.weeklyRestPay,
        labor: calc.totalLabor,
      });
    }
    laborBreakdown.sort((a, b) => b.labor - a.labor);

    const netProfit = totalRevenue - totalLabor - totalExpense;
    const grossProfit = totalRevenue - totalCogs;
    const operatingProfit = grossProfit - totalLabor - totalOpex - totalUtilities;

    setData({
      totalRevenue, totalLabor, totalExpense, netProfit,
      totalCogs, totalOpex, totalUtilities,
      grossProfit, operatingProfit,
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
    try {
      const { error } = await safeMutate(supabase.from('month_closings').upsert({
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
      }, { onConflict: 'workplace_id,year,month' }));
      if (error) { setError(error.message); return; }
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setActing(false);
    }
  }

  async function unlockClose() {
    if (!confirm('마감을 해제하시겠습니까? 다시 실시간 집계가 표시됩니다.')) return;
    setActing(true);
    try {
      const { error } = await safeMutate(supabase
        .from('month_closings')
        .delete()
        .eq('workplace_id', currentWorkplaceId)
        .eq('year', year)
        .eq('month', month + 1));
      if (error) { setError(error.message); return; }
      await load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setActing(false);
    }
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
            {isAdmin && (
              <Link
                href={`/closing/print?year=${year}&month=${month + 1}`}
                className="btn btn-soft btn-sm"
                style={{ pointerEvents: !data || loading ? 'none' : 'auto', opacity: !data || loading ? 0.5 : 1 }}
              >
                <Printer size={14} /> 인쇄
              </Link>
            )}
            {isAdmin && (
              <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!data || loading}>
                <Download size={14} /> CSV
              </button>
            )}
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
            {/* 손익계산서 — 표준 양식 */}
            <section className="card">
              <h2 className="h3" style={{ marginBottom: 14 }}>손익계산서</h2>
              <div className="stack stack-2">
                <Row label="매출" value={data.totalRevenue} bold />
                <Row label="(–) 매출원가 — 식자재·음료·주류" value={-data.totalCogs} color="var(--text-secondary)" small />
                <hr className="divider" style={{ margin: '4px 0' }} />
                <Row
                  label="매출총이익"
                  value={data.grossProfit}
                  color={data.grossProfit >= 0 ? 'var(--text)' : 'var(--danger)'}
                />
                <Row label="(–) 인건비" value={-data.totalLabor} color="var(--text-secondary)" small />
                <Row label="(–) 일반관리비 — 비품·소모품·수리·마케팅" value={-data.totalOpex} color="var(--text-secondary)" small />
                <Row label="(–) 공과잡비 — 전기·수도·가스·통신·임차료" value={-data.totalUtilities} color="var(--text-secondary)" small />
                <hr className="divider" style={{ margin: '4px 0', borderColor: 'var(--border-strong)' }} />
                <Row
                  label="영업이익"
                  value={data.operatingProfit}
                  color={data.operatingProfit >= 0 ? 'var(--success)' : 'var(--danger)'}
                  large
                />
              </div>
            </section>

            {/* 직원별 인건비 */}
            <section className="card">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <h2 className="h3">직원별 인건비</h2>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  근로기준법 — 야간(22~06시) +50% / 연장(8h 초과) +50% / 주휴(주 15h 이상)
                </span>
              </div>
              {data.laborBreakdown.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 13 }}>이 기간 출퇴근 기록이 없습니다.</p>
              ) : (
                <div className="stack stack-2">
                  {data.laborBreakdown.map((u) => {
                    const hasPremium = (u.night_premium ?? 0) > 0
                      || (u.overtime_premium ?? 0) > 0
                      || (u.weekly_rest_pay ?? 0) > 0;
                    return (
                      <div
                        key={u.user_id}
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          background: 'var(--surface-soft)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700 }}>{u.name}</span>
                          <span className="num" style={{ fontWeight: 800, fontSize: 16 }}>
                            {formatCurrency(u.labor)}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                          <span>
                            근무 <span className="num">{formatMinutes(u.minutes)}</span>
                            {isAdmin && (
                              <> · 시급 <span className="num">
                                {u.hourly_wage > 0 ? formatCurrency(u.hourly_wage) + '원' : '미설정'}
                              </span></>
                            )}
                          </span>
                          {isAdmin && <span className="num">기본 {formatCurrency(u.base_cost ?? 0)}</span>}
                        </div>
                        {hasPremium && (
                          <div style={{
                            marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)',
                            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11,
                          }}>
                            <PremiumChip
                              label="야간"
                              mins={u.night_minutes}
                              amount={u.night_premium}
                            />
                            <PremiumChip
                              label="연장"
                              mins={u.overtime_minutes}
                              amount={u.overtime_premium}
                            />
                            <PremiumChip
                              label="주휴"
                              mins={u.weekly_rest_minutes}
                              amount={u.weekly_rest_pay}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div style={{
                    marginTop: 4,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--accent-soft)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent-strong)' }}>합계</span>
                    <span className="num" style={{ fontWeight: 800, fontSize: 18, color: 'var(--accent-strong)' }}>
                      {formatCurrency(data.totalLabor)}<span style={{ fontSize: 12, marginLeft: 2 }}>원</span>
                    </span>
                  </div>
                </div>
              )}

              {isAdmin && data.laborBreakdown.some((u) => u.hourly_wage === 0) && (
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
                      <span className="tag tag-danger" style={{ fontSize: 10 }}>🔒 데이터 변경 차단</span>
                    </div>
                    <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
                      마감 후 이 월의 매출·근태·지출 수정이 자동 차단됩니다.
                      &ldquo;마감 해제&rdquo; 시 잠금이 풀리며 다시 수정 가능합니다.
                    </p>

                    {/* 마감 결재 상태 */}
                    {closingApproval ? (
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          background: closingApproval.status === 'approved'
                            ? 'var(--success-soft)'
                            : closingApproval.status === 'rejected'
                              ? 'var(--danger-soft)'
                              : 'var(--accent-soft)',
                          marginBottom: 12,
                          display: 'flex', alignItems: 'center', gap: 10,
                        }}
                      >
                        {closingApproval.status === 'approved' ? (
                          <FileCheck size={18} color="var(--success)" />
                        ) : closingApproval.status === 'rejected' ? (
                          <X size={18} color="var(--danger)" />
                        ) : (
                          <Clock size={18} color="var(--accent)" />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {closingApproval.status === 'approved' && '마감 결재 완료'}
                            {closingApproval.status === 'pending' && '마감 결재 진행 중'}
                            {closingApproval.status === 'rejected' && '마감 결재 반려'}
                            {closingApproval.status === 'draft' && '마감 결재 임시저장'}
                          </div>
                          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {closingApproval.title}
                          </div>
                        </div>
                        <Link href={`/approvals/${closingApproval.id}`} className="btn btn-ghost btn-sm">
                          상세 →
                        </Link>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 12 }}>
                        <button
                          type="button"
                          className="btn btn-accent btn-block"
                          onClick={() => setShowApprovalDialog(true)}
                          disabled={acting}
                        >
                          <Send size={14} /> 마감 결재 올리기
                        </button>
                        <p className="text-muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                          마감 결재가 승인되면 이 스냅샷이 잠금 상태로 변경되어 더 이상 수정할 수 없습니다.
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={unlockClose}
                      disabled={acting || closingApproval?.status === 'approved'}
                      style={{ color: 'var(--danger)' }}
                    >
                      <Unlock size={14} /> 마감 해제
                    </button>
                    {closingApproval?.status === 'approved' && (
                      <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                        승인된 마감은 해제할 수 없습니다. (회계 정합성)
                      </p>
                    )}
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

      {showApprovalDialog && existingClosing && (
        <SubmitClosingApproval
          closingId={existingClosing.id}
          year={year}
          month={month + 1}
          totalRevenue={data.totalRevenue}
          operatingProfit={data.operatingProfit}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          supabase={supabase}
          onClose={() => setShowApprovalDialog(false)}
          onSaved={async (requestId) => {
            setShowApprovalDialog(false);
            // 마감 스냅샷에 결재 ID 연결
            await safeMutate(supabase
              .from('month_closings')
              .update({ approval_request_id: requestId })
              .eq('id', existingClosing.id));
            await load();
            router.push(`/approvals/${requestId}`);
          }}
        />
      )}
    </>
  );
}

function SubmitClosingApproval({
  closingId, year, month, totalRevenue, operatingProfit, userId, workplaceId, supabase, onClose, onSaved,
}) {
  const [approvers, setApprovers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('memberships')
        .select('user_id, role, profiles!memberships_user_id_fkey(name)')
        .eq('workplace_id', workplaceId)
        .eq('active', true)
        .in('role', ['manager', 'owner'])
        .neq('user_id', userId);
      setCandidates(
        (data ?? []).map((m) => ({ user_id: m.user_id, name: m.profiles?.name || '—', role: m.role }))
      );
    })();
  }, [supabase, workplaceId, userId]);

  function addApprover(uid) {
    if (approvers.some((a) => a.user_id === uid)) return;
    const f = candidates.find((c) => c.user_id === uid);
    if (f) setApprovers((p) => [...p, f]);
  }
  function removeApprover(uid) { setApprovers((p) => p.filter((a) => a.user_id !== uid)); }
  function moveApprover(idx, dir) {
    setApprovers((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function submit() {
    setError(null);
    if (approvers.length === 0) return setError('결재자를 최소 1명 지정해주세요.');
    setSaving(true);
    try {
      const { data: req, error: e1 } = await safeMutate(supabase
        .from('approval_requests')
        .insert({
          workplace_id: workplaceId,
          drafter_id: userId,
          doc_type: 'closing',
          title: `${year}년 ${month}월 월 마감`,
          body: `매출 ${formatCurrency(totalRevenue)}원 / 영업이익 ${formatCurrency(operatingProfit)}원`,
          total_amount: operatingProfit,
          period_year: year,
          period_month: month,
        })
        .select('id')
        .single());
      if (e1) throw e1;
      const requestId = req.id;

      const { error: e2 } = await safeMutate(supabase.from('approval_steps').insert(
        approvers.map((a, i) => ({
          request_id: requestId,
          step_order: i + 1,
          approver_id: a.user_id,
          status: 'waiting',
        }))
      ));
      if (e2) throw e2;

      onSaved(requestId);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">월 마감 결재 올리기</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>기간</div>
        <div className="h3">{year}년 {month}월</div>
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11 }}>매출</div>
            <div className="num" style={{ fontWeight: 700 }}>{formatCurrency(totalRevenue)}원</div>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 11 }}>영업이익</div>
            <div className="num" style={{
              fontWeight: 700,
              color: operatingProfit >= 0 ? 'var(--success)' : 'var(--danger)',
            }}>
              {operatingProfit >= 0 ? '' : '-'}{formatCurrency(Math.abs(operatingProfit))}원
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label className="label">결재자 (순서대로)</label>
        {approvers.length > 0 && (
          <div className="stack stack-2" style={{ marginBottom: 12 }}>
            {approvers.map((a, idx) => (
              <div key={a.user_id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 10, borderRadius: 12, background: 'var(--accent-soft)',
              }}>
                <span className="num" style={{
                  width: 26, height: 26, borderRadius: 999,
                  background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800,
                }}>{idx + 1}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                <span className="tag" style={{ fontSize: 10 }}>{a.role === 'owner' ? '대표' : '매니저'}</span>
                <button type="button" onClick={() => moveApprover(idx, -1)} disabled={idx === 0} className="btn btn-ghost btn-icon">↑</button>
                <button type="button" onClick={() => moveApprover(idx, 1)} disabled={idx === approvers.length - 1} className="btn btn-ghost btn-icon">↓</button>
                <button type="button" onClick={() => removeApprover(a.user_id)} className="btn btn-ghost btn-icon">
                  <X size={14} color="var(--danger)" />
                </button>
              </div>
            ))}
          </div>
        )}

        {candidates.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>같은 사업장의 매니저/대표가 없어요</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {candidates.filter((c) => !approvers.find((a) => a.user_id === c.user_id)).map((c) => (
              <button
                key={c.user_id}
                type="button"
                className="tag tag-accent"
                onClick={() => addApprover(c.user_id)}
                style={{ cursor: 'pointer', border: '1px dashed var(--accent)' }}
              >
                <Plus size={11} /> {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving} style={{ flex: 2 }}>
          <Send size={14} /> {saving ? '제출 중...' : '결재 올리기'}
        </button>
      </div>
    </BottomSheet>
  );
}

const cellHead = { textAlign: 'left', padding: '8px 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' };
const cellHeadR = { ...cellHead, textAlign: 'right' };
const cell = { padding: '10px 6px', fontWeight: 600 };
const cellR = { ...cell, textAlign: 'right' };
const cellTotal = { padding: '10px 6px', fontWeight: 800, color: 'var(--accent)' };
const cellTotalR = { ...cellTotal, textAlign: 'right' };

function PremiumChip({ label, mins, amount }) {
  const has = (amount ?? 0) > 0;
  return (
    <div style={{
      padding: '6px 8px',
      borderRadius: 8,
      background: has ? 'var(--accent-soft)' : 'var(--surface)',
      opacity: has ? 1 : 0.5,
      textAlign: 'center',
    }}>
      <div style={{ fontWeight: 700, fontSize: 10, color: has ? 'var(--accent-strong)' : 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 11, marginTop: 2 }}>
        {formatMinutes(mins ?? 0)}
      </div>
      <div className="num" style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
        +{formatCurrency(amount ?? 0)}
      </div>
    </div>
  );
}

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
