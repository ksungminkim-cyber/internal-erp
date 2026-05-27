'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { formatCurrency } from '@/lib/format';
import { Printer, ChevronLeft } from 'lucide-react';

function ymd(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}.`;
}

function docNumber(id, submittedAt) {
  // 양식 우상단 문서번호: YYYYMMDD-XXXXXX (id 앞 6자리)
  if (!submittedAt) return '';
  const d = new Date(submittedAt);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${id?.slice(0, 6)?.toUpperCase() ?? ''}`;
}

const STEP_STATUS_LABEL = {
  waiting: '대기',
  approved: '승인',
  rejected: '반려',
  skipped: '-',
};

export default function PrintApprovalPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { supabase, currentWorkplace } = useApp();

  const [req, setReq] = useState(null);
  const [items, setItems] = useState([]);
  const [steps, setSteps] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const [{ data: r }, { data: it }, { data: st }, { data: att }] = await Promise.all([
      supabase
        .from('approval_requests')
        .select('*, drafter:profiles!approval_requests_drafter_id_fkey(name, phone), workplaces(name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('expense_items').select('*').eq('request_id', id).order('created_at'),
      supabase
        .from('approval_steps')
        .select('*, approver:profiles!approval_steps_approver_id_fkey(name)')
        .eq('request_id', id)
        .order('step_order'),
      supabase.from('approval_attachments').select('*').eq('request_id', id).order('uploaded_at'),
    ]);
    setReq(r);
    setItems(it ?? []);
    setSteps(st ?? []);
    setAttachments(att ?? []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => { load(); }, [load]);

  // 항목이 5개 미만이면 빈 행으로 채워 양식 일관성 유지 (최소 5행)
  const MIN_ROWS = 5;
  const paddedItems = [...items];
  while (paddedItems.length < MIN_ROWS) paddedItems.push(null);

  // 결재 박스 = 기안자(담당) + 결재선 단계들 — 최대 4칸
  // 첫 칸: 기안자(담당), 마지막 결재자: 대표, 중간: 검토1, 2...
  const APPROVAL_COLS = 4;
  const boxCells = [
    {
      role: '담당',
      name: req?.drafter?.name ?? '',
      status: 'approved',
      decided_at: req?.submitted_at,
      isDrafter: true,
    },
    ...steps.map((s, i) => ({
      role: i === steps.length - 1 ? '대표' : steps.length === 1 ? '대표' : `검토${steps.length > 2 ? i + 1 : ''}`,
      name: s.approver?.name ?? '',
      status: s.status,
      decided_at: s.decided_at,
      isDrafter: false,
    })),
  ];
  while (boxCells.length < APPROVAL_COLS) {
    boxCells.push({ role: '', name: '', status: null, decided_at: null });
  }
  const visibleCells = boxCells.slice(0, APPROVAL_COLS);

  if (loading) {
    return (
      <main className="page-main" style={{ padding: 24 }}>
        <p>불러오는 중...</p>
      </main>
    );
  }
  if (!req) {
    return (
      <main className="page-main" style={{ padding: 24 }}>
        <p>존재하지 않는 문서입니다.</p>
      </main>
    );
  }

  const workplaceName = req.workplaces?.name ?? currentWorkplace?.name ?? '';

  return (
    <>
      {/* 인쇄용 스타일 — 사이드바·헤더·하단탭 모두 숨김 */}
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
          line-height: 1.5;
          letter-spacing: -0.01em;
        }
        .print-table { width: 100%; border-collapse: collapse; }
        .print-table th, .print-table td {
          border: 1px solid #1a1a1a;
          padding: 6px 8px;
          font-size: 12px;
        }
        .print-table th { background: #f3f4f6; font-weight: 700; }
        .print-h1 { font-size: 28px; font-weight: 800; letter-spacing: 0.4em; text-align: center; margin: 12px 0 18px; }
      `}</style>

      {/* 화면 액션 (인쇄시 숨김) */}
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
        <div style={{ flex: 1, fontWeight: 700 }}>지출결의서 — 출력 미리보기</div>
        <button onClick={() => window.print()} className="btn btn-primary">
          <Printer size={16} /> 인쇄 / PDF 저장
        </button>
      </div>

      <main className="page-main" style={{ padding: '20px 16px' }}>
        <div className="print-page">
          {/* 제목 */}
          <h1 className="print-h1">지 출 결 의 서</h1>

          {/* 결재선 박스 (우상단 일반적 배치) */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <table className="print-table" style={{ width: 420 }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 50 }}>결<br />재</th>
                  {visibleCells.map((c, i) => (
                    <th key={i}>{c.role}</th>
                  ))}
                </tr>
                <tr>
                  {visibleCells.map((c, i) => (
                    <th key={i} style={{ fontWeight: 500, fontSize: 10, color: '#555' }}>
                      {c.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ height: 56 }}></td>
                  {visibleCells.map((c, i) => (
                    <td key={i} style={{ textAlign: 'center', verticalAlign: 'middle', height: 56 }}>
                      {c.isDrafter && c.name && (
                        <span style={{
                          display: 'inline-block', padding: '4px 10px',
                          border: '1.5px solid #1d6bdb', color: '#1d6bdb',
                          borderRadius: 4, fontWeight: 800, fontSize: 10,
                          transform: 'rotate(-8deg)',
                        }}>기안</span>
                      )}
                      {!c.isDrafter && c.status === 'approved' && (
                        <span style={{
                          display: 'inline-block', padding: '4px 10px',
                          border: '1.5px solid #c52f3e', color: '#c52f3e',
                          borderRadius: 4, fontWeight: 800, fontSize: 10,
                          transform: 'rotate(-8deg)',
                        }}>승인</span>
                      )}
                      {!c.isDrafter && c.status === 'rejected' && (
                        <span style={{
                          display: 'inline-block', padding: '4px 10px',
                          border: '1.5px solid #999', color: '#999',
                          borderRadius: 4, fontWeight: 800, fontSize: 10,
                          transform: 'rotate(-8deg)',
                        }}>반려</span>
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600, textAlign: 'center', fontSize: 10 }}>일자</td>
                  {visibleCells.map((c, i) => (
                    <td key={i} style={{ textAlign: 'center', fontSize: 10, color: '#555' }}>
                      {c.decided_at ? ymd(c.decided_at) : ''}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* 기본 정보 */}
          <table className="print-table" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <th style={{ width: '15%' }}>문서번호</th>
                <td style={{ width: '35%' }}>{docNumber(req.id, req.submitted_at)}</td>
                <th style={{ width: '15%' }}>기 안 일</th>
                <td style={{ width: '35%' }}>{ymd(req.submitted_at)}</td>
              </tr>
              <tr>
                <th>사 업 장</th>
                <td>{workplaceName}</td>
                <th>기 안 자</th>
                <td>{req.drafter?.name ?? '—'}{req.drafter?.phone ? ` (${req.drafter.phone})` : ''}</td>
              </tr>
              <tr>
                <th>제 목</th>
                <td colSpan={3} style={{ fontWeight: 700 }}>{req.title}</td>
              </tr>
            </tbody>
          </table>

          {/* 지출 내역 */}
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>● 지출 내역</div>
          <table className="print-table" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>No</th>
                <th>적요(품목)</th>
                <th style={{ width: 90 }}>카테고리</th>
                <th style={{ width: 130 }}>거래처</th>
                <th style={{ width: 110 }}>금액(원)</th>
              </tr>
            </thead>
            <tbody>
              {paddedItems.map((it, idx) => (
                <tr key={idx} style={{ height: 28 }}>
                  <td style={{ textAlign: 'center' }}>{it ? idx + 1 : ''}</td>
                  <td>
                    {it?.description ?? ''}
                    {it?.product_url && (
                      <div style={{ fontSize: 9, color: '#666', marginTop: 2, wordBreak: 'break-all' }}>
                        🔗 {it.product_url}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{it?.category ?? ''}</td>
                  <td>{it?.vendor ?? ''}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {it ? formatCurrency(it.amount) : ''}
                  </td>
                </tr>
              ))}
              <tr style={{ background: '#f9fafb' }}>
                <td colSpan={4} style={{ textAlign: 'center', fontWeight: 800 }}>합 계</td>
                <td style={{ textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(req.total_amount)}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 사유 / 본문 */}
          {req.body && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>● 지출 사유 / 비고</div>
              <table className="print-table" style={{ marginBottom: 14 }}>
                <tbody>
                  <tr>
                    <td style={{ minHeight: 60, padding: 10, whiteSpace: 'pre-wrap' }}>
                      {req.body}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}

          {/* 첨부 */}
          {attachments.length > 0 && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>● 첨부</div>
              <table className="print-table" style={{ marginBottom: 14 }}>
                <tbody>
                  {attachments.map((a, i) => (
                    <tr key={a.id}>
                      <td style={{ width: 40, textAlign: 'center' }}>{i + 1}</td>
                      <td>{a.file_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* 결재 이력 (상세) */}
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>● 결재 이력</div>
          <table className="print-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>순번</th>
                <th>결재자</th>
                <th style={{ width: 80 }}>상태</th>
                <th style={{ width: 130 }}>결재일시</th>
                <th>코멘트</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id}>
                  <td style={{ textAlign: 'center' }}>{s.step_order}</td>
                  <td>{s.approver?.name ?? '—'}</td>
                  <td style={{ textAlign: 'center' }}>{STEP_STATUS_LABEL[s.status] || s.status}</td>
                  <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    {s.decided_at ? new Date(s.decided_at).toLocaleString('ko-KR', { hour12: false }) : ''}
                  </td>
                  <td>{s.comment ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ marginTop: 18, fontSize: 11, color: '#666', textAlign: 'right' }}>
            ※ 본 문서는 사내 ERP에서 자동 생성된 지출결의서입니다.
          </p>
        </div>
      </main>
    </>
  );
}
