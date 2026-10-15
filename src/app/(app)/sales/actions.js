'use server';

import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { loadActorPerms } from '@/lib/server/guard';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// 한국시간 기준 'YYYY-MM-DD'
function kstDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

/**
 * 매출 합계 집계 — 누적(전체) + 이번 달. 서비스롤(RLS 무관), 멤버면 조회 가능.
 */
export async function getSalesSummary(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return null;

  const svc = getServiceClient();
  // 멤버십 검증 (본인 매장 매출만)
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const allowed = (mems ?? []).some((m) => m.workplace_id === workplaceId) || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;

  // 합계는 SQL 에서 (행을 전부 가져오면 PostgREST 1000행 제한에 걸려 누적이 조용히 적게 나옴)
  const { data, error } = await svc.rpc('sales_summary', { p_workplace_id: workplaceId });
  if (error) throw new Error(`sales_summary: ${error.message}`);
  const r = data?.[0];
  const monthPrefix = kstDate().slice(0, 7); // 'YYYY-MM'
  return {
    allTotal: Number(r?.all_total) || 0,
    allCount: Number(r?.all_count) || 0,
    monthTotal: Number(r?.month_total) || 0,
    monthCount: Number(r?.month_count) || 0,
    monthLabel: r?.month_label ?? monthPrefix,
  };
}

/**
 * 일 매출 저장 — 서비스롤 + 멤버십 검증.
 * 기존 RLS가 매니저(is_manager_of)만 허용해 마감 담당 직원이 입력 못 하던 문제 해결.
 * 해당 매장의 active 멤버면 누구나 입력 가능 (마감 담당이 직원인 경우 대응).
 */
export async function saveSales({ workplaceId, salesDate, totalAmount, transactionCount, cashAmount, cardAmount, otherAmount, notes }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!workplaceId || !salesDate) return { ok: false, error: '사업장·날짜가 필요합니다.' };

  const svc = getServiceClient();

  // 권한: 해당 매장 active 멤버 또는 본사/super_admin·임원
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const isMemberHere = (mems ?? []).some((m) => m.workplace_id === workplaceId);
  if (!(isMemberHere || isHQ || prof?.is_super_admin === true || prof?.is_executive === true)) {
    return { ok: false, error: '이 매장의 매출을 입력할 권한이 없습니다.' };
  }

  const { error } = await svc.from('sales_daily').upsert({
    workplace_id: workplaceId,
    sales_date: salesDate,
    total_amount: Number(totalAmount) || 0,
    transaction_count: Number(transactionCount) || 0,
    cash_amount: Number(cashAmount) || 0,
    card_amount: Number(cardAmount) || 0,
    other_amount: Number(otherAmount) || 0,
    source: 'manual',
    notes: notes?.trim() || null,
    recorded_by: user.id,
    recorded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workplace_id,sales_date' });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('마감 잠금') || msg.includes('locked')) {
      return { ok: false, error: '마감된 월의 매출은 수정할 수 없습니다.' };
    }
    return { ok: false, error: msg || '매출 저장 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

// sales_tips 테이블 미적용(마이그레이션 전) 여부 판정
function isTableMissing(error) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  return String(error.message || '').includes('does not exist');
}

const TIPS_MIGRATION_MSG = '팁 기능을 쓰려면 DB 마이그레이션(sales_tips)을 먼저 적용해주세요.';

/**
 * 매장별 매출 팁 조회 — 멤버면 조회 가능. 테이블 미적용 시 graceful.
 */
export async function getSalesTips(workplaceId) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return { tips: [], enabled: false };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { tips: [], enabled: false };

  const { data, error } = await svc
    .from('sales_tips')
    .select('*')
    .eq('workplace_id', workplaceId)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isTableMissing(error)) return { tips: [], enabled: false };
    return { tips: [], enabled: false };
  }
  return { tips: data ?? [], enabled: true };
}

/**
 * 매출 팁 저장(추가/수정) — 해당 매장 매니저만. id 있으면 update, 없으면 insert.
 */
export async function saveSalesTip({ id, workplaceId, content, sortOrder }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };

  const text = String(content ?? '').trim();
  if (!text) return { ok: false, error: '내용을 입력해주세요.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  if (id) {
    // 기존 팁 — 해당 팁의 매장으로 권한 검증
    const { data: existing, error: fetchErr } = await svc
      .from('sales_tips')
      .select('workplace_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) {
      if (isTableMissing(fetchErr)) return { ok: false, error: TIPS_MIGRATION_MSG };
      return { ok: false, error: fetchErr.message || '팁 저장 중 오류가 발생했습니다.' };
    }
    if (!existing) return { ok: false, error: '팁을 찾을 수 없습니다.' };
    if (!perms.isManagerOf(existing.workplace_id)) {
      return { ok: false, error: '이 매장의 팁을 수정할 권한이 없습니다.' };
    }
    const { error } = await svc
      .from('sales_tips')
      .update({ content: text, sort_order: Number(sortOrder) || 0, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
      return { ok: false, error: error.message || '팁 저장 중 오류가 발생했습니다.' };
    }
    return { ok: true };
  }

  // 신규 팁
  if (!workplaceId) return { ok: false, error: '사업장이 필요합니다.' };
  if (!perms.isManagerOf(workplaceId)) {
    return { ok: false, error: '이 매장의 팁을 추가할 권한이 없습니다.' };
  }
  const { error } = await svc.from('sales_tips').insert({
    workplace_id: workplaceId,
    content: text,
    sort_order: Number(sortOrder) || 0,
    created_by: user.id,
  });
  if (error) {
    if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: error.message || '팁 저장 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

/**
 * 매출 팁 삭제(하드 삭제) — 해당 매장 매니저만.
 */
export async function deleteSalesTip({ id }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (!id) return { ok: false, error: '삭제할 팁이 없습니다.' };

  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);

  const { data: existing, error: fetchErr } = await svc
    .from('sales_tips')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) {
    if (isTableMissing(fetchErr)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: fetchErr.message || '팁 삭제 중 오류가 발생했습니다.' };
  }
  if (!existing) return { ok: true }; // 이미 없음
  if (!perms.isManagerOf(existing.workplace_id)) {
    return { ok: false, error: '이 매장의 팁을 삭제할 권한이 없습니다.' };
  }

  const { error } = await svc.from('sales_tips').delete().eq('id', id);
  if (error) {
    if (isTableMissing(error)) return { ok: false, error: TIPS_MIGRATION_MSG };
    return { ok: false, error: error.message || '팁 삭제 중 오류가 발생했습니다.' };
  }
  return { ok: true };
}

/**
 * 상품별 판매 집계 (토스 POS 동기화 데이터). from/to 는 'YYYY-MM-DD' 양 끝 포함.
 * 권한은 getSalesSummary 와 동일 — 해당 매장 멤버 / 본사 / super_admin / 임원.
 */
export async function getProductSales({ workplaceId, from, to }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId || !from || !to) return null;

  const svc = getServiceClient();
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const allowed = (mems ?? []).some((m) => m.workplace_id === workplaceId) || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;

  // 합산은 SQL 함수에서 (뷰를 직접 읽으면 PostgREST 1000행 제한에 걸려 긴 기간이 조용히 적게 집계됨)
  const [{ data: rows, error: rpcError }, { data: days, error: dayError }, { data: lastLog }] = await Promise.all([
    svc.rpc('pos_product_sales', { p_workplace_id: workplaceId, p_from: from, p_to: to }),
    svc.rpc('pos_daily_summary', { p_workplace_id: workplaceId, p_from: from, p_to: to }),
    svc.from('pos_sync_log')
      .select('finished_at')
      .eq('workplace_id', workplaceId)
      .is('error', null)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (rpcError) throw new Error(`pos_product_sales: ${rpcError.message}`);
  if (dayError) throw new Error(`pos_daily_summary: ${dayError.message}`);
  // 기간 합계 — 주문 최종금액 기준 (상품 금액 합은 옵션·할인을 빼므로 따로 둔다)
  const summary = (days ?? []).reduce((a, d) => ({
    total: a.total + (Number(d.total_amount) || 0),
    count: a.count + (Number(d.transaction_count) || 0),
    days: a.days + 1,
  }), { total: 0, count: 0, days: 0 });
  const items = (rows ?? []).map((r) => ({
    item_title: r.item_title,
    item_code: r.item_code ?? null,
    qty: Number(r.qty) || 0,
    amount: Number(r.amount) || 0,
  }));
  return { items, summary, lastSyncedAt: lastLog?.finished_at ?? null };
}

/**
 * 날짜 하나의 세부 — 합계(sales_daily 행, 없으면 POS 합산)와 상품별 판매. 권한은 getProductSales 와 동일.
 * @returns {{ summary: { total, count, card, cash, other, source } | null, items: [] } | null}
 */
export async function getDaySalesDetail({ workplaceId, date }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;

  const svc = getServiceClient();
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const allowed = (mems ?? []).some((m) => m.workplace_id === workplaceId) || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;

  const [{ data: row }, { data: pos, error: posError }, { data: products, error: rpcError }] = await Promise.all([
    svc.from('sales_daily')
      .select('total_amount, transaction_count, card_amount, cash_amount, other_amount, source')
      .eq('workplace_id', workplaceId).eq('sales_date', date).maybeSingle(),
    svc.rpc('pos_daily_summary', { p_workplace_id: workplaceId, p_from: date, p_to: date }),
    svc.rpc('pos_product_sales', { p_workplace_id: workplaceId, p_from: date, p_to: date }),
  ]);
  if (rpcError) throw new Error(`pos_product_sales: ${rpcError.message}`);
  if (posError) throw new Error(`pos_daily_summary: ${posError.message}`);

  let summary = null;
  if (row) {
    summary = {
      total: Number(row.total_amount) || 0, count: Number(row.transaction_count) || 0,
      card: Number(row.card_amount) || 0, cash: Number(row.cash_amount) || 0, other: Number(row.other_amount) || 0,
      source: row.source,
    };
  } else if (pos?.[0]) {
    const p = pos[0];
    summary = {
      total: Number(p.total_amount) || 0, count: Number(p.transaction_count) || 0,
      card: Number(p.card_amount) || 0, cash: Number(p.cash_amount) || 0, other: Number(p.other_amount) || 0,
      source: 'pos_toss',
    };
  }
  const items = (products ?? []).map((r) => ({
    item_title: r.item_title, item_code: r.item_code ?? null, qty: Number(r.qty) || 0, amount: Number(r.amount) || 0,
  }));
  return { summary, items };
}

/**
 * 월 매출 목표 KPI — 목표, 이달 매출(sales_daily), 이달 상품별 판매(카페/바 상위 3).
 * 권한은 getSalesSummary 와 동일.
 */
export async function getSalesKpi({ workplaceId }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return null;

  const svc = getServiceClient();
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, role, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const mine = (mems ?? []).find((m) => m.workplace_id === workplaceId);
  const allowed = !!mine || isHQ || prof?.is_super_admin === true || prof?.is_executive === true;
  if (!allowed) return null;
  const canEditTarget = isHQ || prof?.is_super_admin === true || prof?.is_executive === true || ['manager', 'owner'].includes(mine?.role);

  const today = kstDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [{ data: wp }, { data: sum, error: e1 }, { data: products, error: e2 }] = await Promise.all([
    svc.from('workplaces').select('monthly_sales_target').eq('id', workplaceId).maybeSingle(),
    svc.rpc('sales_summary', { p_workplace_id: workplaceId }),
    svc.rpc('pos_product_sales', { p_workplace_id: workplaceId, p_from: monthStart, p_to: today }),
  ]);
  if (e1) throw new Error(`sales_summary: ${e1.message}`);
  if (e2) throw new Error(`pos_product_sales: ${e2.message}`);

  // 상위 후보 상품의 카테고리 (pos_order_items 에서 가장 최근 값)
  const sorted = (products ?? []).map((p) => ({ item_title: p.item_title, qty: Number(p.qty) || 0, amount: Number(p.amount) || 0 }))
    .sort((a, b) => b.amount - a.amount);
  const candidates = sorted.slice(0, 40).map((p) => p.item_title);
  const { data: cats } = candidates.length
    ? await svc.from('pos_order_items').select('item_title, item_category').eq('workplace_id', workplaceId).in('item_title', candidates).limit(2000)
    : { data: [] };
  const categoryByTitle = {};
  for (const r of cats ?? []) if (categoryByTitle[r.item_title] == null) categoryByTitle[r.item_title] = r.item_category ?? '';

  return {
    target: Number(wp?.monthly_sales_target) || 0,
    monthTotal: Number(sum?.[0]?.month_total) || 0,
    todayKey: today,
    products: sorted.slice(0, 40).map((p) => ({ ...p, category: categoryByTitle[p.item_title] ?? '' })),
    canEditTarget,
  };
}

/** 월 매출 목표 저장 — 매니저 이상 */
export async function updateSalesTarget({ workplaceId, target }) {
  const authClient = await createServerClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user || !workplaceId) return { ok: false, error: '로그인이 필요합니다.' };
  const t = Math.round(Number(target));
  if (!Number.isFinite(t) || t < 0 || t > 1e12) return { ok: false, error: '목표 금액을 확인해 주세요.' };

  const svc = getServiceClient();
  const [{ data: prof }, { data: mems }] = await Promise.all([
    svc.from('profiles').select('is_super_admin, is_executive').eq('user_id', user.id).maybeSingle(),
    svc.from('memberships').select('workplace_id, role, workplaces(name)').eq('user_id', user.id).eq('active', true),
  ]);
  const isHQ = (mems ?? []).some((m) => m.workplaces?.name === '본사');
  const mine = (mems ?? []).find((m) => m.workplace_id === workplaceId);
  const can = isHQ || prof?.is_super_admin === true || prof?.is_executive === true || ['manager', 'owner'].includes(mine?.role);
  if (!can) return { ok: false, error: '매니저 이상만 목표를 바꿀 수 있어요.' };

  const { error } = await svc.from('workplaces').update({ monthly_sales_target: t }).eq('id', workplaceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, target: t };
}
