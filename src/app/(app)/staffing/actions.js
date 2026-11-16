'use server';

import { getServiceClient, getActor, loadActorPerms } from '@/lib/server/guard';
import { demandByDateHour, DEFAULT_RULES } from '@/lib/staffing';

const DAY = 86400e3, KST = 9 * 3600e3;

// PostgREST 1000행 제한 — 첫 쪽에서 전체 건수를 받고 나머지 쪽은 동시에
async function fetchAll(build) {
  const first = await build().range(0, 999);
  if (first.error) throw new Error(first.error.message);
  const total = first.count ?? first.data.length;
  if (total <= 1000) return first.data;
  const rest = await Promise.all(Array.from({ length: Math.ceil(total / 1000) - 1 }, (_, i) => build().range((i + 1) * 1000, (i + 1) * 1000 + 999)));
  for (const r of rest) if (r.error) throw new Error(r.error.message);
  return [first.data, ...rest.map((r) => r.data)].flat();
}

/**
 * 인력 배치 진단용 원자료 — 본사(임원·super_admin 포함) 전용.
 * 분석 기간: 지난 일요일까지 온전한 N주(KST). 시급이 포함되므로 본사 외에는 내려주지 않는다.
 * 반환: { dates, demand: [[dateKey, hour, sales, orders, items]], shifts, wages, premiumExempt, rules, periodFrom, periodTo }
 *  - demand 는 서버에서 KST 로 집계 (바 테이블은 열린 시각~결제 시각에 분산)
 *  - shifts 는 분석 기간 시작 ~ 다음 달 말 (예상 인건비 계산용). 주휴·야간 계산은 화면(KST 브라우저)에서 한다.
 */
export async function getStaffingData({ workplaceId, weeks = 8 }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isSuper) return { ok: false, error: '본사만 볼 수 있습니다.', forbidden: true };
  if (!workplaceId) return { ok: false, error: '매장을 선택해 주세요.' };
  const nWeeks = Math.min(12, Math.max(4, Math.round(Number(weeks) || 8)));

  // 지난 일요일(KST)까지 온전한 N주
  const nowK = new Date(Date.now() + KST);
  const dow = nowK.getUTCDay();
  const lastSun = Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth(), nowK.getUTCDate() - (dow === 0 ? 7 : dow));
  const dates = Array.from({ length: nWeeks * 7 }, (_, i) => new Date(lastSun - (nWeeks * 7 - 1 - i) * DAY).toISOString().slice(0, 10));
  const periodFrom = new Date(new Date(`${dates[0]}T00:00:00Z`).getTime() - KST).toISOString();
  const periodTo = new Date(lastSun + DAY - KST).toISOString();
  const nextMonthEnd = new Date(Date.UTC(nowK.getUTCFullYear(), nowK.getUTCMonth() + 2, 1) - KST).toISOString();

  const [orders, shifts, { data: wp }] = await Promise.all([
    fetchAll(() => svc.from('pos_orders')
      .select('created_at_pos, completed_at, charge_total, pos_order_items(quantity)', { count: 'exact' })
      .eq('workplace_id', workplaceId).eq('order_state', 'COMPLETED')
      .gte('completed_at', periodFrom).lt('completed_at', periodTo).order('completed_at')),
    fetchAll(() => svc.from('shifts')
      .select('user_id, start_at, end_at, status', { count: 'exact' })
      .eq('workplace_id', workplaceId).gte('start_at', periodFrom).lt('start_at', nextMonthEnd).order('start_at')),
    svc.from('workplaces').select('name, labor_premium_exempt').eq('id', workplaceId).maybeSingle(),
  ]);

  const userIds = [...new Set(shifts.map((s) => s.user_id).filter(Boolean))];
  const { data: profs } = userIds.length
    ? await svc.from('profiles').select('user_id, hourly_wage').in('user_id', userIds)
    : { data: [] };

  const demand = demandByDateHour(orders.map((o) => ({
    created_at_pos: o.created_at_pos, completed_at: o.completed_at, charge_total: o.charge_total,
    items: (o.pos_order_items ?? []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
  })), DEFAULT_RULES);

  return {
    ok: true,
    workplaceName: wp?.name ?? '',
    premiumExempt: wp?.labor_premium_exempt === true,
    rules: DEFAULT_RULES,
    dates, periodFrom, periodTo,
    orderCount: orders.length,
    demand: [...demand.entries()].map(([k, v]) => { const [d, h] = k.split('|'); return [d, Number(h), Math.round(v.sales), Math.round(v.orders * 100) / 100, Math.round(v.items * 100) / 100]; }),
    shifts,
    wages: Object.fromEntries((profs ?? []).map((p) => [p.user_id, Number(p.hourly_wage) || 0])),
  };
}
