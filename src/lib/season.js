// 시즌 테마 기간과 고르는 규칙 — 서버 인라인 스크립트와 클라이언트(SeasonKeeper)가 같이 쓴다.

export const XMAS_END = Date.UTC(2026, 11, 31, 15);   // 크리스마스: 2026-12-31 까지 (KST)
export const NEWYEAR_END = Date.UTC(2027, 0, 15, 15); // 새해: 2027-01-01 ~ 01-15 (KST)

/**
 * 지금 보여줄 시즌: 'xmas' | 'newyear' | 'off'.
 * 주소에 ?season=newyear (또는 xmas, off) 가 있으면 날짜와 상관없이 그 화면 (미리 보기).
 * 인라인 스크립트에 toString() 으로 그대로 넣으므로 바깥 변수를 참조하지 않는다.
 */
export function pickSeason(search, now, xmasEnd, newyearEnd) {
  var m = String(search).match(/[?&]season=(xmas|newyear|off)(?:&|$)/);
  if (m) return m[1];
  return now < xmasEnd ? 'xmas' : now < newyearEnd ? 'newyear' : 'off';
}
