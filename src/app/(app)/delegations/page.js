'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { getProfileNames } from '@/app/_actions/names';
import { safeMutate } from '@/lib/safeMutate';
import { ChevronLeft, Plus, X, Trash2, UserCheck } from 'lucide-react';

export default function DelegationsPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase } = useApp();
  const [list, setList] = useState([]);
  const [coworkers, setCoworkers] = useState([]);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: dels }, { data: mems }] = await Promise.all([
      supabase
        .from('approval_delegations')
        .select('*')
        .eq('delegator_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('memberships')
        .select('user_id')
        .eq('workplace_id', currentWorkplaceId)
        .eq('active', true)
        .neq('user_id', user.id),
    ]);
    // 위임자/피위임자/동료 이름 공용 액션으로 매핑 (RLS 무관)
    const memRows = mems ?? [];
    const delRows = dels ?? [];
    const ids = [
      ...memRows.map((m) => m.user_id),
      ...delRows.map((d) => d.delegate_id),
      ...delRows.map((d) => d.delegator_id),
    ];
    const names = await getProfileNames(ids);
    setList(delRows.map((d) => ({
      ...d,
      delegate: { name: names[d.delegate_id] ?? null },
      delegator: { name: names[d.delegator_id] ?? null },
    })));
    setCoworkers(memRows.map((m) => ({ user_id: m.user_id, name: names[m.user_id] || '—' })));
  }, [user, supabase, currentWorkplaceId]);

  useEffect(() => { load(); }, [load]);

  async function deactivate(id) {
    if (!confirm('이 위임을 비활성화할까요?')) return;
    try {
      const { error } = await safeMutate(supabase.from('approval_delegations').update({ active: false }).eq('id', id));
      if (error) { alert(error.message); return; }
      load();
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  async function removeOne(id) {
    if (!confirm('이 위임을 삭제할까요?')) return;
    try {
      const { error } = await safeMutate(supabase.from('approval_delegations').delete().eq('id', id));
      if (error) { alert(error.message); return; }
      load();
    } catch (e) {
      alert(String(e?.message || e));
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="결재 위임"
        subtitle="휴가/출장 시 다른 직원에게 결재 권한 위임"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button onClick={() => setComposing(true)} className="btn btn-primary btn-lg">
          <Plus size={16} /> 새 위임
        </button>

        {list.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><UserCheck size={26} /></div>
            <div className="empty-title">활성 위임 없음</div>
            <div className="empty-desc">휴가/출장 등으로 자리 비울 때 위임 설정</div>
          </div>
        ) : (
          <div className="stack stack-3">
            {list.map((d) => {
              const isActive = d.active && (!d.end_at || d.end_at >= today);
              return (
                <div key={d.id} className="card" style={{ opacity: isActive ? 1 : 0.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>
                        결재 위임
                      </div>
                      <div className="h4" style={{ marginTop: 4 }}>
                        → <span style={{ color: 'var(--accent)' }}>{d.delegate?.name || '—'}</span>
                      </div>
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                        {d.start_at} ~ {d.end_at || '무기한'}
                        {d.reason && <> · {d.reason}</>}
                      </div>
                      <span className={`tag ${isActive ? 'tag-success' : ''}`} style={{ fontSize: 10, marginTop: 8 }}>
                        {isActive ? '활성' : '비활성'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {isActive && (
                        <button onClick={() => deactivate(d.id)} className="btn btn-ghost btn-icon" title="비활성화">
                          <X size={16} />
                        </button>
                      )}
                      <button onClick={() => removeOne(d.id)} className="btn btn-ghost btn-icon" title="삭제">
                        <Trash2 size={16} color="var(--danger)" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {composing && (
        <DelegationDialog
          coworkers={coworkers}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          supabase={supabase}
          onClose={() => setComposing(false)}
          onSaved={() => { setComposing(false); load(); }}
        />
      )}
    </>
  );
}

function DelegationDialog({ coworkers, userId, workplaceId, supabase, onClose, onSaved }) {
  const [delegateId, setDelegateId] = useState('');
  const [startAt, setStartAt] = useState(new Date().toISOString().slice(0, 10));
  const [endAt, setEndAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!delegateId) return setError('피위임자를 선택해주세요.');
    setSaving(true);
    try {
      const { error } = await safeMutate(supabase.from('approval_delegations').insert({
        delegator_id: userId,
        delegate_id: delegateId,
        workplace_id: workplaceId,
        start_at: startAt,
        end_at: endAt || null,
        reason: reason || null,
      }));
      if (error) { setError(error.message); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div className="card" style={{ width: '100%', maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="h3">새 위임</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
        </div>

        <label className="label">피위임자 (내 결재를 대신할 사람)</label>
        <select className="input" value={delegateId} onChange={(e) => setDelegateId(e.target.value)}>
          <option value="">선택</option>
          {coworkers.map((c) => (
            <option key={c.user_id} value={c.user_id}>{c.name}</option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
          <div>
            <label className="label">시작일</label>
            <input className="input" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
          <div>
            <label className="label">종료일 (선택)</label>
            <input className="input" type="date" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </div>
        </div>

        <label className="label" style={{ marginTop: 12 }}>사유 (선택)</label>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 휴가, 출장" />

        {error && <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
            {saving ? '저장 중...' : '위임 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}
