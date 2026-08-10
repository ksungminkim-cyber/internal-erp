// 시프트(계획) ↔ 근태 로그(실적) 매칭 — 스케줄 페이지·리마인더 배너·누락 위젯 공용

export const LATE_THRESHOLD_MIN = 10; // 10분 이내는 정시
export const ABSENT_GRACE_MIN = 30;   // 시작 후 30분 지나도 출근 없으면 결근
export const LOG_WINDOW_MS = 2 * 3600000; // 시프트 전후 ±2시간 로그 매칭 창

// 해당 시프트 시간 범위(±2h) 안의 본인 출퇴근 로그 (시간순)
function shiftLogs(shift, logs) {
  const start = new Date(shift.start_at).getTime();
  const end = new Date(shift.end_at).getTime();
  return logs
    .filter((l) => l.user_id === shift.user_id)
    .filter((l) => {
      const t = new Date(l.event_at).getTime();
      return t >= start - LOG_WINDOW_MS && t <= end + LOG_WINDOW_MS;
    })
    .sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
}

export function matchAttendance(shift, logs) {
  const start = new Date(shift.start_at);
  const end = new Date(shift.end_at);
  const userLogs = shiftLogs(shift, logs);

  const clockIn = userLogs.find((l) => l.event_type === 'clock_in');
  const clockOut = [...userLogs].reverse().find((l) => l.event_type === 'clock_out');

  if (!clockIn) {
    // 시프트 시작 후 30분 이상 지나도 출근 없으면 결근
    if (Date.now() > start.getTime() + ABSENT_GRACE_MIN * 60000) {
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

/**
 * 시프트 하나의 기록 누락 상태 — 직원 배너·관리자 누락 위젯 공용.
 * 취소된 시프트는 null.
 * - missingIn:  시작 지났는데 출근 기록 없음
 * - missingOut: 출근은 있는데 종료 지나도 퇴근 기록 없음
 * - graceInPassed / graceOutPassed: 유예(30분/2시간)까지 지난 확정 누락 (관리자 위젯 기준)
 */
export function shiftRecordStatus(shift, logs, now = Date.now()) {
  if (shift.status === 'cancelled') return null;
  const start = new Date(shift.start_at).getTime();
  const end = new Date(shift.end_at).getTime();
  const userLogs = shiftLogs(shift, logs);
  const clockIn = userLogs.find((l) => l.event_type === 'clock_in') ?? null;
  const clockOut = [...userLogs].reverse().find((l) => l.event_type === 'clock_out') ?? null;
  return {
    clockIn,
    clockOut,
    started: now > start,
    ended: now > end,
    missingIn: !clockIn && now > start,
    missingOut: !!clockIn && !clockOut && now > end,
    graceInPassed: !clockIn && now > start + ABSENT_GRACE_MIN * 60000,
    graceOutPassed: !!clockIn && !clockOut && now > end + LOG_WINDOW_MS,
  };
}
