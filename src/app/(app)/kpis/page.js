'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import {
  ChevronLeft, Target, Plus, X, Send, FileText, Trash2, Edit3, TrendingUp,
} from 'lucide-react';

const CATEGORY_META = {
  kpi: { label: 'KPI', tag: 'tag-accent', desc: '핵심 성과 지표 (전사 목표)' },
  opi: { label: 'OPI', tag: 'tag-mint',   desc: '운영 성과 지표 (매장 운영)' },
};

const PERIOD_META = {
  weekly:    '주간',
  monthly:   '월간',
  quarterly: '분기',
  annual:    '연간',
};

export default function KpisPage() {
  const router = useRouter();
  const { user, profile, memberships, currentWorkplaceId, supabase } = useApp();
  const isSuperAdmin = profile?.is_super_admin === true;
  const isManager = isSuperAdmin || memberships.some((m) => m.role === 'manager' || m.role === 'owner');

  const [kpis, setKpis] = useState([]);
  const [recordsMap, setRecordsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [recording, setRecording] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: ks } = await supabase
      .from('kpis')
      .select('*, workplaces(name)')
      .eq('active', true)
      .order('category')
      .order('created_at', { ascending: false });
    setKpis(ks ?? []);

    if (ks?.length) {
      const { data: recs } = await supabase
        .from('kpi_records')
        .select('*')
        .in('kpi_id', ks.map((k) => k.id))
        .order('period_end', { ascending: false });
      const map = {};
      (recs ?? []).forEach((r) => {
        if (!map[r.kpi_id]) map[r.kpi_id] = [];
        map[r.kpi_id].push(r);
      });
      setRecordsMap(map);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'kpi') return kpis.filter((k) => k.category === 'kpi');
    if (filter === 'opi') return kpis.filter((k) => k.category === 'opi');
    return kpis;
  }, [kpis, filter]);

  return (
    <>
      <PageHeader
        title="KPI · OPI"
        subtitle="목표 등록과 결재, 실적 기록"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="segment" style={{ alignSelf: 'flex-start' }}>
          <button className={`segment-item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setFilter('all')}>전체</button>
          <button className={`segment-item ${filter === 'kpi' ? 'is-active' : ''}`} onClick={() => setFilter('kpi')}>KPI</button>
          <button className={`segment-item ${filter === 'opi' ? 'is-active' : ''}`} onClick={() => setFilter('opi')}>OPI</button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : filtered.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><Target size={26} /></div>
            <div className="empty-title">등록된 지표가 없어요</div>
            <div className="empty-desc">
              {isManager ? '+ 버튼으로 첫 지표를 만드세요. 결재를 거쳐 확정됩니다.' : '관리자가 지표를 등록하면 여기에 표시돼요'}
            </div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {filtered.map((k) => {
              const meta = CATEGORY_META[k.category];
              const recs = recordsMap[k.id] ?? [];
              const lastRec = recs[0];
              const actual = lastRec?.actual_value ? Number(lastRec.actual_value) : null;
              const target = k.target_value ? Number(k.target_value) : null;
              const pct = (target && actual) ? Math.round((actual / target) * 100) : null;
              return (
                <article
                  key={k.id}
                  className="card interactive"
                  onClick={() => isManager && setRecording(k)}
                  style={{ cursor: isManager ? 'pointer' : 'default' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                        <span className="tag">{PERIOD_META[k.period]}</span>
                        <span className="tag">{k.workplaces?.name ?? '전사'}</span>
                        {!k.approved && <span className="tag tag-warning">결재대기</span>}
                      </div>
                      <h3 className="h3" style={{ marginTop: 6 }}>{k.name}</h3>
                      {k.description && (
                        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{k.description}</p>
                      )}
                    </div>
                    {target != null && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="text-muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase' }}>목표</div>
                        <div className="num" style={{ fontSize: 18, fontWeight: 800 }}>
                          {formatCurrency(target)}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>{k.unit ?? ''}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {actual != null && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>
                          최근 실적 ({lastRec.period_start.slice(5)} - {lastRec.period_end.slice(5)})
                        </span>
                        <span className="num" style={{ fontSize: 16, fontWeight: 800, color: pct >= 100 ? 'var(--success)' : 'var(--text)' }}>
                          {formatCurrency(actual)}<span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>{k.unit ?? ''}</span>
                          {pct != null && <span style={{ marginLeft: 8, color: pct >= 100 ? 'var(--success)' : 'var(--accent)' }}>{pct}%</span>}
                        </span>
                      </div>
                      {pct != null && (
                        <div style={{ height: 6, background: 'var(--surface-soft)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(pct, 100)}%`, height: '100%',
                            background: pct >= 100 ? 'var(--grad-success)' : 'var(--grad-accent)',
                            transition: 'width var(--t-md) var(--ease)',
                          }} />
                        </div>
                      )}
                    </div>
                  )}

                  {k.approval_request_id && (
                    <div style={{ marginTop: 10 }}>
                      <Link href={`/approvals/${k.approval_request_id}`} className="btn btn-ghost btn-xs" onClick={(e) => e.stopPropagation()}>
                        <FileText size={11} /> 결재 보기
                      </Link>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>

      {isManager && (
        <button type="button" className="fab" onClick={() => setEditing({})} aria-label="새 지표">
          <Plus size={26} />
        </button>
      )}

      {editing && (
        <KpiEditor
          kpi={editing.id ? editing : null}
          memberships={memberships}
          currentWorkplaceId={currentWorkplaceId}
          isSuperAdmin={isSuperAdmin}
          userId={user.id}
          supabase={supabase}
          onClose={() => setEditing(null)}
          onSaved={(approvalId) => {
            setEditing(null);
            load();
            if (approvalId) router.push(`/approvals/${approvalId}`);
          }}
        />
      )}

      {recording && (
        <KpiRecorder
          kpi={recording}
          userId={user.id}
          supabase={supabase}
          onClose={() => setRecording(null)}
          onSaved={() => { setRecording(null); load(); }}
        />
      )}
    </>
  );
}

function KpiEditor({ kpi, memberships, currentWorkplaceId, isSuperAdmin, userId, supabase, onClose, onSaved }) {
  const isEdit = !!kpi?.id;
  const [category, setCategory] = useState(kpi?.category ?? 'opi');
  const [name, setName] = useState(kpi?.name ?? '');
  const [target, setTarget] = useState(kpi?.target_value ?? '');
  const [unit, setUnit] = useState(kpi?.unit ?? '');
  const [period, setPeriod] = useState(kpi?.period ?? 'monthly');
  const [description, setDescription] = useState(kpi?.description ?? '');
  const [workplaceId, setWorkplaceId] = useState(kpi?.workplace_id ?? currentWorkplaceId ?? '');
  const [approvers, setApprovers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!workplaceId) { setCandidates([]); return; }
    (async () => {
      const { data } = await supabase
        .from('memberships')
        .select('user_id, role, profiles!memberships_user_id_fkey(name)')
        .eq('workplace_id', workplaceId)
        .eq('active', true)
        .in('role', ['manager', 'owner'])
        .neq('user_id', userId);
      setCandidates((data ?? []).map((m) => ({ user_id: m.user_id, name: m.profiles?.name ?? '—', role: m.role })));
    })();
  }, [supabase, workplaceId, userId]);

  function addApprover(uid) {
    if (approvers.some((a) => a.user_id === uid)) return;
    const f = candidates.find((c) => c.user_id === uid);
    if (f) setApprovers((p) => [...p, f]);
  }
  function removeApprover(uid) { setApprovers((p) => p.filter((a) => a.user_id !== uid)); }

  async function save() {
    setError(null);
    if (!name.trim()) return setError('지표명을 입력해주세요.');
    setSaving(true);
    try {
      let approvalId = null;
      // 신규 등록일 경우만 결재 생성 (편집은 결재 별도)
      if (!isEdit) {
        if (approvers.length === 0) return setError('결재자를 1명 이상 지정해주세요.');
        const { data: req, error: e1 } = await supabase
          .from('approval_requests')
          .insert({
            workplace_id: workplaceId || null,
            drafter_id: userId,
            doc_type: 'kpi',
            title: `[${category.toUpperCase()}] ${name.trim()}`,
            body: description.trim() || null,
            total_amount: Number(target) || 0,
          })
          .select('id')
          .single();
        if (e1) throw e1;
        approvalId = req.id;

        const { error: e2 } = await supabase.from('approval_steps').insert(
          approvers.map((a, i) => ({
            request_id: approvalId,
            step_order: i + 1,
            approver_id: a.user_id,
            status: 'waiting',
          }))
        );
        if (e2) throw e2;
      }

      const payload = {
        workplace_id: workplaceId || null,
        category,
        name: name.trim(),
        target_value: Number(target) || null,
        unit: unit.trim() || null,
        period,
        description: description.trim() || null,
        approval_request_id: approvalId ?? kpi?.approval_request_id ?? null,
      };
      if (isEdit) {
        const { error } = await supabase.from('kpis').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', kpi.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('kpis').insert({ ...payload, created_by: userId });
        if (error) throw error;
      }
      onSaved(approvalId);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm('이 지표를 보관 처리할까요?')) return;
    setSaving(true);
    const { error } = await supabase.from('kpis').update({ active: false }).eq('id', kpi.id);
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  // 사업장 옵션: 본인이 매니저/대표인 사업장 + (super_admin이면 전사)
  const workplaceOptions = memberships
    .filter((m) => m.role === 'manager' || m.role === 'owner')
    .map((m) => ({ id: m.workplace_id, name: m.workplaces?.name }));

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '지표 편집' : '새 KPI · OPI'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">구분</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(CATEGORY_META).map(([k, m]) => (
          <button
            key={k}
            type="button"
            className={`segment-item ${category === k ? 'is-active' : ''}`}
            onClick={() => setCategory(k)}
            style={{ flex: 1 }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>{CATEGORY_META[category].desc}</p>

      <label className="label" style={{ marginTop: 12 }}>지표명</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 월 매출, 객단가, 재방문율" />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">목표값</label>
          <input className="input num" type="number" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div>
          <label className="label">단위</label>
          <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="원/%/건" />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>주기</label>
      <div className="segment" style={{ width: '100%' }}>
        {Object.entries(PERIOD_META).map(([k, label]) => (
          <button
            key={k} type="button"
            className={`segment-item ${period === k ? 'is-active' : ''}`}
            onClick={() => setPeriod(k)}
            style={{ flex: 1 }}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>대상 사업장</label>
      <select className="input" value={workplaceId ?? ''} onChange={(e) => setWorkplaceId(e.target.value || null)}>
        {isSuperAdmin && <option value="">전사</option>}
        {workplaceOptions.map((w) => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>

      <label className="label" style={{ marginTop: 12 }}>설명</label>
      <textarea
        className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="목표 배경·산정 기준" style={{ resize: 'vertical' }}
      />

      {!isEdit && (
        <>
          <label className="label" style={{ marginTop: 16 }}>결재선</label>
          {approvers.length > 0 && (
            <div className="stack stack-2" style={{ marginBottom: 10 }}>
              {approvers.map((a, idx) => (
                <div key={a.user_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: 10, borderRadius: 10, background: 'var(--accent-soft)',
                }}>
                  <span className="num" style={{
                    width: 24, height: 24, borderRadius: 999,
                    background: 'var(--accent)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 800,
                  }}>{idx + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                  <button type="button" onClick={() => removeApprover(a.user_id)} className="btn btn-ghost btn-icon">
                    <X size={14} color="var(--danger)" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {candidates.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 12 }}>해당 사업장의 매니저/대표가 없습니다. 사업장을 변경해주세요.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {candidates.filter((c) => !approvers.find((a) => a.user_id === c.user_id)).map((c) => (
                <button
                  key={c.user_id} type="button" className="tag tag-accent"
                  onClick={() => addApprover(c.user_id)}
                  style={{ cursor: 'pointer', border: '1px dashed var(--accent)' }}
                >
                  <Plus size={11} /> {c.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {isEdit && (
          <button type="button" className="btn btn-outline" onClick={archive} disabled={saving} style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} />
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {isEdit ? '저장' : <><Send size={14} /> 결재 올리기</>}
        </button>
      </div>
    </BottomSheet>
  );
}

function KpiRecorder({ kpi, userId, supabase, onClose, onSaved }) {
  const today = new Date();
  const [periodStart, setPeriodStart] = useState(today.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(today.toISOString().slice(0, 10));
  const [actualValue, setActualValue] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!actualValue) return setError('실적값을 입력해주세요.');
    setSaving(true);
    const { error } = await supabase.from('kpi_records').insert({
      kpi_id: kpi.id,
      period_start: periodStart,
      period_end: periodEnd,
      actual_value: Number(actualValue),
      notes: notes.trim() || null,
      recorded_by: userId,
    });
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">실적 기록</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>{kpi.name}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="label">기간 시작</label>
          <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div>
          <label className="label">기간 종료</label>
          <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>실적값 ({kpi.unit ?? ''})</label>
      <input className="input num lg" type="number" value={actualValue} onChange={(e) => setActualValue(e.target.value)} placeholder={kpi.target_value ? `목표: ${kpi.target_value}` : ''} />

      <label className="label" style={{ marginTop: 12 }}>메모</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          <TrendingUp size={14} /> {saving ? '기록 중...' : '실적 기록'}
        </button>
      </div>
    </BottomSheet>
  );
}
