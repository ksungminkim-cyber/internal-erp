'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * 출퇴근 기록 — 서버에서 서비스 롤로 INSERT (RLS 우회).
 * 본인이 해당 매장 active 멤버인지 검증 후 기록.
 */
export async function recordAttendance(workplaceId, eventType) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) throw new Error('사업장이 선택되지 않았습니다.');

  const svc = getServiceClient();

  // 본인이 해당 매장 active 멤버인지 확인
  const { data: mem } = await svc
    .from('memberships')
    .select('id')
    .eq('user_id', user.id)
    .eq('workplace_id', workplaceId)
    .eq('active', true)
    .maybeSingle();
  if (!mem) throw new Error('이 매장의 정식 직원이 아니어서 출퇴근 기록을 남길 수 없습니다.');

  const { error } = await svc.from('attendance_logs').insert({
    user_id: user.id,
    workplace_id: workplaceId,
    event_type: eventType,
  });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('sales_date')) {
      throw new Error('서버 설정 오류(마감잠금 트리거). 관리자에게 _HOTFIX SQL 실행을 요청하세요.');
    }
    if (msg.includes('마감 잠금')) {
      throw new Error('마감된 월에는 출퇴근 기록을 추가할 수 없습니다.');
    }
    throw new Error(msg);
  }
  return { ok: true };
}

/**
 * 오늘(영업일 기준) 출퇴근 로그 + 매장 현황 보드 + 이름 조회 (서비스 롤)
 */
export async function getTodayAttendance(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return { logs: [], board: [] };

  const svc = getServiceClient();

  // 영업일 시작 (자정~새벽 6시는 전일로)
  const BUSINESS_DAY_START_HOUR = 6;
  const since = new Date();
  if (since.getHours() < BUSINESS_DAY_START_HOUR) since.setDate(since.getDate() - 1);
  since.setHours(BUSINESS_DAY_START_HOUR, 0, 0, 0);

  const [{ data: logs }, { data: board }] = await Promise.all([
    svc
      .from('attendance_logs')
      .select('id, user_id, event_type, event_at, note')
      .eq('workplace_id', workplaceId)
      .gte('event_at', since.toISOString())
      .order('event_at', { ascending: false }),
    svc
      .from('attendance_current_status')
      .select('*')
      .eq('workplace_id', workplaceId)
      .order('event_at', { ascending: false }),
  ]);

  const ids = [...new Set((logs ?? []).map((l) => l.user_id).filter(Boolean))];
  let nameMap = new Map();
  if (ids.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', ids);
    nameMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  return {
    logs: (logs ?? []).map((l) => ({ ...l, profiles: { name: nameMap.get(l.user_id) ?? null } })),
    board: board ?? [],
  };
}

/**
 * 과거 출퇴근 기록 조회 (기간 + 매장 + 본인필터)
 * 서비스 롤로 직접 조회 — RLS/네트워크 hang 회피.
 */
export async function getAttendanceHistory(workplaceId, fromDate, toDate, mineOnly) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return [];

  const svc = getServiceClient();
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  let q = svc
    .from('attendance_logs')
    .select('id, user_id, event_type, event_at, note')
    .eq('workplace_id', workplaceId)
    .gte('event_at', start.toISOString())
    .lte('event_at', end.toISOString())
    .order('event_at', { ascending: false })
    .limit(2000);
  if (mineOnly) q = q.eq('user_id', user.id);

  const { data } = await q;
  const ids = [...new Set((data ?? []).map((l) => l.user_id).filter(Boolean))];
  let nameMap = new Map();
  if (ids.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', ids);
    nameMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }
  return (data ?? []).map((l) => ({ ...l, profiles: { name: nameMap.get(l.user_id) ?? null } }));
}
