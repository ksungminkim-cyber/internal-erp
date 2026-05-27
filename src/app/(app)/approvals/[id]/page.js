'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatDateTime, formatCurrency } from '@/lib/format';
import { CheckCircle2, XCircle, Clock, ChevronLeft, Paperclip, Download, Sparkles, Printer } from 'lucide-react';

const STATUS_META = {
  pending:   { label: '진행 중',   tag: 'tag-warning',  icon: Clock },
  approved:  { label: '최종 승인', tag: 'tag-success',  icon: CheckCircle2 },
  rejected:  { label: '반려',      tag: 'tag-danger',   icon: XCircle },
  cancelled: { label: '취소',      tag: 'tag',          icon: XCircle },
};

const STEP_META = {
  waiting:  { label: '대기',   tag: 'tag' },
  approved: { label: '승인',   tag: 'tag-success' },
  rejected: { label: '반려',   tag: 'tag-danger' },
  skipped:  { label: '건너뜀', tag: 'tag' },
};

export default function ApprovalDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, supabase } = useApp();

  const [req, setReq] = useState(null);
  const [items, setItems] = useState([]);
  const [steps, setSteps] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [comment, setComment] = useState('');
  const [acting, setActing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: r }, { data: it }, { data: st }, { data: att }, { data: sh }] = await Promise.all([
      supabase
        .from('approval_requests')
        .select('*, drafter:profiles!approval_requests_drafter_id_fkey(name, phone)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('expense_items').select('*').eq('request_id', id).order('created_at'),
      supabase
        .from('approval_steps')
        .select('*, approver:profiles!approval_steps_approver_id_fkey(name)')
        .eq('request_id', id)
        .order('step_order'),
      supabase.from('approval_attachments').select('*').eq('request_id', id).order('uploaded_at'),
      supabase
        .from('shifts')
        .select('*, user:profiles!shifts_user_id_fkey(name)')
        .eq('approval_request_id', id)
        .order('start_at'),
    ]);
    setReq(r);
    setItems(it ?? []);
    setSteps(st ?? []);
    setAttachments(att ?? []);
    setShifts(sh ?? []);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`approval:${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approval_steps', filter: `request_id=eq.${id}` },
        () => load()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests', filter: `id=eq.${id}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, id, load]);

  async function decide(stepId, decision) {
    setActing(true);
    setError(null);
    const { error } = await supabase
      .from('approval_steps')
      .update({ status: decision, comment: comment.trim() || null })
      .eq('id', stepId);
    if (error) setError(error.message);
    else setComment('');
    setActing(false);
  }

  async function cancelRequest() {
    if (!confirm('이 기안을 취소하시겠습니까?')) return;
    setActing(true);
    const { error } = await supabase
      .from('approval_requests')
      .update({ status: 'cancelled', decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) setError(error.message);
    setActing(false);
  }

  async function downloadAttachment(att) {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(att.file_path, 60);
    if (error) return alert('다운로드 실패: ' + error.message);
    window.open(data.signedUrl, '_blank');
  }

  if (loading) {
    return (
      <>
        <PageHeader
          title="결재 상세"
          hideSwitcher
          action={
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
              <ChevronLeft size={20} />
            </button>
          }
        />
        <main className="section stack stack-3">
          <div className="skeleton" style={{ height: 140 }} />
          <div className="skeleton" style={{ height: 200 }} />
        </main>
      </>
    );
  }

  if (!req) {
    return (
      <main className="section">
        <div className="card empty">
          <div className="empty-icon"><Sparkles size={28} /></div>
          <div className="empty-title">존재하지 않는 문서</div>
        </div>
      </main>
    );
  }

  const meta = STATUS_META[req.status];
  const StatusIcon = meta.icon;
  const myStep = steps.find((s) => s.step_order === req.current_step && s.approver_id === user?.id && s.status === 'waiting');
  const canAct = req.status === 'pending' && !!myStep;
  const canCancel = req.status === 'pending' && req.drafter_id === user?.id;

  return (
    <>
      <PageHeader
        title="결재 상세"
        hideSwitcher
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {req.doc_type !== 'schedule' && (
              <Link href={`/approvals/${id}/print`} className="btn btn-soft btn-sm">
                <Printer size={14} /> 출력
              </Link>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
              <ChevronLeft size={20} />
            </button>
          </div>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 헤더 카드 */}
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Avatar name={req.drafter?.name} userId={req.drafter_id} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="h4" style={{ color: 'var(--text)' }}>{req.drafter?.name || '—'}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{formatDateTime(req.submitted_at)}</div>
            </div>
            <span className={`tag ${meta.tag} lg dot`}>
              <StatusIcon size={11} /> {meta.label}
            </span>
          </div>
          <h1 className="h2">{req.title}</h1>
          {req.body && (
            <p style={{ marginTop: 12, fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {req.body}
            </p>
          )}
        </section>

        {/* 결재 종류별 본문 — schedule이면 시프트 목록, expense면 지출 항목 */}
        {req.doc_type === 'schedule' ? (
          <section className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>
              {req.period_year}년 {req.period_month}월 시프트
            </h2>
            {shifts.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>묶인 시프트가 없습니다.</p>
            ) : (
              <>
                <p className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  총 {shifts.length}개 시프트
                </p>
                <div className="stack stack-2">
                  {shifts.map((s) => {
                    const d = new Date(s.start_at);
                    const e = new Date(s.end_at);
                    const dayStr = d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' });
                    const startStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
                    const endStr = e.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
                    return (
                      <div key={s.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: 10, background: 'var(--surface-soft)', borderRadius: 10,
                      }}>
                        <span className="num" style={{ width: 60, fontSize: 13, fontWeight: 700 }}>{dayStr}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.user?.name || '—'}</span>
                        <span className="num text-muted" style={{ fontSize: 12 }}>{startStr} - {endStr}</span>
                        {s.role_label && <span className="tag" style={{ fontSize: 10 }}>{s.role_label}</span>}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        ) : (
          <section className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>지출 항목</h2>
            <div className="stack stack-2">
              {items.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex', gap: 12, padding: 14,
                    background: 'var(--surface-soft)', borderRadius: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="h4" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span>{it.description}</span>
                      {it.product_url && (
                        <a
                          href={it.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tag tag-accent"
                          style={{ fontSize: 10, textDecoration: 'none' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          🔗 구매하기
                        </a>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      <span className="tag" style={{ marginRight: 6 }}>{it.category}</span>
                      {it.vendor}
                    </div>
                  </div>
                  <span className="num" style={{ fontWeight: 700, fontSize: 15, alignSelf: 'center' }}>
                    {formatCurrency(it.amount)}원
                  </span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 14, padding: '16px 18px',
                background: 'var(--accent-soft)', borderRadius: 14,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, color: 'var(--accent-strong)' }}>합계</span>
              <span className="num" style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent-strong)' }}>
                {formatCurrency(req.total_amount)}<span style={{ fontSize: 14, marginLeft: 2 }}>원</span>
              </span>
            </div>
          </section>
        )}

        {/* 첨부 */}
        {attachments.length > 0 && (
          <section className="card">
            <h2 className="h3" style={{ marginBottom: 12 }}>첨부 파일</h2>
            <div className="stack stack-2">
              {attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => downloadAttachment(a)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 12, background: 'var(--surface-soft)', borderRadius: 12,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    transition: 'all var(--t-sm) var(--ease)',
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: 'var(--accent-soft)', color: 'var(--accent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Paperclip size={16} />
                  </div>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{a.file_name}</span>
                  <Download size={14} className="text-muted" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 결재선 */}
        <section className="card">
          <h2 className="h3" style={{ marginBottom: 12 }}>결재선</h2>
          <div className="stack stack-2">
            {steps.map((s) => {
              const sm = STEP_META[s.status];
              const isCurrent = req.status === 'pending' && s.step_order === req.current_step;
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 12, borderRadius: 12,
                    background: isCurrent ? 'var(--accent-soft)' : 'var(--surface-soft)',
                    border: isCurrent ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                    transition: 'all var(--t-sm) var(--ease)',
                  }}
                >
                  <span
                    className="num"
                    style={{
                      width: 28, height: 28, borderRadius: 999,
                      background: isCurrent ? 'var(--accent)' :
                                  s.status === 'approved' ? 'var(--success)' :
                                  s.status === 'rejected' ? 'var(--danger)' : 'var(--surface)',
                      color: s.status === 'waiting' && !isCurrent ? 'var(--text-muted)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800,
                    }}
                  >
                    {s.step_order}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="h4" style={{ fontSize: 14 }}>{s.approver?.name || '—'}</div>
                    {s.comment && (
                      <div className="text-secondary" style={{ fontSize: 12, marginTop: 2 }}>“{s.comment}”</div>
                    )}
                    {s.decided_at && (
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {formatDateTime(s.decided_at)}
                      </div>
                    )}
                  </div>
                  <span className={`tag ${sm.tag}`}>{sm.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* 내 차례 액션 */}
        {canAct && (
          <section
            className="card pop-in"
            style={{
              background: 'var(--accent-soft)',
              border: '1.5px solid var(--accent)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Sparkles size={16} color="var(--accent-strong)" />
              <span className="h4" style={{ color: 'var(--accent-strong)' }}>내 차례입니다</span>
            </div>

            <label className="label">코멘트 (선택)</label>
            <textarea
              className="input"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="승인/반려 의견을 남겨주세요"
              style={{ resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" className="btn btn-danger btn-lg" onClick={() => decide(myStep.id, 'rejected')} disabled={acting} style={{ flex: 1 }}>
                <XCircle size={16} /> 반려
              </button>
              <button type="button" className="btn btn-success btn-lg" onClick={() => decide(myStep.id, 'approved')} disabled={acting} style={{ flex: 2 }}>
                <CheckCircle2 size={16} /> 승인
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
                {error}
              </div>
            )}
          </section>
        )}

        {canCancel && (
          <button type="button" className="btn btn-outline btn-lg" onClick={cancelRequest} disabled={acting} style={{ color: 'var(--danger)' }}>
            기안 취소
          </button>
        )}
      </main>
    </>
  );
}
