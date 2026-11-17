// 전체(본사) 보기 규칙 — 본사는 일하는 매장이 아니라 "전 매장을 보는 자리"다.
// 본사를 고른 상태에서 어떤 메뉴를 숨기고, 어떤 화면에서 매장을 먼저 고르게 할지 여기서 정한다.

export const HQ_NAME = '본사';
export const HQ_LABEL = '전체 (본사)';

export function isHQWorkplace(workplace) {
  return workplace?.name === HQ_NAME;
}

/** 소속 목록을 본사(없으면 null)와 매장들로 나눈다. */
export function splitWorkplaces(memberships) {
  const list = memberships ?? [];
  return {
    hq: list.find((m) => isHQWorkplace(m.workplaces)) ?? null,
    stores: list.filter((m) => !isHQWorkplace(m.workplaces)),
  };
}

const under = (pathname, paths) => paths.some((p) => pathname === p || pathname.startsWith(p + '/'));

// 매장 일상 운영 — 전체 보기 메뉴에서 숨긴다
const DAILY_STORE_PATHS = ['/attendance', '/schedule', '/handover', '/checklists', '/inventory', '/sales', '/kpis'];

// 매장 하나의 자료를 보는 화면 — 전체 보기에서 열면 매장을 먼저 고르게 한다
const STORE_PATHS = [
  ...DAILY_STORE_PATHS,
  '/reports', '/closing', '/announcements',
  '/equipment', '/complaints', '/delegations', '/suggestions',
];

export function hiddenInHQView(href) {
  return under(href, DAILY_STORE_PATHS);
}

export function needsStore(pathname) {
  return under(pathname, STORE_PATHS);
}

/**
 * 내 차례인 결재 수. steps = 내가 결재자이고 아직 대기 중인 단계들(approval_requests 포함).
 * workplaceId 를 주면 그 매장 문서만, null 이면 전 매장.
 */
export function countInbox(steps, workplaceId) {
  return (steps ?? []).filter((s) =>
    (workplaceId == null || s.approval_requests?.workplace_id === workplaceId) &&
    s.approval_requests?.status === 'pending' &&
    s.approval_requests?.current_step === s.step_order
  ).length;
}
