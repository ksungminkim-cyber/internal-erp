'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { Plus, ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function SchedulePage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState([]);
  const [coworkers, setCoworkers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    setLoading(true);
    const [{ data: ss }, { data: members }] = await Promise.all([
      supabase
        .from('shifts')
        .select('*, user:profiles!shifts_user_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .gte('start_at', weekStart.toISOString())
        .lt('start_at', weekEnd.toISOString())
        .order('start_at'),
      supabase
        .from('memberships')
        .select('user_id, role, profiles!memberships_user_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .eq('active', true)
        .order('role'),
    ]);
    setShifts(ss ?? []);
    setCoworkers((members ?? []).map((m) => ({ user_id: m.user_id, name: m.profiles?.name || '—', role: m.role })));
    setLoading(false);
  }, [supabase, currentWorkplaceId, weekStart, weekEnd]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`shifts:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  function shiftsForDate(d) {
    const dayKey = ymd(d);
    return shifts.filter((s) => {
      const sk = new Date(s.start_at).toISOString().slice(0, 10);
      return sk === dayKey;
    });
  }

  const todayStr = ymd(new Date());

  return (
    <>
      <PageHeader
        title="시프트"
        subtitle="주간 근무 일정"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
            <ChevronLeft size={20} />
          </button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Week navigator */}
        <div className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="이전 주">
            <ChevronLeft size={18} />
          </button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="h4">
              {weekStart.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} - {addDays(weekStart, 6).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}
            </div>
            <button
              type="button"
              className="text-muted"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 600, marginTop: 2, cursor: 'pointer' }}
            >
              오늘로
            </button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="다음 주">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Week grid */}
        {loading ? (
          <div className="skeleton" style={{ height: 380 }} />
        ) : (
          <div className="stack stack-2">
            {weekDays.map((d, i) => {
              const dayShifts = shiftsForDate(d);
              const isToday = ymd(d) === todayStr;
              return (
                <div
                  key={i}
                  className="card compact"
                  style={{
                    background: isToday ? 'var(--accent-soft)' : 'var(--surface)',
                    border: isToday ? '1.5px solid var(--accent)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: dayShifts.length ? 10 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="num h3" style={{ color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--accent)' : 'var(--text)' }}>
                        {d.getDate()}
                      </span>
                      <span className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>{DOW[i]}</span>
                      {isToday && <span className="tag tag-accent">오늘</span>}
                    </div>
                    {isManager && (
                      <button
                        type="button"
                        className="btn btn-soft btn-xs"
                        onClick={() => setEditing({ start_at: new Date(d.setHours(9, 0)).toISOString(), end_at: new Date(d.setHours(18, 0)).toISOString() })}
                      >
                        <Plus size={12} /> 추가
                      </button>
                    )}
                  </div>
                  {dayShifts.length === 0 ? (
                    <p className="text-muted" style={{ fontSize: 12 }}>시프트 없음</p>
                  ) : (
                    <div className="stack stack-2">
                      {dayShifts.map((s) => (
                        <ShiftBlock key={s.id} shift={s} onEdit={isManager ? () => setEditing(s) : null} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {isManager && (
        <button type="button" className="fab" onClick={() => setEditing({})} aria-label="시프트 추가">
          <Plus size={26} />
        </button>
      )}

      {editing && (
        <ShiftEditor
          shift={editing}
          coworkers={coworkers}
          workplaceId={currentWorkplaceId}
          userId={user.id}
          supabase={supabase}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function ShiftBlock({ shift, onEdit }) {
  const start = fmtTime(shift.start_at);
  const end = fmtTime(shift.end_at);
  return (
    <button
      type="button"
      onClick={onEdit || undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 12, borderRadius: 12,
        background: 'var(--surface-soft)',
        border: 'none', textAlign: 'left',
        cursor: onEdit ? 'pointer' : 'default',
        width: '100%',
      }}
    >
      <Avatar name={shift.user?.name} userId={shift.user_id} size="sm" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="h4" style={{ fontSize: 14 }}>{shift.user?.name || '—'}</div>
        <div className="text-muted num" style={{ fontSize: 12, marginTop: 2 }}>
          {start} - {end}
          {shift.role_label && <span className="tag" style={{ marginLeft: 8 }}>{shift.role_label}</span>}
        </div>
      </div>
    </button>
  );
}

function ShiftEditor({ shift, coworkers, workplaceId, userId, supabase, onClose, onSaved }) {
  const isEdit = !!shift?.id;
  const [userPick, setUserPick] = useState(shift?.user_id ?? '');
  const [startAt, setStartAt] = useState(shift?.start_at ? toLocalInput(shift.start_at) : toLocalInput(new Date().toISOString()));
  const [endAt, setEndAt] = useState(shift?.end_at ? toLocalInput(shift.end_at) : toLocalInput(new Date(Date.now() + 8 * 3600000).toISOString()));
  const [roleLabel, setRoleLabel] = useState(shift?.role_label ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!userPick) return setError('근무자를 선택해주세요.');
    if (!startAt || !endAt) return setError('시간을 입력해주세요.');
    setSaving(true);
    const payload = {
      workplace_id: workplaceId,
      user_id: userPick,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      role_label: roleLabel || null,
      notes: notes || null,
      created_by: userId,
    };
    const op = isEdit
      ? supabase.from('shifts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', shift.id)
      : supabase.from('shifts').insert(payload);
    const { error } = await op;
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  async function del() {
    if (!confirm('이 시프트를 삭제하시겠습니까?')) return;
    setSaving(true);
    const { error } = await supabase.from('shifts').delete().eq('id', shift.id);
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '시프트 수정' : '시프트 추가'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">근무자</label>
      <select className="input" value={userPick} onChange={(e) => setUserPick(e.target.value)}>
        <option value="">선택</option>
        {coworkers.map((c) => (
          <option key={c.user_id} value={c.user_id}>
            {c.name} {c.role === 'owner' ? '(대표)' : c.role === 'manager' ? '(매니저)' : ''}
          </option>
        ))}
      </select>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">시작</label>
          <input className="input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </div>
        <div>
          <label className="label">종료</label>
          <input className="input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>역할 (선택)</label>
      <input className="input" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="예: 오픈 / 미들 / 마감" />

      <label className="label" style={{ marginTop: 12 }}>메모</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        {isEdit && (
          <button type="button" className="btn btn-outline" onClick={del} disabled={saving} style={{ color: 'var(--danger)' }}>
            <Trash2 size={14} />
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
