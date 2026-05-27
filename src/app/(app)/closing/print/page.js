'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { formatCurrency } from '@/lib/format';
import { Printer, ChevronLeft } from 'lucide-react';

// 카테고리 → 회계분류 매핑 (closing/page.js 와 동일 — 스냅샷에서 재구성용)
function getCategoryKind(cat) {
  if (['식자재', '음료/시럽', '주류'].includes(cat)) return 'cogs';
  if (['전기', '수도', '가스', '통신', '임차료', '보험·세금', '공과잡비'].includes(cat)) return 'utilities';
  return 'opex';
}

function ymd(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}.`;
}

export default function ClosingPrintPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { supabase, currentWorkplaceId, currentWorkplace } = useApp();

  const year = parseInt(sp.get('year') ?? String(new Date().getFullYear()), 10);
  const month = parseInt(sp.get('month') ?? String(new Date().getMonth() + 1), 10);

  const [closing, setClosing] = useState(null);
  const [approval, setApproval] = useState(null);
  const [steps, setSteps] = useState([]);
  const [closedBy, setClosedBy] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const { data: c } = await supabase
      .from('month_closings')
      .select('*, closed_by_profile:profiles!month_closings_closed_by_fkey(name)')
      .eq('workplace_id', currentWorkplaceId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();

    if (!c) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setClosing(c);
    setClosedBy(c.closed_by_profile?.name ?? null);

    if (c.approval_request_id) {
      const [{ data: appr }, { data: st }] = await Promise.all([
        supabase
          .from('approval_requests')
          .select('*, drafter:profiles!approval_requests_drafter_id_fkey(name)')
          .eq('id', c.approval_request_id)
          .maybeSingle(),
        supabase
          .from('approval_steps')
          .select('*, approver:profiles!approval_steps_approver_id_fkey(name)')
          .eq('request_id', c.approval_request_id)
          .order('step_order'),
      ]);
      setApproval(appr ?? null);
      setSteps(st ?? []);
    } else {
      setApproval(null);
      setSteps([]);
    }
    setLoading(false);
  }, [supabase, currentWorkplaceId, year, month]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <main className="page-main" style={{ padding: 24 }}><p>불러오는 중...</p></main>;
  }

  if (notFound || !closing) {
    return (
      <main className="page-main" style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ marginBottom: 12 }}>{year}년 {month}월 마감 스냅샷이 없습니다.</p>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
          월 마감 페이지에서 먼저 마감을 확정해주세요.
        </p>
        <button onClick={() => router.back()} className="btn btn-primary">뒤로 가기</button>
      </main>
    );
  }

  const workplaceName = currentWorkplace?.name ?? '';
  const totalRevenue = Number(closing.total_revenue);
  const totalLabor = Number(closing.total_labor);
  const expBd = closing.expense_breakdown || [];
  const laborBd = closing.labor_breakdown || [];

  // 회계 분류별 재구성
  const byKind = { cogs: 0, opex: 0, utilities: 0 };
  expBd.forEach((e) => {
    const k = getCategoryKind(e.category);
    byKind[k] = (byKind[k] ?? 0) + Number(e.amount || 0);
  });
  const grossProfit = totalRevenue - byKind.cogs;
  const operatingProfit = grossProfit - totalLabor - byKind.opex - byKind.utilities;
  const profitRate = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0;

  // 결재선 박스 = 기안자(담당) + 결재자들 — 최대 4칸
  const APPROVAL_COLS = 4;
  const boxCells = approval
    ? [
        { role: '담당', name: approval.drafter?.name ?? closedBy ?? '', status: 'approved', decided_at: approval.submitted_at, isDrafter: true },
        ...steps.map((s, i) => ({
          role: i === steps.length - 1 ? '대표' : steps.length === 1 ? '대표' : `검토${steps.length > 2 ? i + 1 : ''}`,
          name: s.approver?.name ?? '',
          status: s.status,
          decided_at: s.decided_at,
        })),
      ]
    : [{ role: '담당', name: closedBy ?? '', status: 'approved', decided_at: closing.closed_at, isDrafter: true }];

  while (boxCells.length < APPROVAL_COLS) {
    boxCells.push({ role: '', name: '', status: null, decided_at: null });
  }
  const visibleCells = boxCells.slice(0, APPROVAL_COLS);

  return (
    <>
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm 14mm 14mm 14mm; }
          html, body { background: #fff !important; }
          .sidebar, .bottom-nav, .page-header, .print-actions { display: none !important; }
          .app-shell { padding: 0 !important; padding-left: 0 !important; }
          .print-page { box-shadow: none !important; border: none !important; padding: 0 !important; }
        }
        .print-page {
          background: #fff;
          color: #000;
          max-width: 210mm;
          margin: 0 auto;
          padding: 24px 28px;
          border: 1px solid var(--border);
          border-radius: 8px;
          font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.55;
          letter-spacing: -0.01em;
        }
        .print-table { width: 100%; border-collapse: collapse; }
        .print-table th, .print-table td {
          border: 1px solid #1a1a1a;
          padding: 7px 9px;
          font-size: 12px;
        }
        .print-table th { background: #f3f4f6; font-weight: 700; }
        .print-h1 { font-size: 28px; font-weight: 800; letter-spacing: 0.4em; text-align: center; margin: 12px 0 18px; }
        .pl-row { display: flex; justify-content: space-between; padding: 8px 6px; border-bottom: 1px dotted #cbd5e1; font-size: 13px; }
        .pl-row .label { font-weight: 600; }
        .pl-row .val { font-variant-numeric: tabular-nums; font-weight: 600; }
        .pl-row.indent .label { padding-left: 18px; color: #475569; font-weight: 500; font-size: 12px; }
        .pl-row.indent .val { color: #475569; font-size: 12px; }
        .pl-row.subtotal { border-bottom: 1px solid #1a1a1a; font-weight: 700; padding: 10px 6px; }
        .pl-row.total { border-top: 2px solid #1a1a1a; border-bottom: 3px double #1a1a1a; padding: 12px 6px; font-size: 16px; font-weight: 800; margin-top: 4px; }
      `}</style>

      <div className="print-actions" style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--bg)',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
          <ChevronLeft size={20} />
        </button>
        <div style={{ flex: 1, fontWeight: 700 }}>{year}년 {month}월 손익계산서 — 출력 미리보기</div>
        <button onClick={() => window.print()} className="btn btn-primary">
          <Printer size={16} /> 인쇄 / PDF 저장
        </button>
      </div>

      <main className="page-main" style={{ padding: '20px 16px' }}>
        <div className="print-page">
          {/* 제목 */}
          <h1 className="print-h1">월 별 손 익 계 산 서</h1>

          {/* 결재선 박스 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <table className="print-table" style={{ width: 'auto' }}>
              <tbody>
                <tr>
                  {visibleCells.map((c, i) => (
                    <th key={i} style={{ width: 70, padding: '4px 8px', fontSize: 11 }}>{c.role || ' '}</th>
                  ))}
                </tr>
                <tr>
                  {visibleCells.map((c, i) => (
                    <td key={i} style={{ width: 70, height: 56, textAlign: 'center', verticalAlign: 'middle' }}>
                      {c.status === 'approved' && c.name ? (
                        <div style={{
                          color: '#dc2626',
                          fontWeight: 700,
                          fontSize: 11,
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}>
                          <span style={{
                            border: '1.5px solid #dc2626',
                            borderRadius: '50%',
                            padding: '3px 6px',
                            fontSize: 9,
                          }}>{c.isDrafter ? '기안' : '승인'}</span>
                          <span style={{ color: '#000', fontSize: 11 }}>{c.name}</span>
                        </div>
                      ) : c.name ? (
                        <span style={{ fontSize: 11 }}>{c.name}</span>
                      ) : (
                        ''
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 기본 정보 */}
          <table className="print-table" style={{ marginBottom: 16 }}>
            <tbody>
              <tr>
                <th style={{ width: '15%' }}>사업장</th>
                <td style={{ width: '35%' }}>{workplaceName}</td>
                <th style={{ width: '15%' }}>대상 기간</th>
                <td style={{ width: '35%' }}>{year}년 {month}월</td>
              </tr>
              <tr>
                <th>마감 확정일</th>
                <td>{ymd(closing.closed_at)}</td>
                <th>마감 담당</th>
                <td>{closedBy ?? '—'}</td>
              </tr>
              {approval && (
                <tr>
                  <th>결재 문서</th>
                  <td colSpan={3}>
                    {approval.title} ({approval.status === 'approved' ? '승인' : approval.status === 'rejected' ? '반려' : approval.status === 'pending' ? '진행 중' : '임시'})
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 손익계산서 본문 */}
          <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 8, paddingBottom: 4, borderBottom: '2px solid #1a1a1a' }}>
            손익계산서
          </h2>

          <div style={{ marginBottom: 16 }}>
            <div className="pl-row">
              <span className="label">Ⅰ. 매출</span>
              <span className="val">{formatCurrency(totalRevenue)} 원</span>
            </div>

            <div className="pl-row">
              <span className="label">Ⅱ. 매출원가</span>
              <span className="val">({formatCurrency(byKind.cogs)}) 원</span>
            </div>
            {expBd.filter((e) => getCategoryKind(e.category) === 'cogs').map((e) => (
              <div key={`c-${e.category}`} className="pl-row indent">
                <span className="label">· {e.category}</span>
                <span className="val">{formatCurrency(e.amount)} 원</span>
              </div>
            ))}

            <div className="pl-row subtotal">
              <span className="label">Ⅲ. 매출총이익 (Ⅰ - Ⅱ)</span>
              <span className="val" style={{ color: grossProfit >= 0 ? '#000' : '#dc2626' }}>
                {grossProfit < 0 ? '-' : ''}{formatCurrency(Math.abs(grossProfit))} 원
              </span>
            </div>

            <div className="pl-row" style={{ marginTop: 6 }}>
              <span className="label">Ⅳ. 판매비와 관리비</span>
              <span className="val">({formatCurrency(totalLabor + byKind.opex + byKind.utilities)}) 원</span>
            </div>
            <div className="pl-row indent">
              <span className="label">1. 인건비</span>
              <span className="val">{formatCurrency(totalLabor)} 원</span>
            </div>
            <div className="pl-row indent">
              <span className="label">2. 일반관리비 — 비품 · 소모품 · 수리 · 마케팅 · 교육복리</span>
              <span className="val">{formatCurrency(byKind.opex)} 원</span>
            </div>
            {expBd.filter((e) => getCategoryKind(e.category) === 'opex').map((e) => (
              <div key={`o-${e.category}`} className="pl-row indent" style={{ paddingLeft: 24 }}>
                <span className="label" style={{ paddingLeft: 28 }}>· {e.category}</span>
                <span className="val">{formatCurrency(e.amount)} 원</span>
              </div>
            ))}
            <div className="pl-row indent">
              <span className="label">3. 공과잡비 — 전기 · 수도 · 가스 · 통신 · 임차료 · 보험 · 세금</span>
              <span className="val">{formatCurrency(byKind.utilities)} 원</span>
            </div>
            {expBd.filter((e) => getCategoryKind(e.category) === 'utilities').map((e) => (
              <div key={`u-${e.category}`} className="pl-row indent" style={{ paddingLeft: 24 }}>
                <span className="label" style={{ paddingLeft: 28 }}>· {e.category}</span>
                <span className="val">{formatCurrency(e.amount)} 원</span>
              </div>
            ))}

            <div className="pl-row total">
              <span className="label">Ⅴ. 영업이익 (Ⅲ - Ⅳ)</span>
              <span className="val" style={{ color: operatingProfit >= 0 ? '#16a34a' : '#dc2626' }}>
                {operatingProfit < 0 ? '-' : ''}{formatCurrency(Math.abs(operatingProfit))} 원
              </span>
            </div>

            <div style={{ textAlign: 'right', fontSize: 11, color: '#475569', marginTop: 6 }}>
              영업이익률 : {profitRate.toFixed(1)}%
            </div>
          </div>

          {/* 직원별 인건비 명세 */}
          {laborBd.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 800, marginTop: 18, marginBottom: 6 }}>
                ① 인건비 명세 <span style={{ fontWeight: 500, fontSize: 11, color: '#475569' }}>
                  (근로기준법 — 야간 +50% / 연장 +50% / 주휴 비례)
                </span>
              </h3>
              <table className="print-table" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th style={{ width: '18%' }}>직원</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>근무</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>시급</th>
                    <th style={{ width: '12%', textAlign: 'right' }}>기본</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>야간</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>연장</th>
                    <th style={{ width: '11%', textAlign: 'right' }}>주휴</th>
                    <th style={{ width: '13%', textAlign: 'right' }}>인건비</th>
                  </tr>
                </thead>
                <tbody>
                  {laborBd.map((u, i) => (
                    <tr key={i}>
                      <td>{u.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        {Math.floor((u.minutes ?? 0) / 60)}h {(u.minutes ?? 0) % 60}m
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {(u.hourly_wage ?? 0) > 0 ? `${formatCurrency(u.hourly_wage)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(u.base_cost ?? 0)}</td>
                      <td style={{ textAlign: 'right', color: (u.night_premium ?? 0) > 0 ? '#000' : '#94a3b8' }}>
                        {(u.night_premium ?? 0) > 0 ? `+${formatCurrency(u.night_premium)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: (u.overtime_premium ?? 0) > 0 ? '#000' : '#94a3b8' }}>
                        {(u.overtime_premium ?? 0) > 0 ? `+${formatCurrency(u.overtime_premium)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', color: (u.weekly_rest_pay ?? 0) > 0 ? '#000' : '#94a3b8' }}>
                        {(u.weekly_rest_pay ?? 0) > 0 ? `+${formatCurrency(u.weekly_rest_pay)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>
                        {formatCurrency(u.labor ?? 0)} 원
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700, background: '#f3f4f6' }}>합계</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, background: '#f3f4f6' }}>
                      {formatCurrency(totalLabor)} 원
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* 카테고리별 지출 */}
          {expBd.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 800, marginTop: 6, marginBottom: 6 }}>② 카테고리별 지출 명세</h3>
              <table className="print-table" style={{ marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>분류</th>
                    <th style={{ width: '40%' }}>카테고리</th>
                    <th style={{ width: '20%', textAlign: 'right' }}>금액</th>
                    <th style={{ width: '20%', textAlign: 'right' }}>비중</th>
                  </tr>
                </thead>
                <tbody>
                  {expBd.map((e, i) => {
                    const kind = getCategoryKind(e.category);
                    const kindLabel = kind === 'cogs' ? '매출원가' : kind === 'opex' ? '일반관리비' : '공과잡비';
                    const pct = closing.total_expense > 0 ? (Number(e.amount) / Number(closing.total_expense)) * 100 : 0;
                    return (
                      <tr key={i}>
                        <td>{kindLabel}</td>
                        <td>{e.category}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(e.amount)} 원</td>
                        <td style={{ textAlign: 'right' }}>{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700, background: '#f3f4f6' }}>합계</td>
                    <td style={{ textAlign: 'right', fontWeight: 800, background: '#f3f4f6' }}>
                      {formatCurrency(closing.total_expense)} 원
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, background: '#f3f4f6' }}>100.0%</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* 푸터 */}
          <div style={{ marginTop: 28, paddingTop: 12, borderTop: '1px solid #1a1a1a', fontSize: 11, color: '#475569', textAlign: 'center' }}>
            본 손익계산서는 사업장 내부 관리용 자료이며, 회계 결산 자료와는 차이가 있을 수 있습니다.
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#475569', textAlign: 'right' }}>
            출력일자: {ymd(new Date().toISOString())}
          </div>
        </div>
      </main>
    </>
  );
}
