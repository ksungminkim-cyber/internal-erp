'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatTime } from '@/lib/format';
import { downloadCsv, fmtDateTime } from '@/lib/csvExport';
import { ChevronLeft, Download, Calendar, Users, Plus, Pencil, Trash2, X } from 'lucide-react';
import {
  getAttendanceHistory,
  correctAttendanceLog,
  addAttendanceLog,
  deleteAttendanceLog,
  getWorkplaceMembers,
} from '../actions';

const EVENT_LABEL = {
  clock_in: '출근',
  clock_out: '퇴근',
  break_start: '휴게',
  break_end: '복귀',
};

const EVENT_OPTIONS = [
  { v: 'clock_in', l: '출근' },
  { v: 'clock_out', l: '퇴근' },
  { v: 'break_start', l: '휴게' },
  { v: 'break_end', l: '복귀' },
];

// ISO(UTC) → datetime-local 입력값(로컬), 그리고 그 반대
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(val) {
  return new Date(val).toISOString();
}
// 로컬(KST) 기준 날짜 키 — slice(0,10)은 UTC라 새벽/밤 기록이 전날·다음날로 밀림
function localDateKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AttendanceHistoryPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, currentWorkplace, supabase, isManager } = useApp();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userFilter, setUserFilter] = useState('all'); // 'all' | 'mine'
  const [editing, setEditing] = useState(null); // 보정 대상 로그
  const [adding, setAdding] = useState(false);   // 기록 추가 시트
  const [members, setMembers] = useState([]);    // 직원 목록 (추가용)

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    setLoading(true);
    try {
      const data = await getAttendanceHistory(currentWorkplaceId, from, to, userFilter === 'mine');
      setLogs(data ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkplaceId, user, from, to, userFilter]);

  useEffect(() => { load(); }, [load]);

  // 매니저면 직원 목록 미리 로드 (기록 추가용)
  useEffect(() => {
    if (!isManager || !currentWorkplaceId) return;
    getWorkplaceMembers(currentWorkplaceId).then((m) => setMembers(m ?? [])).catch(() => setMembers([]));
  }, [isManager, currentWorkplaceId]);

  function exportCsv() {
    if (!logs.length) return;
    const ym = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
    const wpName = currentWorkplace?.name?.replace(/\s+/g, '_') || 'workplace';
    downloadCsv(
      `attendance_${wpName}_${ym}.csv`,
      [
        { key: 'event_at', label: '일시', format: (v) => fmtDateTime(v) },
        { key: 'name', label: '직원' },
        { key: 'event_type', label: '구분', format: (v) => EVENT_LABEL[v] || v },
        { key: 'note', label: '메모' },
      ],
      logs.map((r) => ({ ...r, name: r.profiles?.name ?? '' }))
    );
  }

  // 날짜별 그룹핑
  const groupedByDate = logs.reduce((acc, log) => {
    const date = localDateKey(log.event_at);
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});
  const dates = Object.keys(groupedByDate).sort().reverse();

  return (
    <>
      <PageHeader
        title="근태 기록"
        subtitle={`${currentWorkplace?.name ?? ''} · 과거 출퇴근 조회`}
        action={
          <Link href="/attendance" className="btn btn-ghost btn-icon">
            <ChevronLeft size={20} />
          </Link>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 필터 카드 */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} color="var(--accent)" />
            <h2 className="h4">기간 선택</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
            />
            <span className="text-muted">~</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
            />
          </div>

          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            <button
              className={`segment-item ${userFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setUserFilter('all')}
            >
              <Users size={12} /> 전체
            </button>
            <button
              className={`segment-item ${userFilter === 'mine' ? 'is-active' : ''}`}
              onClick={() => setUserFilter('mine')}
            >
              내 기록만
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              총 <strong style={{ color: 'var(--text)' }}>{logs.length}</strong>건
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {isManager && (
                <button onClick={() => setAdding(true)} className="btn btn-soft btn-sm">
                  <Plus size={14} /> 기록 추가
                </button>
              )}
              <button onClick={exportCsv} className="btn btn-primary btn-sm" disabled={!logs.length}>
                <Download size={14} /> CSV 다운로드
              </button>
            </div>
          </div>
          {isManager && (
            <p className="text-muted" style={{ fontSize: 11, marginTop: -4 }}>
              <Pencil size={10} style={{ verticalAlign: 'middle' }} /> 기록을 누르면 시각을 보정하거나 삭제할 수 있어요.
            </p>
          )}
        </section>

        {/* 결과 */}
        {logs.length === 0 ? (
          <div className="card empty">
            <div className="empty-desc">{loading ? '조회 중...' : '해당 기간에 기록이 없어요'}</div>
          </div>
        ) : (
          <div className="stack stack-3">
            {dates.map((date) => {
              const dateLogs = groupedByDate[date];
              const d = new Date(date + 'T00:00:00');
              const dateLabel = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
              return (
                <section key={date}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <h3 className="h4">{dateLabel}</h3>
                    <span className="text-muted" style={{ fontSize: 12 }}>{dateLogs.length}건</span>
                  </div>
                  <div className="card" style={{ padding: 8 }}>
                    {dateLogs.map((l, i) => (
                      <div key={l.id}>
                        <div
                          onClick={isManager ? () => setEditing(l) : undefined}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: 10,
                            cursor: isManager ? 'pointer' : 'default',
                            borderRadius: 8,
                          }}
                          className={isManager ? 'interactive' : undefined}
                        >
                          <span className="num" style={{ fontSize: 14, fontWeight: 800, width: 54 }}>{formatTime(l.event_at)}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{l.profiles?.name || '—'}</span>
                          {l.note && <span className="text-muted" style={{ fontSize: 11 }}>{l.note}</span>}
                          <span className="tag" style={{ fontSize: 11 }}>{EVENT_LABEL[l.event_type] || l.event_type}</span>
                          {isManager && <Pencil size={12} color="var(--text-muted)" />}
                        </div>
                        {i < dateLogs.length - 1 && <hr className="divider" style={{ margin: '0 10px' }} />}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {editing && (
        <CorrectSheet
          log={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(); }}
        />
      )}

      {adding && (
        <AddSheet
          workplaceId={currentWorkplaceId}
          members={members}
          defaultDate={to}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); }}
        />
      )}
    </>
  );
}

// ───── 근태 보정 시트 (시각/구분 수정 · 삭제) ─────
function CorrectSheet({ log, onClose, onDone }) {
  const [eventType, setEventType] = useState(log.event_type);
  const [eventAt, setEventAt] = useState(toLocalInput(log.event_at));
  const [note, setNote] = useState(log.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!eventAt) return setError('시각을 입력해주세요.');
    setSaving(true);
    try {
      const res = await correctAttendanceLog({
        logId: log.id,
        eventAt: localInputToIso(eventAt),
        eventType,
        note,
      });
      if (res?.error) { setError(res.error); return; }
      onDone();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('이 기록을 삭제하시겠습니까?')) return;
    setSaving(true);
    try {
      const res = await deleteAttendanceLog({ logId: log.id });
      if (res?.error) { setError(res.error); return; }
      onDone();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 className="h3">근태 보정</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
        {log.profiles?.name || '직원'}님의 기록
      </p>

      <label className="label">구분</label>
      <div className="segment" style={{ width: '100%' }}>
        {EVENT_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`segment-item ${eventType === o.v ? 'is-active' : ''}`}
            onClick={() => setEventType(o.v)}
            style={{ flex: 1 }}
          >
            {o.l}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>시각</label>
      <input className="input" type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} />

      <label className="label" style={{ marginTop: 12 }}>메모 (선택)</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 배정 전 출근 보정" />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={remove} disabled={saving} style={{ color: 'var(--danger)' }}>
          <Trash2 size={14} />
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}

// ───── 누락 기록 추가 시트 ─────
function AddSheet({ workplaceId, members, defaultDate, onClose, onDone }) {
  const [userId, setUserId] = useState('');
  const [eventType, setEventType] = useState('clock_in');
  const [eventAt, setEventAt] = useState(`${defaultDate}T09:00`);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    if (!userId) return setError('직원을 선택해주세요.');
    if (!eventAt) return setError('시각을 입력해주세요.');
    setSaving(true);
    try {
      const res = await addAttendanceLog({
        workplaceId,
        userId,
        eventType,
        eventAt: localInputToIso(eventAt),
        note,
      });
      if (res?.error) { setError(res.error); return; }
      onDone();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">근태 기록 추가</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">직원</label>
      <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
        <option value="">선택</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.name} {m.role === 'owner' ? '(대표)' : m.role === 'manager' ? '(매니저)' : ''}
          </option>
        ))}
      </select>

      <label className="label" style={{ marginTop: 12 }}>구분</label>
      <div className="segment" style={{ width: '100%' }}>
        {EVENT_OPTIONS.map((o) => (
          <button
            key={o.v}
            type="button"
            className={`segment-item ${eventType === o.v ? 'is-active' : ''}`}
            onClick={() => setEventType(o.v)}
            style={{ flex: 1 }}
          >
            {o.l}
          </button>
        ))}
      </div>

      <label className="label" style={{ marginTop: 12 }}>시각</label>
      <input className="input" type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} />

      <label className="label" style={{ marginTop: 12 }}>메모 (선택)</label>
      <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 수기 보정" />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '추가 중...' : '추가'}
        </button>
      </div>
    </BottomSheet>
  );
}
