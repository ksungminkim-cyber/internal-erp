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
 * 결재 목록 조회 (감사용) — 서비스롤 + 매장 멤버십 검증.
 * 상태/종류/검색/기간/스코프 필터를 서버에서 적용하고 요약까지 반환.
 * 클라이언트 RLS로 과거 결재가 누락되던 문제 해결.
 */
// 진행중인데 N일 이상 결재 안 된 건 = '지연(장기 미결)'
const OVERDUE_DAYS = 3;

export async function getApprovals({ workplaceId, scope = 'all', status = 'all', docType = 'all', from, to, search, allWorkplaces = false } = {}) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { items: [], summary: emptySummary(), error: '로그인이 필요합니다.' };
  if (!workplaceId && !allWorkplaces) return { items: [], summary: emptySummary() };

  const svc = getServiceClient();

  // 권한: 해당 매장 active 멤버 또는 본사/super_admin·임원만 목록 조회
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const isAdmin = isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  const isMemberHere = (mems ?? []).some((m) => m.workplace_id === workplaceId);
  // 전 매장 통합 뷰는 본사/super_admin/임원만
  const crossWp = allWorkplaces && isAdmin;
  if (!crossWp && !(isMemberHere || isAdmin)) {
    return { items: [], summary: emptySummary(), error: '조회 권한이 없습니다.' };
  }

  const overdueThreshold = new Date(Date.now() - OVERDUE_DAYS * 86400000).toISOString();

  let q = svc
    .from('approval_requests')
    .select('id, title, status, total_amount, current_step, submitted_at, drafter_id, doc_type, workplace_id')
    .order('submitted_at', { ascending: false })
    .limit(crossWp ? 1000 : 500);
  if (!crossWp) q = q.eq('workplace_id', workplaceId);
  if (scope === 'mine') q = q.eq('drafter_id', user.id);
  if (status === 'overdue') {
    q = q.eq('status', 'pending').lte('submitted_at', overdueThreshold);
  } else if (status && status !== 'all') {
    q = q.eq('status', status);
  }
  if (docType && docType !== 'all') q = q.eq('doc_type', docType);
  if (from) q = q.gte('submitted_at', from);
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    q = q.lte('submitted_at', end.toISOString());
  }
  if (search && search.trim()) q = q.ilike('title', `%${search.trim()}%`);

  const { data: reqs } = await q;
  const rows = reqs ?? [];

  // 단계 (진행단계 표시 + inbox 필터용)
  const requestIds = rows.map((r) => r.id);
  const { data: steps } = requestIds.length > 0
    ? await svc.from('approval_steps').select('id, request_id, step_order, approver_id, status').in('request_id', requestIds)
    : { data: [] };
  const stepsByReq = new Map();
  (steps ?? []).forEach((s) => {
    if (!stepsByReq.has(s.request_id)) stepsByReq.set(s.request_id, []);
    stepsByReq.get(s.request_id).push(s);
  });

  // 기안자 이름
  const drafterIds = [...new Set(rows.map((r) => r.drafter_id).filter(Boolean))];
  let drafterMap = new Map();
  if (drafterIds.length > 0) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', drafterIds);
    drafterMap = new Map((profs ?? []).map((p) => [p.user_id, p.name]));
  }

  // 매장명 (전 매장 통합 뷰에서 어느 매장 결재인지 표시)
  const wpIds = [...new Set(rows.map((r) => r.workplace_id).filter(Boolean))];
  let wpMap = new Map();
  if (wpIds.length > 0) {
    const { data: wps } = await svc.from('workplaces').select('id, name').in('id', wpIds);
    wpMap = new Map((wps ?? []).map((w) => [w.id, w.name]));
  }

  let items = rows.map((r) => ({
    ...r,
    drafter: { name: drafterMap.get(r.drafter_id) ?? null },
    workplace: { name: wpMap.get(r.workplace_id) ?? null },
    overdue: r.status === 'pending' && r.submitted_at != null && r.submitted_at <= overdueThreshold,
    approval_steps: stepsByReq.get(r.id) ?? [],
  }));

  // inbox: 내가 현재 단계 승인 대기
  if (scope === 'inbox') {
    items = items.filter(
      (r) => r.status === 'pending' &&
        r.approval_steps.some((s) => s.step_order === r.current_step && s.approver_id === user.id && s.status === 'waiting')
    );
  }

  // 요약 (필터 적용된 집합 기준)
  const summary = emptySummary();
  for (const r of items) {
    summary.count += 1;
    if (summary.byStatus[r.status] != null) summary.byStatus[r.status] += 1;
    if (r.overdue) summary.overdue += 1;
    const amt = Number(r.total_amount) || 0;
    summary.totalAmount += amt;
    if (r.status === 'approved') summary.approvedAmount += amt;
  }

  return { items, summary, crossWorkplace: crossWp };
}

function emptySummary() {
  return {
    count: 0,
    byStatus: { pending: 0, approved: 0, rejected: 0, cancelled: 0 },
    overdue: 0,
    totalAmount: 0,
    approvedAmount: 0,
  };
}

/**
 * 결재 상세 조회 — 서비스 롤로 RLS 우회 (기안자가 자기 문서를 못 읽어
 * "존재하지 않는 문서"로 뜨던 문제 해결). 권한 검증 후 반환.
 */
export async function getApprovalDetail(id) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: '로그인이 필요합니다.' };
  if (!id) return { notFound: true };

  const svc = getServiceClient();

  const [
    { data: request },
    { data: items },
    { data: steps },
    { data: attachments },
    { data: shifts },
  ] = await Promise.all([
    svc.from('approval_requests')
      .select('*, drafter:profiles!approval_requests_drafter_id_fkey(name, phone), workplaces(name)')
      .eq('id', id)
      .maybeSingle(),
    svc.from('expense_items').select('*').eq('request_id', id).order('created_at'),
    svc.from('approval_steps')
      .select('*, approver:profiles!approval_steps_approver_id_fkey(name)')
      .eq('request_id', id)
      .order('step_order'),
    svc.from('approval_attachments').select('*').eq('request_id', id).order('uploaded_at'),
    svc.from('shifts')
      .select('*, user:profiles!shifts_user_id_fkey(name)')
      .eq('approval_request_id', id)
      .order('start_at'),
  ]);

  if (!request) return { notFound: true };

  // 권한: 기안자 / 결재자 / 해당 매장 매니저·대표 / 본사 / super_admin·임원
  const approverIds = (steps ?? []).map((s) => s.approver_id);
  let allowed = request.drafter_id === user.id || approverIds.includes(user.id);
  if (!allowed) {
    const [{ data: prof }, { data: mems }] = await Promise.all([
      svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
      svc.from('memberships').select('role, workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
    ]);
    const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
    const isMgrHere = !!request.workplace_id
      && (mems ?? []).some((m) => m.workplace_id === request.workplace_id && (m.role === 'manager' || m.role === 'owner'));
    allowed = prof?.is_super_admin === true || prof?.is_executive === true || isHQ || isMgrHere;
  }
  if (!allowed) return { forbidden: true };

  return {
    request,
    items: items ?? [],
    steps: steps ?? [],
    attachments: attachments ?? [],
    shifts: shifts ?? [],
  };
}

/**
 * 결재 단계 승인/반려 — 서비스 롤 + 권한검증 (본인 차례의 대기 단계만)
 * 클라이언트 RLS write 실패 방지.
 */
export async function decideApprovalStep({ stepId, decision, comment }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: '로그인이 필요합니다.' };
  if (!stepId || !['approved', 'rejected'].includes(decision)) return { error: '잘못된 요청입니다.' };

  const svc = getServiceClient();
  const { data: step } = await svc
    .from('approval_steps')
    .select('id, request_id, approver_id, status, step_order')
    .eq('id', stepId)
    .maybeSingle();
  if (!step) return { error: '결재 단계를 찾을 수 없습니다.' };
  if (step.approver_id !== user.id) return { error: '본인 결재 차례가 아닙니다.' };
  if (step.status !== 'waiting') return { error: '이미 처리된 단계입니다.' };

  const { data: reqRow } = await svc
    .from('approval_requests')
    .select('id, status, current_step')
    .eq('id', step.request_id)
    .maybeSingle();
  if (!reqRow || reqRow.status !== 'pending') return { error: '이미 종료된 결재입니다.' };
  if (reqRow.current_step != null && step.step_order !== reqRow.current_step) {
    return { error: '아직 이 단계의 차례가 아닙니다.' };
  }

  const { error } = await svc
    .from('approval_steps')
    .update({ status: decision, comment: (comment || '').trim() || null })
    .eq('id', stepId);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * 기안 취소 — 서비스 롤 + 권한검증 (기안자 본인 · 진행중 only)
 */
export async function cancelApprovalRequest({ requestId }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { error: '로그인이 필요합니다.' };
  if (!requestId) return { error: '결재 ID가 누락되었습니다.' };

  const svc = getServiceClient();
  const { data: reqRow } = await svc
    .from('approval_requests')
    .select('id, drafter_id, status')
    .eq('id', requestId)
    .maybeSingle();
  if (!reqRow) return { error: '결재를 찾을 수 없습니다.' };
  if (reqRow.drafter_id !== user.id) return { error: '기안자만 취소할 수 있습니다.' };
  if (reqRow.status !== 'pending') return { error: '진행 중인 결재만 취소할 수 있습니다.' };

  const { error } = await svc
    .from('approval_requests')
    .update({ status: 'cancelled', decided_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * 결재자 후보 조회 — 현재 매장 매니저/대표 + 본사 active 멤버 전원
 * 서비스 롤로 조회해 RLS(본사 직원 프로필 가림) 우회.
 */
export async function getApproverCandidates(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다.');
  if (!workplaceId) return [];

  const svc = getServiceClient();

  const [{ data: storeMems }, { data: hqMems }] = await Promise.all([
    svc
      .from('memberships')
      .select('user_id, role')
      .eq('workplace_id', workplaceId)
      .eq('active', true)
      .in('role', ['manager', 'owner'])
      .neq('user_id', user.id),
    svc
      .from('memberships')
      .select('user_id, role, workplaces!inner(name)')
      .eq('workplaces.name', '본사')
      .eq('active', true)
      .neq('user_id', user.id),
  ]);

  // 중복 제거 (본사 우선)
  const merged = new Map();
  (storeMems ?? []).forEach((m) =>
    merged.set(m.user_id, { user_id: m.user_id, role: m.role, source: 'store' })
  );
  (hqMems ?? []).forEach((m) =>
    merged.set(m.user_id, { user_id: m.user_id, role: m.role, source: 'hq' })
  );

  const uids = [...merged.keys()];
  let profMap = new Map();
  if (uids.length > 0) {
    const { data: profs } = await svc
      .from('profiles')
      .select('user_id, name, is_executive, retired_at')
      .in('user_id', uids);
    profMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
  }

  const list = [...merged.values()]
    .map((m) => {
      const p = profMap.get(m.user_id);
      return {
        user_id: m.user_id,
        name: p?.name || '—',
        role: m.role,
        isExecutive: p?.is_executive === true,
        source: m.source,
        retired: !!p?.retired_at,
      };
    })
    .filter((c) => !c.retired); // 퇴사자 제외

  list.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'hq' ? -1 : 1;
    const rank = { owner: 0, manager: 1, staff: 2 };
    return (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
  });

  return list;
}
