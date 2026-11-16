// src/lib/welcome.js
// 홈 진입 팝업(온보딩·안 읽은 공지·오늘 체크리스트)을 띄울지 판단. 순수 로직.
// 규칙: 하루에 한 번만. 한 번 닫으면 그날은 체크리스트 때문에 다시 뜨지 않고,
//       닫은 뒤 새로 올라온 공지가 있을 때만 그 공지로 다시 뜬다. (체크리스트는 홈 "오늘 할 일"에 항상 보임)

const valid = (dismissed, today) => !!dismissed && typeof dismissed === 'object' && dismissed.d === today && Array.isArray(dismissed.anns);

/**
 * @param {{ today: string, dismissed: { d: string, anns: string[] }|null, unreadAnnIds: string[], dueChecklistCount: number, onboarding: boolean }} p
 * @returns {{ open: boolean, annIds: string[], showChecklists: boolean }}
 */
export function welcomePlan({ today, dismissed, unreadAnnIds = [], dueChecklistCount = 0, onboarding = false }) {
  const closedToday = valid(dismissed, today);
  const annIds = closedToday ? unreadAnnIds.filter((id) => !dismissed.anns.includes(id)) : [...unreadAnnIds];
  const showChecklists = !closedToday && dueChecklistCount > 0;
  return { open: onboarding || annIds.length > 0 || showChecklists, annIds, showChecklists };
}

/** 닫을 때 저장할 기록 — 오늘 날짜 + 지금까지 본 공지 id */
export function dismissRecord({ today, dismissed, unreadAnnIds = [] }) {
  const prev = valid(dismissed, today) ? dismissed.anns : [];
  return { d: today, anns: [...new Set([...prev, ...unreadAnnIds])] };
}
