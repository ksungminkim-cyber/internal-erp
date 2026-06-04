'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import BottomSheet from '@/components/BottomSheet';
import { Plus, ChevronLeft, ChevronRight, X, Trash2, Send, CheckCircle2, AlertCircle, Lock, FileText, Copy } from 'lucide-react';
import { isHoliday } from '@/lib/holidays';
import { getScheduleData, saveShift, deleteShift } from './actions';
import { safeMutate } from '@/lib/safeMutate';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function startOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  return x;
}
function endOfMonth(d) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
// 로컬 날짜 기준 YYYY-MM-DD (toISOString은 UTC라 KST에서 하루 밀림 — '오늘' 판정 버그 원인)
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const SHIFT_STATUS_META = {
  scheduled: { label: '예정', tag: 'tag' },
  confirmed: { label: '확정', tag: 'tag-success' },
  swap_requested: { label: '교환요청', tag: 'tag-warning' },
  cancelled: { label: '취소', tag: 'tag-danger' },
};

const LATE_THRESHOLD_MIN = 10; // 10분 이내는 정시

function matchAttendance(shift, logs) {
  // 해당 시프트 시간 범위 안의 user 출퇴근 로그 찾기
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  const dayWindow = 2 * 3600000; // ±2시간 여유
  const userLogs = logs
    .filter((l) => l.user_id === shift.user_id)
    .filter((l) => {
      const t = new Date(l.event_at).getTime();
      return t >= start.getTime() - dayWindow && t <= end.getTime() + dayWindow;
    })
    .sort((a, b) => new Date(a.event_at) - new Date(b.event_at));

  const clockIn = userLogs.find((l) => l.event_type === 'clock_in');
  const clockOut = [...userLogs].reverse().find((l) => l.event_type === 'clock_out');

  if (!clockIn) {
    // 시프트 시작 후 30분 이상 지나도 출근 없으면 결근
    if (Date.now() > start.getTime() + 30 * 60000) {
      return { status: 'absent', label: '결근', tag: 'tag-danger' };
    }
    return null; // 아직 출근 전
  }

  const lateMs = new Date(clockIn.event_at).getTime() - start.getTime();
  const lateMin = Math.round(lateMs / 60000);

  let status, label, tag;
  if (lateMin <= LATE_THRESHOLD_MIN) {
    status = 'on_time';
    label = '정시';
    tag = 'tag-success';
  } else if (lateMin > 0) {
    status = 'late';
    label = `지각 ${lateMin}분`;
    tag = 'tag-warning';
  } else {
    status = 'early';
    label = `${Math.abs(lateMin)}분 일찍`;
    tag = 'tag-success';
  }

  // 조퇴 체크
  if (clockOut) {
    const earlyOutMs = end.getTime() - new Date(clockOut.event_at).getTime();
    const earlyOutMin = Math.round(earlyOutMs / 60000);
    if (earlyOutMin > 10) {
      label = `${label} · 조퇴 ${earlyOutMin}분`;
      tag = 'tag-warning';
    }
  }

  return {
    status, label, tag,
    clockInAt: clockIn.event_at,
    clockOutAt: clockOut?.event_at ?? null,
  };
}

export default function SchedulePage() {
  const router = useRouter();
  const { user, profile, currentWorkplaceId, supabase, isManager: contextIsManager, memberships } = useApp();
  // 매니저/owner/본사 직원만 시프트 편집 가능
  const isHQMember = memberships.some((m) => m.workplaces?.name === '본사');
  const isManager = contextIsManager || isHQMember || profile?.is_super_admin === true;
  const [view, setView] = useState('week'); // 'week' | 'month'
  const [anchor, setAnchor] = useState(() => new Date());
  const [shifts, setShifts] = useState([]);
  const [logs, setLogs] = useState([]);
  const [coworkers, setCoworkers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [loading, setLoading] = useState(false);

  const periodStart = useMemo(() => {
    return view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  }, [anchor, view]);
  const periodEnd = useMemo(() => {
    return view === 'week' ? addDays(periodStart, 7) : endOfMonth(anchor);
  }, [anchor, view, periodStart]);

  const days = useMemo(() => {
    if (view === 'week') {
      return Array.from({ length: 7 }, (_, i) => addDays(periodStart, i));
    }
    const arr = [];
    let d = new Date(periodStart);
    while (d < periodEnd) {
      arr.push(new Date(d));
      d = addDays(d, 1);
    }
    return arr;
  }, [view, periodStart, periodEnd]);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    // 서버 액션(서비스 롤)으로 조회 — profile JOIN RLS 충돌 회피 + 직원 이름 정확
    try {
      const { shifts: ss, logs: attLogs, coworkers: cw } = await getScheduleData(
        currentWorkplaceId,
        periodStart.toISOString(),
        periodEnd.toISOString()
      );
      setShifts(ss ?? []);
      setLogs(attLogs ?? []);
      setCoworkers(cw ?? []);
    } catch {
      setShifts([]); setLogs([]); setCoworkers([]);
    }
    setLoading(false);
  }, [currentWorkplaceId, periodStart, periodEnd]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`shifts:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_logs', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  function shiftsForDate(d) {
    const dayKey = ymd(d);
    return shifts.filter((s) => ymd(new Date(s.start_at)) === dayKey);
  }

  const todayStr = ymd(new Date());

  // 결재 올리기: 현재 표시 중인 월의 시프트를 묶어서 결재 제출
  function navPrev() { setAnchor((a) => view === 'week' ? addDays(a, -7) : addMonths(a, -1)); }
  function navNext() { setAnchor((a) => view === 'week' ? addDays(a, 7) : addMonths(a, 1)); }
  function navToday() { setAnchor(new Date()); }

  const periodLabel = view === 'week'
    ? `${periodStart.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} - ${addDays(periodStart, 6).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`
    : anchor.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });

  // 이 기간의 시프트 중 이미 결재에 묶인 게 있는지
  const hasApproval = shifts.some((s) => s.approval_request_id);
  const approvalIdInPeriod = shifts.find((s) => s.approval_request_id)?.approval_request_id;
  const unsubmittedCount = shifts.filter((s) => !s.approval_request_id && s.status !== 'cancelled').length;

  return (
    <>
      <PageHeader
        title="시프트"
        subtitle="근무 일정"
        hideSwitcher
        action={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isManager && view === 'month' && !hasApproval && (
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() => setEditing({ mode: 'copy_prev_month' })}
              >
                <Copy size={14} /> 지난달 복사
              </button>
            )}
            {isManager && view === 'month' && unsubmittedCount > 0 && !hasApproval && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setEditing({ mode: 'submit_approval' })}
              >
                <Send size={14} /> 결재 올리기
              </button>
            )}
            {hasApproval && approvalIdInPeriod && (
              <Link href={`/approvals/${approvalIdInPeriod}`} className="btn btn-soft btn-sm">
                <FileText size={14} /> 결재 보기
              </Link>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon" aria-label="뒤로">
              <ChevronLeft size={20} />
            </button>
          </div>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 주/월 토글 + 네비 */}
        <div className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn-ghost btn-icon" onClick={navPrev} aria-label="이전"><ChevronLeft size={18} /></button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="h4">{periodLabel}</div>
            <button
              type="button"
              className="text-muted"
              onClick={navToday}
              style={{ background: 'none', border: 'none', fontSize: 11, fontWeight: 600, marginTop: 2, cursor: 'pointer' }}
            >
              오늘로
            </button>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={navNext} aria-label="다음"><ChevronRight size={18} /></button>
        </div>

        <div className="segment" style={{ alignSelf: 'flex-start' }}>
          <button className={`segment-item ${view === 'week' ? 'is-active' : ''}`} onClick={() => setView('week')}>주간</button>
          <button className={`segment-item ${view === 'month' ? 'is-active' : ''}`} onClick={() => setView('month')}>월간</button>
        </div>

        {hasApproval && (
          <div className="card" style={{ background: 'var(--success-soft)', boxShadow: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
            <Lock size={16} color="#00876c" />
            <span style={{ fontSize: 13, color: '#00876c', fontWeight: 600 }}>이 기간 시프트는 결재로 묶여 있습니다.</span>
          </div>
        )}

        {/* 월간 보기 — 캘린더 그리드 */}
        {!loading && view === 'month' && (
          <CalendarGrid
            anchor={anchor}
            shifts={shifts}
            logs={logs}
            todayStr={todayStr}
            isManager={isManager}
            hasApproval={hasApproval}
            onCellClick={(d) => {
              // 정확한 local 날짜 사용 — 시간대 오프셋 방지
              const y = d.getFullYear();
              const m = d.getMonth();
              const day = d.getDate();
              const s = new Date(y, m, day, 9, 0, 0, 0);
              const e = new Date(y, m, day, 18, 0, 0, 0);
              setEditing({ mode: 'shift', start_at: s.toISOString(), end_at: e.toISOString() });
            }}
            onShiftClick={(s) => {
              if (isManager && !s.approval_request_id) {
                setEditing({ mode: 'shift', ...s });
              }
            }}
          />
        )}

        {/* 주간 보기 — 기존 카드 리스트 */}
        {loading ? (
          <div className="skeleton" style={{ height: 380 }} />
        ) : view === 'week' && (
          <div className="stack stack-2">
            {days.map((d, i) => {
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
                      <span className="num h3" style={{ color: d.getDay() === 0 ? 'var(--danger)' : d.getDay() === 6 ? 'var(--accent)' : 'var(--text)' }}>
                        {d.getDate()}
                      </span>
                      <span className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>{DOW[d.getDay()]}</span>
                      {isToday && <span className="tag tag-accent">오늘</span>}
                    </div>
                    {isManager && !hasApproval && (
                      <button
                        type="button"
                        className="btn btn-soft btn-xs"
                        onClick={() => {
                          const s = new Date(d); s.setHours(9, 0, 0, 0);
                          const e = new Date(d); e.setHours(18, 0, 0, 0);
                          setEditing({ mode: 'shift', start_at: s.toISOString(), end_at: e.toISOString() });
                        }}
                      >
                        <Plus size={12} /> 추가
                      </button>
                    )}
                  </div>
                  {dayShifts.length === 0 ? (
                    <p className="text-muted" style={{ fontSize: 12 }}>시프트 없음</p>
                  ) : (
                    <div className="stack stack-2">
                      {dayShifts.map((s) => {
                        const att = matchAttendance(s, logs);
                        const canEdit = isManager && !s.approval_request_id;
                        return (
                          <ShiftBlock
                            key={s.id}
                            shift={s}
                            attendance={att}
                            onEdit={canEdit ? () => setEditing({ mode: 'shift', ...s }) : null}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {isManager && !hasApproval && (
        <button
          type="button"
          className="fab"
          onClick={() => {
            const s = new Date(); s.setHours(9, 0, 0, 0);
            const e = new Date(); e.setHours(18, 0, 0, 0);
            setEditing({ mode: 'shift', start_at: s.toISOString(), end_at: e.toISOString() });
          }}
          aria-label="시프트 추가"
        >
          <Plus size={26} />
        </button>
      )}

      {editing?.mode === 'shift' && (
        <ShiftEditor
          shift={editing.id ? editing : null}
          initial={!editing.id ? editing : null}
          coworkers={coworkers}
          workplaceId={currentWorkplaceId}
          userId={user.id}
          supabase={supabase}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {editing?.mode === 'submit_approval' && (
        <SubmitScheduleApproval
          year={anchor.getFullYear()}
          month={anchor.getMonth() + 1}
          shiftCount={unsubmittedCount}
          coworkers={coworkers}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          supabase={supabase}
          shifts={shifts.filter((s) => !s.approval_request_id && s.status !== 'cancelled')}
          onClose={() => setEditing(null)}
          onSaved={(approvalId) => {
            setEditing(null);
            load();
            router.push(`/approvals/${approvalId}`);
          }}
        />
      )}

      {editing?.mode === 'copy_prev_month' && (
        <CopyPrevMonthDialog
          year={anchor.getFullYear()}
          month={anchor.getMonth()}
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

function ShiftBlock({ shift, attendance, onEdit }) {
  const start = fmtTime(shift.start_at);
  const end = fmtTime(shift.end_at);
  const meta = SHIFT_STATUS_META[shift.status] || SHIFT_STATUS_META.scheduled;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <div className="h4" style={{ fontSize: 14 }}>{shift.user?.name || '—'}</div>
          {shift.status !== 'scheduled' && <span className={`tag ${meta.tag}`}>{meta.label}</span>}
        </div>
        <div className="text-muted num" style={{ fontSize: 12, marginTop: 2 }}>
          계획 {start} - {end}
          {shift.role_label && <span className="tag" style={{ marginLeft: 8 }}>{shift.role_label}</span>}
        </div>
        {/* 실제 출퇴근 기록 */}
        {attendance && (
          <div className="num" style={{ fontSize: 12, marginTop: 2, color: 'var(--accent-strong)' }}>
            실제 {fmtTime(attendance.clockInAt)}
            {attendance.clockOutAt ? ` - ${fmtTime(attendance.clockOutAt)}` : ' - 근무중'}
          </div>
        )}
      </div>
      {attendance && (
        <span className={`tag ${attendance.tag} dot`}>{attendance.label}</span>
      )}
    </button>
  );
}

function ShiftEditor({ shift, initial, coworkers, workplaceId, userId, supabase, onClose, onSaved }) {
  const isEdit = !!shift?.id;
  const seed = isEdit ? shift : initial ?? {};
  const [userPick, setUserPick] = useState(shift?.user_id ?? '');
  const [startAt, setStartAt] = useState(toLocalInput(seed.start_at ?? new Date().toISOString()));
  const [endAt, setEndAt] = useState(toLocalInput(seed.end_at ?? new Date(Date.now() + 8 * 3600000).toISOString()));
  const [roleLabel, setRoleLabel] = useState(shift?.role_label ?? '');
  const [notes, setNotes] = useState(shift?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // 예상 시간/인건비 계산
  const pickedUser = coworkers.find((c) => c.user_id === userPick);
  const hoursDiff = (() => {
    if (!startAt || !endAt) return 0;
    const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
    return Math.max(0, ms / 3600000);
  })();
  const estimatedWage = Math.round(hoursDiff * Number(pickedUser?.hourly_wage ?? 0));

  async function save() {
    setError(null);
    if (!userPick) return setError('근무자를 선택해주세요.');
    if (!startAt || !endAt) return setError('시간을 입력해주세요.');
    setSaving(true);
    try {
      const res = await saveShift({
        id: shift?.id ?? null,
        workplaceId,
        userId: userPick,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        roleLabel,
        notes,
      });
      if (res?.error) { setError(res.error); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm('이 시프트를 삭제하시겠습니까?')) return;
    setSaving(true);
    try {
      await deleteShift(shift.id);
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginTop: 12 }}>
        <div style={{ minWidth: 0 }}>
          <label className="label">시작</label>
          <input className="input" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ width: '100%', minWidth: 0, padding: '12px 10px' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <label className="label">종료</label>
          <input className="input" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ width: '100%', minWidth: 0, padding: '12px 10px' }} />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>역할 (선택)</label>
      <input className="input" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} placeholder="예: 오픈 / 미들 / 마감" />

      <label className="label" style={{ marginTop: 12 }}>메모</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />

      {/* 예상 인건비 미리보기 */}
      {userPick && hoursDiff > 0 && (
        <div style={{
          marginTop: 12, padding: '12px 14px',
          background: 'var(--accent-soft)', borderRadius: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.04, textTransform: 'uppercase' }}>예상 인건비</div>
            <div className="num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-strong)', marginTop: 2 }}>
              {estimatedWage.toLocaleString()}원
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>
            {hoursDiff.toFixed(1)}h × {Number(pickedUser?.hourly_wage ?? 0).toLocaleString()}원
            {!pickedUser?.hourly_wage && <div style={{ color: 'var(--warning)' }}>시급 미설정</div>}
          </div>
        </div>
      )}

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

function SubmitScheduleApproval({ year, month, shiftCount, coworkers, userId, workplaceId, supabase, shifts, onClose, onSaved }) {
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
      setCandidates((data ?? []).map((m) => ({ user_id: m.user_id, name: m.profiles?.name || '—', role: m.role })));
    })();
  }, [supabase, workplaceId, userId]);

  function addApprover(uid) {
    if (approvers.some((a) => a.user_id === uid)) return;
    const f = candidates.find((c) => c.user_id === uid);
    if (f) setApprovers((p) => [...p, f]);
  }
  function removeApprover(uid) { setApprovers((p) => p.filter((a) => a.user_id !== uid)); }

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
          doc_type: 'schedule',
          title: `${year}년 ${month}월 근무 스케줄`,
          body: `${shiftCount}개 시프트`,
          total_amount: 0,
          period_year: year,
          period_month: month,
        })
        .select('id')
        .single());
      if (e1) throw e1;
      const requestId = req.id;

      // 결재선
      const { error: e2 } = await safeMutate(supabase.from('approval_steps').insert(
        approvers.map((a, i) => ({
          request_id: requestId,
          step_order: i + 1,
          approver_id: a.user_id,
          status: 'waiting',
        }))
      ));
      if (e2) throw e2;

      // 모든 시프트를 이 결재에 묶기
      const shiftIds = shifts.map((s) => s.id);
      if (shiftIds.length > 0) {
        const { error: e3 } = await safeMutate(supabase
          .from('shifts')
          .update({ approval_request_id: requestId })
          .in('id', shiftIds));
        if (e3) throw e3;
      }

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
        <h2 className="h3">시프트 결재 올리기</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>기간</div>
        <div className="h3">{year}년 {month}월</div>
        <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          현재 {shiftCount}개 시프트가 결재 대상입니다
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

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============== 캘린더 그리드 (월간 보기) ==============
function CalendarGrid({ anchor, shifts, logs, todayStr, isManager, hasApproval, onCellClick, onShiftClick }) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startWeekday = firstDay.getDay();       // 0=일요일
  const daysInMonth = lastDay.getDate();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startWeekday + 1;
    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
    cells.push(inMonth ? new Date(year, month, dayNum) : null);
  }

  function shiftsForDate(d) {
    if (!d) return [];
    // Local 날짜 키 사용 (시간대 오프셋 방지)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return shifts.filter((s) => {
      const sd = new Date(s.start_at);
      const sKey = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`;
      return sKey === key;
    });
  }

  return (
    <div className="card compact" style={{ padding: 0, overflow: 'hidden' }}>
      {/* 요일 헤더 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: 'var(--surface-soft)',
        borderBottom: '1px solid var(--border)',
      }}>
        {DOW.map((d, i) => (
          <div key={d} style={{
            padding: '12px 4px',
            textAlign: 'center',
            fontSize: 14, fontWeight: 700,
            color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--accent)' : 'var(--text-secondary)',
          }}>{d}</div>
        ))}
      </div>
      {/* 날짜 셀 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
      }}>
        {cells.map((d, i) => {
          const dayShifts = d ? shiftsForDate(d) : [];
          const isToday = d && ymd(d) === todayStr;
          const dow = i % 7;
          const isLastRow = i >= cells.length - 7;
          const clickable = isManager && !hasApproval && d;
          const holidayName = d ? isHoliday(d) : null;
          const isRedDay = d && (dow === 0 || !!holidayName); // 일요일 또는 공휴일
          return (
            <div
              key={i}
              onClick={() => { if (clickable) onCellClick(d); }}
              style={{
                minHeight: 110,
                padding: 8,
                borderRight: dow < 6 ? '1px solid var(--border)' : undefined,
                borderBottom: !isLastRow ? '1px solid var(--border)' : undefined,
                background: !d ? 'var(--surface-soft)' :
                  isToday ? 'var(--accent-soft)' :
                  holidayName ? 'var(--danger-soft)' : 'var(--surface)',
                cursor: clickable ? 'pointer' : 'default',
                transition: 'background var(--t-fast) var(--ease)',
                position: 'relative',
              }}
            >
              {d && (
                <>
                  <div style={{
                    fontSize: 16, fontWeight: 800,
                    color: isRedDay ? 'var(--danger)' : dow === 6 ? 'var(--accent)' : 'var(--text)',
                    marginBottom: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span className="num">{d.getDate()}</span>
                    {isToday && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>오늘</span>
                    )}
                  </div>
                  {holidayName && (
                    <div style={{
                      fontSize: 11, fontWeight: 700,
                      color: 'var(--danger)',
                      marginBottom: 6,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={holidayName}>
                      🇰🇷 {holidayName}
                    </div>
                  )}
                  <div className="stack" style={{ gap: 4 }}>
                    {dayShifts.slice(0, 4).map((s) => {
                      const att = matchAttendance(s, logs);
                      const startStr = new Date(s.start_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
                      const bgColor =
                        s.status === 'confirmed' ? 'var(--success-soft)' :
                        s.status === 'cancelled' ? 'var(--surface-soft)' :
                        'var(--accent-soft)';
                      const fgColor =
                        s.status === 'confirmed' ? '#00876c' :
                        s.status === 'cancelled' ? 'var(--text-muted)' :
                        'var(--accent-strong)';
                      return (
                        <div
                          key={s.id}
                          onClick={(e) => { e.stopPropagation(); onShiftClick(s); }}
                          title={`${s.user?.name ?? '—'} · ${startStr}${att ? ' · ' + att.label : ''}`}
                          style={{
                            fontSize: 12, fontWeight: 600,
                            padding: '5px 8px',
                            background: bgColor, color: fgColor,
                            borderRadius: 6,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            cursor: isManager && !s.approval_request_id ? 'pointer' : 'default',
                          }}
                        >
                          <span className="num">{startStr}</span> {s.user?.name?.slice(0, 5) ?? '—'}
                          {att && (att.status === 'late' || att.status === 'absent') && (
                            <span style={{ marginLeft: 4, color: 'var(--danger)' }}>●</span>
                          )}
                        </div>
                      );
                    })}
                    {dayShifts.length > 4 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', fontWeight: 600 }}>
                        +{dayShifts.length - 4}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {isManager && !hasApproval && (
        <div style={{
          padding: '10px 12px',
          background: 'var(--surface-soft)',
          borderTop: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-muted)',
          textAlign: 'center',
        }}>
          빈 날짜를 클릭해 시프트 추가 · 기존 시프트 클릭해 수정
        </div>
      )}
    </div>
  );
}

// ============== 지난달 복사 다이얼로그 ==============
function CopyPrevMonthDialog({ year, month, coworkers, workplaceId, userId, supabase, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [prevShifts, setPrevShifts] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // year, month는 현재 보고 있는 달. 지난달은 month - 1
  const prevDate = new Date(year, month - 1, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth();
  const prevStart = new Date(prevYear, prevMonth, 1);
  const prevEnd = new Date(prevYear, prevMonth + 1, 1);
  const targetMonthLabel = `${year}년 ${month + 1}월`;

  useEffect(() => {
    (async () => {
        const { data } = await supabase
        .from('shifts')
        .select('*, user:profiles!shifts_user_id_fkey(name)')
        .eq('workplace_id', workplaceId)
        .gte('start_at', prevStart.toISOString())
        .lt('start_at', prevEnd.toISOString())
        .order('start_at');
      setPrevShifts(data ?? []);
      setSelectedIds(new Set((data ?? []).map((s) => s.id)));
      setLoading(false);
    })();
  }, [supabase, workplaceId, prevStart.toISOString(), prevEnd.toISOString()]);

  function toggleId(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    const targets = prevShifts.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) return setError('복사할 시프트를 선택해주세요.');
    setSaving(true);
    setError(null);
    // 각 시프트를 다음 달의 같은 일자로 변환
    const newRows = targets.map((s) => {
      const sStart = new Date(s.start_at);
      const sEnd = new Date(s.end_at);
      const day = sStart.getDate();
      const newStart = new Date(year, month, day, sStart.getHours(), sStart.getMinutes(), 0);
      const newEnd = new Date(year, month, day, sEnd.getHours(), sEnd.getMinutes(), 0);
      // 만약 대상 월에 그 일자가 없으면(예: 2월 30일) 마지막 날로
      const lastDay = new Date(year, month + 1, 0).getDate();
      if (day > lastDay) {
        newStart.setDate(lastDay);
        newEnd.setDate(lastDay);
      }
      return {
        workplace_id: workplaceId,
        user_id: s.user_id,
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
        role_label: s.role_label,
        notes: s.notes,
        created_by: userId,
        status: 'scheduled',
      };
    });
    try {
      const { error } = await safeMutate(supabase.from('shifts').insert(newRows));
      if (error) { setError(error.message); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">지난달 시프트 복사</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <div className="card" style={{ background: 'var(--accent-soft)', boxShadow: 'none', marginBottom: 14 }}>
        <p style={{ fontSize: 13 }}>
          <strong>{prevYear}년 {prevMonth + 1}월</strong> → <strong>{targetMonthLabel}</strong> 로 복사합니다.
          같은 일자·같은 시간으로 새 시프트가 생성됩니다.
        </p>
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : prevShifts.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, padding: 20, textAlign: 'center' }}>
          {prevYear}년 {prevMonth + 1}월 시프트가 없습니다.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {selectedIds.size}/{prevShifts.length} 선택
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelectedIds(new Set(prevShifts.map((s) => s.id)))}>전체</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setSelectedIds(new Set())}>해제</button>
            </div>
          </div>
          <div className="stack stack-2" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {prevShifts.map((s) => {
              const d = new Date(s.start_at);
              const startStr = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
              const endStr = new Date(s.end_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
              const checked = selectedIds.has(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: 10, borderRadius: 10,
                    background: checked ? 'var(--accent-soft)' : 'var(--surface-soft)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox" checked={checked} onChange={() => toggleId(s.id)}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  <span className="num" style={{ width: 60, fontSize: 12, fontWeight: 700 }}>
                    {d.getMonth() + 1}/{d.getDate()}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{s.user?.name ?? '—'}</span>
                  <span className="num text-muted" style={{ fontSize: 11 }}>{startStr}-{endStr}</span>
                </label>
              );
            })}
          </div>
        </>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving || selectedIds.size === 0} style={{ flex: 2 }}>
          <Copy size={14} /> {saving ? '복사 중...' : `${selectedIds.size}개 복사`}
        </button>
      </div>
    </BottomSheet>
  );
}
