'use server';

import { getServiceClient, getActor } from '@/lib/server/guard';

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
    .select('html, closed_date, built_at, updated_at')
    .eq('id', 'nocturne')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, html: null };
  return { ok: true, html: data.html, closed: data.closed_date, built: data.built_at, updated: data.updated_at };
}
