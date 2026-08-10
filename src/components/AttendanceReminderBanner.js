'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import { shiftRecordStatus, LOG_WINDOW_MS } from '@/lib/attendanceMatch';
import { getMyShiftReminders, recordAttendance } from '@/app/(app)/attendance/actions';
import { AlarmClock, LogIn, LogOut, X } from 'lucide-react';

const DISMISS_KEY = 'att_reminder_dismissed';
const DISMISS_TTL_MS = 7 * 24 * 3600000;

function getDismissed() {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISS_KEY)) || {};
    // 7일 지난 키 정리
    const now = Date.now();
    const fresh = Object.fromEntries(
      Object.entries(raw).filter(([, ts]) => now - ts < DISMISS_TTL_MS)
    );
    if (Object.keys(fresh).length !== Object.keys(raw).length) {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return {};
  }
}

function dismiss(key) {
  try {
    const cur = getDismissed();
    cur[key] = Date.now();
    localStorage.setItem(DISMISS_KEY, JSON.stringify(cur));
  } catch { /* localStorage 불가 환경은 무시 */ }
}

/**
 * 시프트는 있는데 출퇴근 기록이 없을 때 어느 페이지에서든 보이는 리마인더.
 * 우선순위: 진행 중 출근 누락(원탭 출근) > 종료 +2h 이내 퇴근 누락(원탭 퇴근)
 *          > 지난 누락(관리자 보정 안내)
 */
function computeAlert(shifts, logs) {
  const now = Date.now();
  let oneTapIn = null, oneTapOut = null, stale = null;
  for (const s of shifts) {
    const st = shiftRecordStatus(s, logs, now);
    if (!st) continue;
    const end = new Date(s.end_at).getTime();
    if (st.missingIn && !st.ended) {
      oneTapIn = { kind: 'in_now', shift: s };
    } else if (st.missingOut && now <= end + LOG_WINDOW_MS) {
      oneTapOut = { kind: 'out_now', shift: s };
    } else if (st.missingIn || st.missingOut) {
      stale = { kind: st.missingIn ? 'in_missed' : 'out_missed', shift: s };
    }
  }
  return oneTapIn || oneTapOut || stale;
}

export default function AttendanceReminderBanner() {
  const { user, currentWorkplaceId } = useApp();
  const [alert, setAlert] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user || !currentWorkplaceId) return;
    try {
      const { shifts, logs } = await getMyShiftReminders(currentWorkplaceId);
      const a = computeAlert(shifts ?? [], logs ?? []);
      if (a && getDismissed()[`${a.shift.id}:${a.kind}`]) {
        setAlert(null);
        return;
      }
      setAlert(a);
    } catch {
      setAlert(null);
    }
  }, [user, currentWorkplaceId]);

  // setState는 await 이후 비동기 실행 — 동기 setState 아님 (룰 오탐)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (!alert) return null;

  const isOneTap = alert.kind === 'in_now' || alert.kind === 'out_now';
  const eventType = alert.kind === 'in_now' ? 'clock_in' : 'clock_out';
  const time = new Date(alert.kind === 'in_now' ? alert.shift.start_at : alert.shift.end_at)
    .toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

  const message =
    alert.kind === 'in_now'  ? `${time} 시프트가 시작됐는데 출근 기록이 없어요.` :
    alert.kind === 'out_now' ? `${time}에 시프트가 끝났는데 퇴근 기록이 없어요.` :
    alert.kind === 'in_missed' ? '지난 시프트에 출근 기록이 없어요. 관리자에게 보정을 요청하세요.' :
    '지난 시프트에 퇴근 기록이 없어요. 관리자에게 보정을 요청하세요.';

  async function onTap() {
    setBusy(true);
    try {
      const res = await recordAttendance(currentWorkplaceId, eventType);
      if (!res?.error) await load();
    } finally {
      setBusy(false);
    }
  }

  function onDismiss() {
    dismiss(`${alert.shift.id}:${alert.kind}`);
    setAlert(null);
  }

  return (
    <div
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '12px 16px 0', padding: '10px 12px',
        background: 'var(--warning-soft)', border: '1px solid var(--warning)',
      }}
    >
      <AlarmClock size={18} color="var(--warning)" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{message}</span>
      {isOneTap ? (
        <button className="btn btn-primary btn-sm" onClick={onTap} disabled={busy} style={{ flexShrink: 0 }}>
          {alert.kind === 'in_now' ? <LogIn size={14} /> : <LogOut size={14} />}
          {busy ? '기록 중...' : alert.kind === 'in_now' ? '지금 출근' : '지금 퇴근'}
        </button>
      ) : (
        <Link href="/attendance/history" className="btn btn-soft btn-sm" style={{ flexShrink: 0 }}>
          기록 보기
        </Link>
      )}
      <button className="btn btn-ghost btn-icon" onClick={onDismiss} aria-label="닫기" style={{ flexShrink: 0, width: 28, height: 28 }}>
        <X size={14} />
      </button>
    </div>
  );
}
