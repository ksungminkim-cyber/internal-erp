'use server';

import { getServiceClient, getActor } from '@/lib/server/guard';
import { fetchAdsLive, invalidateAdsLive } from '@/lib/server/adsLive';
import { runAdOp } from '@/lib/server/adsOps';

// 대표 전용: 어느 매장이든 role='owner' 이거나 super_admin / 임원. 본사 일반 직원·매니저는 제외.
async function isOwner(svc, userId) {
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', userId).maybeSingle(),
    svc.from('memberships').select('role').eq('user_id', userId).eq('active', true),
  ]);
  return prof?.is_super_admin === true || prof?.is_executive === true || (mems ?? []).some((m) => m.role === 'owner');
}

export async function getAdDashboard() {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  if (!(await isOwner(svc, user.id))) return { ok: false, error: '권한이 없습니다.', forbidden: true };
  const { data, error } = await svc.from('ad_dashboard')
    .select('data, closed_date, built_at, updated_at')
    .eq('id', 'nocturne')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data?.data) return { ok: true, data: null };
  return { ok: true, data: data.data, closed: data.closed_date, built: data.built_at, updated: data.updated_at };
}

// 오늘 실시간: 네이버·구글·메타 광고 API를 직접 조회 (5분 캐시). 당근은 오늘 수치 없음.
export async function getAdLive() {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  if (!(await isOwner(svc, user.id))) return { ok: false, error: '권한이 없습니다.', forbidden: true };
  try {
    return { ok: true, live: await fetchAdsLive() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 해석 카드의 버튼: 광고 설정을 실제로 바꾼다 (대표 전용). 결과는 ad_actions 에 남긴다 (표가 없으면 기록만 건너뜀).
export async function runAdAction({ ch, kind, label, args }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  if (!(await isOwner(svc, user.id))) return { ok: false, error: '권한이 없습니다.', forbidden: true };
  let ok = true, result;
  try { result = await runAdOp(kind, args || {}); invalidateAdsLive(); } catch (e) { ok = false; result = e.message; }
  await svc.from('ad_actions').insert({ user_id: user.id, ch, kind, label, args: args || {}, ok, result }).then(() => {}, () => {});
  return ok ? { ok: true, result } : { ok: false, error: result };
}

export async function getAdActions() {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  if (!(await isOwner(svc, user.id))) return { ok: false, error: '권한이 없습니다.', forbidden: true };
  const { data, error } = await svc.from('ad_actions').select('id, at, ch, kind, label, ok, result').order('at', { ascending: false }).limit(10);
  if (error) return { ok: true, actions: [] }; // 표가 아직 없으면 빈 목록
  return { ok: true, actions: data || [] };
}
