'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { getApproverCandidates, submitApproval, updateApproval, getApprovalDetail } from '../actions';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { safeMutate } from '@/lib/safeMutate';
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
  const prefill = searchParams.get('prefill') === '1'; // 발주 권장 카드에서 넘어온 초안
  const editId = searchParams.get('edit'); // 진행 중 기안 수정 모드
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
  const [editInfo, setEditInfo] = useState(null);            // { id, editCount, approverIds, attachmentCount }
  const [editError, setEditError] = useState(null);

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

  // 수정 모드: 진행 중 본인 기안 불러오기 (결재선은 coworkers 가 로드된 뒤 아래 effect 에서 맞춤)
  useEffect(() => {
    if (!editId || !user) return;
    let cancelled = false;
    (async () => {
      // 서비스롤 조회 (상세 페이지와 동일 경로 — 기안자 본인은 RLS 와 무관하게 읽을 수 있어야 함)
      const res = await getApprovalDetail(editId).catch(() => null);
      if (cancelled) return;
      const prev = res?.request;
      if (!prev) { setEditError('수정할 기안을 찾을 수 없어요.'); return; }
      if (prev.drafter_id !== user.id) { setEditError('기안자만 수정할 수 있어요.'); return; }
      if (prev.status !== 'pending') { setEditError('진행 중인 기안만 수정할 수 있어요.'); return; }
      if (prev.doc_type !== 'expense') { setEditError('지출결의서만 수정할 수 있어요.'); return; }
      setTitle(prev.title || '');
      setBody(prev.body || '');
      if (res.items?.length) {
        setItems(res.items.map((it) => ({
          description: it.description || '', category: it.category || '식자재',
          amount: String(it.amount ?? ''), vendor: it.vendor || '', product_url: it.product_url || '',
        })));
      }
      const approverIds = [...(res.steps ?? [])].sort((a, b) => a.step_order - b.step_order).map((s) => s.approver_id);
      setEditInfo({
        id: prev.id, workplaceId: prev.workplace_id, editCount: prev.edit_count ?? 0,
        approverIds, attachmentCount: res.attachments?.length ?? 0,
      });
    })();
    return () => { cancelled = true; };
  }, [editId, user]);

  // 결재선 후보·영수증 경로는 기안이 속한 매장 기준 (본사가 다른 매장을 보고 있어도 원래 매장 유지)
  const targetWorkplaceId = editInfo?.workplaceId ?? currentWorkplaceId;

  // 발주 권장 카드가 sessionStorage 에 넣어 둔 초안 (제목·본문·항목). 한 번 쓰고 지운다
  useEffect(() => {
    if (!prefill) return;
    let draft = null;
    try {
      const raw = sessionStorage.getItem('approvalPrefill');
      if (raw) { draft = JSON.parse(raw); sessionStorage.removeItem('approvalPrefill'); }
    } catch { draft = null; }
    if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return;
    Promise.resolve().then(() => {
      setTitle(String(draft.title ?? ''));
      setBody(String(draft.body ?? ''));
      setItems(draft.items.map((it) => ({
        description: String(it.description ?? ''), category: String(it.category ?? '식자재'),
        amount: String(it.amount ?? ''), vendor: String(it.vendor ?? ''), product_url: String(it.product_url ?? ''),
      })));
    });
  }, [prefill]);

  const total = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!targetWorkplaceId || !user) return;
      // 서버 액션으로 결재자 후보 조회 (서비스 롤 — 본사 직원 프로필 RLS 우회)
      try {
        const list = await getApproverCandidates(targetWorkplaceId);
        if (!cancelled) {
          setCoworkers(list);
          // 수정 모드면 기존 결재선을 후보 목록에서 찾아 복원 (후보에서 빠진 사람은 제외)
          if (editInfo?.approverIds?.length) {
            setApprovers(editInfo.approverIds.map((uid) => list.find((c) => c.user_id === uid)).filter(Boolean));
          }
        }
      } catch (e) {
        if (!cancelled) setCoworkers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [targetWorkplaceId, user, editInfo]);

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
    if (editId && !editInfo) return setError('기안 정보를 불러오지 못했어요. 새로고침 후 다시 시도해주세요.');
    if (!drafterIsExec && !approvers[approvers.length - 1].isExecutive) {
      return setError('결재선의 마지막 단계는 임원(본사 대표)이어야 합니다.');
    }

    setSubmitting(true);
    try {
      // 영수증 파일은 클라이언트에서 storage 업로드 후 경로만 서버액션에 전달
      const uploaded = [];
      for (const f of files) {
        const path = `${targetWorkplaceId}/${Date.now()}_${f.name}`;
        const { error: upErr } = await safeMutate(supabase.storage.from('receipts').upload(path, f, { contentType: f.type }), 30000);
        if (upErr) { console.warn('upload failed', upErr); continue; }
        uploaded.push({ path, name: f.name, type: f.type, size: f.size });
      }

      // 결재 본문·항목·결재선·첨부는 서버액션(서비스롤)으로 일괄 생성 (수정 모드면 같은 기안을 갱신)
      const res = editInfo ? await updateApproval({
        requestId: editInfo.id,
        title,
        body,
        items: items.map((it) => ({
          description: it.description, category: it.category, amount: parseFloat(it.amount) || 0,
          vendor: it.vendor, product_url: it.product_url, kind: getKindByCategory(it.category),
        })),
        approverIds: approvers.map((a) => a.user_id),
        attachments: uploaded,
      }) : await submitApproval({
        workplaceId: currentWorkplaceId,
        title,
        body,
        items: items.map((it) => ({
          description: it.description,
          category: it.category,
          amount: parseFloat(it.amount) || 0,
          vendor: it.vendor,
          product_url: it.product_url,
          kind: getKindByCategory(it.category),
        })),
        approverIds: approvers.map((a) => a.user_id),
        attachments: uploaded,
        revisionOf: revisionInfo?.id ?? null,
        revisionCount: revisionInfo?.count ?? 0,
      });
      if (res?.error && !res.requestId) { setError(res.error); return; }

      router.replace(`/approvals/${res.requestId}`);
    } catch (err) {
      setError(err.message ?? '제출 실패');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title={editInfo ? '기안 수정' : revisionInfo ? `재기안 (${revisionInfo.count}회차)` : '새 기안'}
        subtitle={editInfo ? '저장하면 결재를 처음부터 다시 받습니다' : revisionInfo ? '반려된 내용을 수정해 다시 결재 올리기' : '지출결의서를 작성해요'}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
            <ChevronLeft size={20} />
          </button>
        }
      />

      <form onSubmit={submit} className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {editError && (
          <div className="card" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', boxShadow: 'none', fontSize: 13 }}>{editError}</div>
        )}
        {editInfo && !editError && (
          <div className="card" style={{ background: 'var(--warning-soft)', boxShadow: 'none', fontSize: 12.5, lineHeight: 1.5 }}>
            진행 중인 기안을 수정합니다. 저장하면 지금까지의 승인은 무효가 되고 결재자들이 처음부터 다시 결재합니다.
            {editInfo.attachmentCount > 0 && ` 기존 첨부 ${editInfo.attachmentCount}개는 유지되고, 새 파일만 추가됩니다.`}
            {editInfo.editCount > 0 && ` (지금까지 ${editInfo.editCount}회 수정됨)`}
          </div>
        )}
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
          <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || (!!editId && !editInfo)} style={{ flex: 2 }}>
            {submitting ? (editInfo ? '저장 중...' : '제출 중...') : (editInfo ? '수정 저장 후 재결재' : '결재 올리기')}
          </button>
        </div>
      </form>
    </>
  );
}
