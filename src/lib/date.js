/**
 * 날짜 키 유틸 — 시간대(UTC vs KST) 버그 방지용 공용 함수.
 *
 * 문제: `new Date().toISOString().slice(0, 10)` 은 UTC 기준이라
 * 한국(UTC+9)에서 자정~오전 9시 사이엔 "전날" 날짜가 나와
 * '오늘' 판정·날짜 그룹핑이 하루씩 밀리는 버그가 반복됐음.
 */

// 로컬(브라우저) 기준 YYYY-MM-DD. 한국 사용자는 브라우저가 KST이므로 KST 날짜.
export function ymd(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// 오늘(로컬 기준) YYYY-MM-DD
export function todayKey() {
  return ymd(new Date());
}

/**
 * 서버(UTC 런타임)에서 한국시간 기준 날짜 키.
 * 서버 액션/SSR에서 '오늘'을 계산할 때 사용 (서버는 UTC라 로컬=UTC가 됨).
 */
export function kstDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  // en-CA 로케일은 YYYY-MM-DD 포맷
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}
