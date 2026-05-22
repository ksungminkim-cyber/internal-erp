'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatCurrency } from '@/lib/format';
import { Plus, Trash2, X, ChevronDown, ChevronLeft } from 'lucide-react';

const EXPENSE_CATEGORIES = ['식자재', '비품', '소모품', '수리/유지', '마케팅', '기타'];

export default function NewApprovalPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [items, setItems] = useState([{ description: '', category: '식자재', amount: '', vendor: '', product_url: '' }]);
  const [approvers, setApprovers] = useState([]);
  const [coworkers, setCoworkers] = useState([]);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const total = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

  useEffect(() => {
    (async () => {
      if (!currentWorkplaceId) return;
      const { data } = await supabase
        .from('memberships')
        .select('user_id, role, profiles!memberships_user_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .eq('active', true)
        .in('role', ['manager', 'owner'])
        .neq('user_id', user?.id ?? '');
      setCoworkers(
        (data ?? []).map((m) => ({ user_id: m.user_id, name: m.profiles?.name || '—', role: m.role }))
      );
    })();
  }, [supabase, currentWorkplaceId, user]);

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
        title="새 기안"
        subtitle="지출결의서를 작성해요"
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
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                    <div className="h4" style={{ fontSize: 14 }}>{a.name}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{a.role === 'owner' ? '대표' : '매니저'}</div>
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
            <p className="text-muted" style={{ fontSize: 13 }}>같은 사업장의 매니저/대표가 없어요</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {coworkers.filter((c) => !approvers.find((a) => a.user_id === c.user_id)).map((c) => (
                <button
                  key={c.user_id}
                  type="button"
                  className="tag tag-accent lg"
                  onClick={() => addApprover(c.user_id)}
                  style={{ cursor: 'pointer', border: '1px dashed var(--accent)' }}
                >
                  <Plus size={11} /> {c.name}
                </button>
              ))}
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
