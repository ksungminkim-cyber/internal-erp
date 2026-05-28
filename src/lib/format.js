export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', weekday: 'short' });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatRelative(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}일 전`;
  return formatDate(iso);
}

export function formatCurrency(n) {
  if (n == null || isNaN(n)) return '-';
  return new Intl.NumberFormat('ko-KR').format(Math.round(n));
}

// 영업일 기준 시작 시각 — 야간 근무자(22시 출근 → 새벽 퇴근) 처리
// 자정~새벽 6시 사이에 호출되면 전날 06시부터의 데이터를 가져오도록.
export function todayBoundary() {
  const d = new Date();
  const BUSINESS_DAY_START_HOUR = 6;
  if (d.getHours() < BUSINESS_DAY_START_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  d.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);
  return d.toISOString();
}
