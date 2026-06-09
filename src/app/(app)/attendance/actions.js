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
  // 에러는 throw 대신 return — Next.js 운영 빌드가 throw 메시지를 가려
  // "An error occurred…"로 표시되던 문제 방지
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!workplaceId) return { ok: false, error: '사업장이 선택되지 않았습니다.' };

  const svc = getServiceClient();

  // 본인이 해당 매장 active 멤버인지 확인
  const { data: mem } = await svc
    .from('memberships')
    .select('id')
    .eq('user_id', user.id)
    .eq('workplace_id', workplaceId)
    .eq('active', true)
    .maybeSingle();
  if (!mem) return { ok: false, error: '이 매장의 정식 직원이 아니어서 출퇴근 기록을 남길 수 없습니다.' };

  const { error } = await svc.from('attendance_logs').insert({
    user_id: user.id,
    workplace_id: workplaceId,
    event_type: eventType,
  });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('sales_date')) {
      return { ok: false, error: '서버 설정 오류(마감잠금 트리거). 관리자에게 문의하세요.' };
    }
    if (msg.includes('마감 잠금') || msg.includes('locked')) {
      return { ok: false, error: '마감된 월에는 출퇴근 기록을 추가할 수 없습니다.' };
    }
    return { ok: false, error: msg || '기록 중 오류가 발생했습니다.' };
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
 * 요청자가 해당 매장의 관리자(매니저/대표/본사/super_admin)인지 검증.
 * 근태 보정은 관리자만 가능.
 */
async function isManagerOf(svc, userId, workplaceId) {
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', userId).maybeSingle(),
    svc.from('memberships').select('role, workplace_id, workplaces(name)').eq('user_id', userId).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const isManagerHere = (mems ?? []).some(
    (m) => m.workplace_id === workplaceId && (m.role === 'manager' || m.role === 'owner')
  );
  return prof?.is_super_admin === true || prof?.is_executive === true || isHQ || isManagerHere;
}

function mapAttendanceError(error) {
  const msg = String(error?.message || '');
  if (msg.includes('마감 잠금') || msg.includes('locked')) {
    return '마감된 월의 기록은 수정할 수 없습니다.';
  }
  if (msg.includes('sales_date')) {
    return '서버 설정 오류(마감잠금 트리거). 관리자에게 문의하세요.';
  }
  return msg || '처리 중 오류가 발생했습니다.';
}

/**
 * 근태 기록 보정 — 시각/구분/메모 수정 (관리자만)
 */
export async function correctAttendanceLog({ logId, eventAt, eventType, note }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!logId || !eventAt) return { ok: false, error: '필수 항목이 누락되었습니다.' };

  const svc = getServiceClient();
  const { data: log } = await svc
    .from('attendance_logs')
    .select('id, workplace_id')
    .eq('id', logId)
    .maybeSingle();
  if (!log) return { ok: false, error: '기록을 찾을 수 없습니다.' };
  if (!(await isManagerOf(svc, user.id, log.workplace_id))) {
    return { ok: false, error: '근태 보정 권한이 없습니다. (매니저/대표만 가능)' };
  }

  const patch = { event_at: eventAt };
  if (eventType) patch.event_type = eventType;
  if (note !== undefined) patch.note = note || null;

  const { error } = await svc.from('attendance_logs').update(patch).eq('id', logId);
  if (error) return { ok: false, error: mapAttendanceError(error) };
  return { ok: true };
}

/**
 * 누락된 근태 기록 추가 — 관리자가 직원·시각·구분 지정 (관리자만)
 */
export async function addAttendanceLog({ workplaceId, userId, eventType, eventAt, note }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!workplaceId || !userId || !eventType || !eventAt) {
    return { ok: false, error: '직원·구분·시각을 모두 입력해주세요.' };
  }

  const svc = getServiceClient();
  if (!(await isManagerOf(svc, user.id, workplaceId))) {
    return { ok: false, error: '근태 보정 권한이 없습니다. (매니저/대표만 가능)' };
  }

  const { error } = await svc.from('attendance_logs').insert({
    user_id: userId,
    workplace_id: workplaceId,
    event_type: eventType,
    event_at: eventAt,
    note: note || null,
  });
  if (error) return { ok: false, error: mapAttendanceError(error) };
  return { ok: true };
}

/**
 * 근태 기록 삭제 — 잘못 찍힌 기록 제거 (관리자만)
 */
export async function deleteAttendanceLog({ logId }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!logId) return { ok: false, error: '기록 ID가 누락되었습니다.' };

  const svc = getServiceClient();
  const { data: log } = await svc
    .from('attendance_logs')
    .select('id, workplace_id')
    .eq('id', logId)
    .maybeSingle();
  if (!log) return { ok: false, error: '기록을 찾을 수 없습니다.' };
  if (!(await isManagerOf(svc, user.id, log.workplace_id))) {
    return { ok: false, error: '근태 보정 권한이 없습니다. (매니저/대표만 가능)' };
  }

  const { error } = await svc.from('attendance_logs').delete().eq('id', logId);
  if (error) return { ok: false, error: mapAttendanceError(error) };
  return { ok: true };
}

/**
 * 매장 직원 목록 (근태 보정 시 직원 선택용) — 관리자만
 */
export async function getWorkplaceMembers(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return [];
  if (!workplaceId) return [];

  const svc = getServiceClient();
  if (!(await isManagerOf(svc, user.id, workplaceId))) return [];

  const { data: mems } = await svc
    .from('memberships')
    .select('user_id, role')
    .eq('workplace_id', workplaceId)
    .eq('active', true);
  const ids = [...new Set((mems ?? []).map((m) => m.user_id).filter(Boolean))];
  if (ids.length === 0) return [];
  const { data: profs } = await svc.from('profiles').select('user_id, name, retired_at').in('user_id', ids);
  const profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
  return (mems ?? [])
    .filter((m) => !profMap.get(m.user_id)?.retired_at)
    .map((m) => ({ user_id: m.user_id, name: profMap.get(m.user_id)?.name || '—', role: m.role }));
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
