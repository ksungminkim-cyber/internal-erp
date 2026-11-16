// src/lib/reads.js
// 화면 조회 전용 호출 — 서버 액션 대신 /api/read 로 보낸다.
// 이유: 서버 액션은 브라우저가 한 번에 하나씩만 보낸다(앞의 것이 끝나야 다음 것 출발).
//       카드가 여러 개인 화면(홈·재고·매출)은 조회가 줄줄이 밀려 느려졌다. fetch 는 동시에 나간다.
// 서버 쪽 함수는 기존 서버 액션 그대로(각자 로그인·권한 검사) — src/app/api/read/route.js 의 목록 참고.
// 저장·수정·삭제는 계속 서버 액션을 쓴다.

export async function readWith(fetchFn, fn, args) {
  const r = await fetchFn('/api/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args }),
    cache: 'no-store',
  });
  if (r.redirected || !(r.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('로그인이 만료됐어요. 새로고침 후 다시 로그인해 주세요.');
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || `${fn} 조회 실패 (${r.status})`);
  return j?.data;
}

const mk = (fn) => (...args) => readWith(fetch, fn, args);

// 재고
export const getOrderSuggestions = mk('getOrderSuggestions');
export const getIdleItems = mk('getIdleItems');
export const getPendingInbound = mk('getPendingInbound');
export const getInventoryItemHistory = mk('getInventoryItemHistory');
export const getProductUsage = mk('getProductUsage');
// 홈·공통
export const getTrendPicks = mk('getTrendPicks');
export const getPushConfig = mk('getPushConfig');
export const getProfileNames = mk('getProfileNames');
// 근태
export const getMyShiftReminders = mk('getMyShiftReminders');
export const getTodayAttendance = mk('getTodayAttendance');
export const getMissingAttendance = mk('getMissingAttendance');
// 매출
export const getSalesSummary = mk('getSalesSummary');
export const getProductSales = mk('getProductSales');
export const getSalesKpi = mk('getSalesKpi');
export const getDaySalesDetail = mk('getDaySalesDetail');
export const getSalesTips = mk('getSalesTips');
// 시프트·결재·인수인계·마감
export const getScheduleData = mk('getScheduleData');
export const getApprovals = mk('getApprovals');
export const getApproverCandidates = mk('getApproverCandidates');
export const getApprovalDetail = mk('getApprovalDetail');
export const getHandoverNotes = mk('getHandoverNotes');
export const getClosingSourceData = mk('getClosingSourceData');
// 광고
export const getAdDashboard = mk('getAdDashboard');
export const getAdLive = mk('getAdLive');
export const getAdActions = mk('getAdActions');
export const getAdSales = mk('getAdSales');
// 인력 배치 (본사)
export const getStaffingData = mk('getStaffingData');
