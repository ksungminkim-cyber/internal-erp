'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { getApproverCandidates } from '../actions';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { Plus, Trash2, X, ChevronDown, ChevronLeft } from 'lucide-react';

// 카테고리 → 회계 분류 (kind) 자동 매핑
const EXPENSE_CATEGORIES = [
  // 매출원가 (cogs)
  { value: '식자재',     kind: 'cogs',      group: '매출원가' },
  { value: '음료/시럽',  kind: 'cogs',      group: '매출원가' },
  { value: '주류',       kind: 'cogs',      group: '매출원가' },
  // 일반관리비 (opex)
  { value: '비품',       kind: 'opex',      group: '일반관리비' },
  { value: '소모품',     kind: 'opex',      group: '일반관리비' },
  { value: '수리/유지',  kind: 'opex',      group: '일반관리비' },
  { value: '마케팅',     kind: 'opex',      group: '일반관리비' },
  { value: '교육·복리',  kind: 'opex',      group: '일반관리비' },
  // 공과잡비 (utilities)
  { value: '전기',       kind: 'utilities', group: '공과잡비' },
  { value: '수도',       kind: 'utilities', group: '공과잡비' },
  { value: '가스',       kind: 'utilities', group: '공과잡비' },
  { value: '통신',       kind: 'utilities', group: '공과잡비' },
  { value: '임차료',     kind: 'utilities', group: '공과잡비' },
  { value: '보험·세금',  kind: 'utilities', group: '공과잡비' },
  // 기타
  { value: '기타',       kind: 'opex',      group: '일반관리비' },
];

function getKindByCategory(cat) {
  return EXPENSE_CATEGORIES.find((c) => c.value === cat)?.kind ?? 'opex';
}

export default function NewApprovalPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const revisionOfId = searchParams.get('revision_of');
  const { user, profile, currentWorkplaceId, supabase } = useApp();
  const drafterIsExec = profile?.is_executive === true;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [items, setItems] = useState([{ description: '', category: '식자재', amount: '', vendor: '', product_url: '' }]);
  const [approvers, setApprovers] = useState([]);
  const [coworkers, setCoworkers] = useState([]);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [revisionInfo, setRevisionInfo] = useState(null);

  // 재기안 모드: 이전 결재 데이터 미리 채우기
  useEffect(() => {
    if (!revisionOfId || !user) return;
    (async () => {
      const { data: prev } = await supabase
        .from('approval_requests')
        .select('id, title, body, total_amount, revision_count, expense_items(*)')
        .eq('id', revisionOfId)
        .maybeSingle();
      if (prev) {
        setTitle(prev.title || '');
        setBody(prev.body || '');
        if (prev.expense_items?.length) {
          setItems(prev.expense_items.map((it) => ({
            description: it.description || '',
            category: it.category || '식자재',
            amount: String(it.amount ?? ''),
            vendor: it.vendor || '',
            product_url: it.product_url || '',
          })));
        }
        setRevisionInfo({
          id: prev.id,
          count: (prev.revision_count ?? 0) + 1,
        });
      }
    })();
  }, [revisionOfId, user, supabase]);

  const total = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentWorkplaceId || !user) return;
      // 서버 액션으로 결재자 후보 조회 (서비스 롤 — 본사 직원 프로필 RLS 우회)
      try {
        const list = await getApproverCandidates(currentWorkplaceId);
        if (!cancelled) setCoworkers(list);
      } catch (e) {
        if (!cancelled) setCoworkers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentWorkplaceId, user]);

  function updateItem(idx, key, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));
  }
  function addItem() { setItems((prev) => [...prev, { description: '', category: '식자재', amount: '', vendor: '', product_url: '' }]); }
  function removeItem(idx) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
  function addApprover(uid) {
    if (approvers.some((a) => a.user_id === uid)) return;
    const found = coworkers.find((c) => c.user_id === uid);
    if (found) setApprovers((prev) => [...prev, found]);
  }
  function removeApprover(uid) { setApprovers((prev) => prev.filter((a) => a.user_id !== uid)); }
  function moveApprover(idx, dir) {
    setApprovers((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('제목을 입력해주세요.');
    if (items.some((it) => !it.description.trim() || !it.amount)) return setError('항목을 모두 입력해주세요.');
    if (approvers.length === 0) return setError('결재자를 최소 1명 지정해주세요.');
    if (!drafterIsExec && !approvers[approvers.length - 1].isExecutive) {
      return setError('결재선의 마지막 단계는 임원(본사 대표)이어야 합니다.');
    }

    setSubmitting(true);
    try {
      const { data: req, error: e1 } = await supabase
        .from('approval_requests')
        .insert({
          workplace_id: currentWorkplaceId,
          drafter_id: user.id,
          doc_type: 'expense',
          title: title.trim(),
          body: body.trim() || null,
          total_amount: total,
          revision_of: revisionInfo?.id ?? null,
          revision_count: revisionInfo?.count ?? 0,
        })
        .select('id')
        .single();
      if (e1) throw e1;
      const requestId = req.id;

      const { error: e2 } = await supabase.from('expense_items').insert(
        items.map((it) => ({
          request_id: requestId,
          description: it.description.trim(),
          category: it.category,
          amount: parseFloat(it.amount) || 0,
          vendor: it.vendor.trim() || null,
          product_url: it.product_url?.trim() || null,
          kind: getKindByCategory(it.category),
        }))
      );
      if (e2) throw e2;

      const { error: e3 } = await supabase.from('approval_steps').insert(
        approvers.map((a, i) => ({
          request_id: requestId,
          step_order: i + 1,
          approver_id: a.user_id,
          status: 'waiting',
        }))
      );
      if (e3) throw e3;

      for (const f of files) {
        const path = `${currentWorkplaceId}/${requestId}/${Date.now()}_${f.name}`;
        const { error: upErr } = await supabase.storage.from('receipts').upload(path, f, { contentType: f.type });
        if (upErr) { console.warn('upload failed', upErr); continue; }
        await supabase.from('approval_attachments').insert({
          request_id: requestId, file_path: path, file_name: f.name,
          mime_type: f.type, size_bytes: f.size, uploaded_by: user.id,
        });
      }

      router.replace(`/approvals/${requestId}`);
    } catch (err) {
      setError(err.message ?? '제출 실패');
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={revisionInfo ? `재기안 (${revisionInfo.count}회차)` : '새 기안'}
        subtitle={revisionInfo ? '반려된 내용을 수정해 다시 결재 올리기' : '지출결의서를 작성해요'}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
            <ChevronLeft size={20} />
          </button>
        }
      />

      <form onSubmit={submit} className="fade-in" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section className="card">
          <label className="label">제목</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 5월 4주차 식자재 발주" required />

          <label className="label" style={{ marginTop: 16 }}>본문 (선택)</label>
          <textarea
            className="input"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="배경·사유 등"
            style={{ resize: 'vertical' }}
          />
        </section>

        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="h3">지출 항목</h2>
            <button type="button" className="btn btn-soft btn-sm" onClick={addItem}>
              <Plus size={14} /> 항목 추가
            </button>
          </div>

          <div className="stack stack-3">
            {items.map((it, idx) => (
              <div
                key={idx}
                style={{
                  padding: 14,
                  background: 'var(--surface-soft)',
                  borderRadius: 14,
                  display: 'flex', flexDirection: 'column', gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className="tag tag-accent">#{idx + 1}</span>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(idx)} className="btn btn-ghost btn-icon" style={{ marginLeft: 'auto' }}>
                      <Trash2 size={14} color="var(--danger)" />
                    </button>
                  )}
                </div>
                <input className="input" placeholder="품목 / 내역" value={it.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select className="input" value={it.category} onChange={(e) => updateItem(idx, 'category', e.target.value)}>
                    {['매출원가', '일반관리비', '공과잡비'].map((g) => (
                      <optgroup key={g} label={g}>
                        {EXPENSE_CATEGORIES.filter((c) => c.group === g).map((c) => (
                          <option key={c.value} value={c.value}>{c.value}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <input className="input" type="number" inputMode="numeric" placeholder="금액 (원)" value={it.amount} onChange={(e) => updateItem(idx, 'amount', e.target.value)} />
                </div>
                <input className="input" placeholder="거래처 (선택)" value={it.vendor} onChange={(e) => updateItem(idx, 'vendor', e.target.value)} />
                <input className="input" type="url" placeholder="구매처 URL (재발주 시 바로가기)" value={it.product_url} onChange={(e) => updateItem(idx, 'product_url', e.target.value)} style={{ marginTop: 8 }} />
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 16, padding: '16px 18px',
              background: 'var(--accent-soft)',
              borderRadius: 16,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--accent-strong)' }}>합계</span>
            <span className="num" style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent-strong)' }}>
              {formatCurrency(total)}<span style={{ fontSize: 14, marginLeft: 2 }}>원</span>
            </span>
          </div>
        </section>

        <section className="card">
          <h2 className="h3" style={{ marginBottom: 4 }}>결재선</h2>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
            순서대로 승인되어야 다음 단계로 넘어가요
            {!drafterIsExec && (
              <>
                <br />
                <span style={{ color: 'var(--warning)', fontWeight: 600 }}>
                  · 마지막 결재자는 반드시 임원(본사 대표)으로 지정
                </span>
              </>
            )}
          </p>

          {approvers.length > 0 && (
            <div className="stack stack-2" style={{ marginBottom: 16 }}>
              {approvers.map((a, idx) => (
                <div
                  key={a.user_id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 12, borderRadius: 12,
                    background: 'var(--accent-soft)',
                  }}
                >
                  <span
                    className="num"
                    style={{
                      width: 28, height: 28, borderRadius: 999,
                      background: 'var(--accent)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 800,
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div className="h4" style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {a.name}
                      {a.isExecutive && (
                        <span className="tag tag-warning" style={{ fontSize: 10, padding: '2px 6px' }}>임원</span>
                      )}
                    </div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {idx === approvers.length - 1 ? '최종 결재 · ' : ''}{a.role === 'owner' ? '대표' : '매니저'}
                    </div>
                  </div>
                  <button type="button" onClick={() => moveApprover(idx, -1)} disabled={idx === 0} className="btn btn-ghost btn-icon" aria-label="위로">↑</button>
                  <button type="button" onClick={() => moveApprover(idx, 1)} disabled={idx === approvers.length - 1} className="btn btn-ghost btn-icon" aria-label="아래로">↓</button>
                  <button type="button" onClick={() => removeApprover(a.user_id)} className="btn btn-ghost btn-icon" aria-label="제거">
                    <X size={14} color="var(--danger)" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <label className="label">결재자 추가</label>
          {coworkers.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>지정 가능한 결재자가 없어요 (매장 매니저·대표 또는 본사 직원)</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* 본사 직원 */}
              {coworkers.filter((c) => c.source === 'hq' && !approvers.find((a) => a.user_id === c.user_id)).length > 0 && (
                <div>
                  <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 4 }}>
                    본사
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {coworkers.filter((c) => c.source === 'hq' && !approvers.find((a) => a.user_id === c.user_id)).map((c) => (
                      <button
                        key={c.user_id}
                        type="button"
                        className={`tag ${c.isExecutive ? 'tag-warning' : 'tag-accent'} lg`}
                        onClick={() => addApprover(c.user_id)}
                        style={{
                          cursor: 'pointer',
                          border: `1px dashed ${c.isExecutive ? 'var(--warning)' : 'var(--accent)'}`,
                        }}
                        title={c.isExecutive ? '임원 — 결재선 마지막에 배치 가능' : undefined}
                      >
                        <Plus size={11} /> {c.name}{c.isExecutive ? ' · 대표' : c.role === 'owner' ? ' · 대표' : ' · 본사'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* 매장 매니저/대표 */}
              {coworkers.filter((c) => c.source === 'store' && !approvers.find((a) => a.user_id === c.user_id)).length > 0 && (
                <div>
                  <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase', marginBottom: 4 }}>
                    매장
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {coworkers.filter((c) => c.source === 'store' && !approvers.find((a) => a.user_id === c.user_id)).map((c) => (
                      <button
                        key={c.user_id}
                        type="button"
                        className="tag tag-accent lg"
                        onClick={() => addApprover(c.user_id)}
                        style={{ cursor: 'pointer', border: '1px dashed var(--accent)' }}
                      >
                        <Plus size={11} /> {c.name} · {c.role === 'owner' ? '대표' : '매니저'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="h3" style={{ marginBottom: 12 }}>영수증 첨부 (선택)</h2>
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            style={{ fontSize: 13 }}
          />
          {files.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{files.length}개 파일 선택됨</p>
          )}
        </section>

        {error && (
          <div style={{ padding: '14px 16px', background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 14, fontSize: 14, fontWeight: 600 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn btn-outline btn-lg" onClick={() => router.back()} style={{ flex: 1 }}>
            취소
          </button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting} style={{ flex: 2 }}>
            {submitting ? '제출 중...' : '결재 올리기'}
          </button>
        </div>
      </form>
    </>
  );
}
