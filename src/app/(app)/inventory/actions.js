'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';

/**
 * 품목 변경 이력 — 입고/사용/폐기/조정 트랜잭션 (작성자·메모 포함).
 * 서비스롤, 해당 매장 멤버면 조회 가능.
 */
export async function getInventoryItemHistory({ itemId }) {
  const user = await getActor();
  if (!user || !itemId) return { history: [] };
  const svc = getServiceClient();
  const { data: item } = await svc.from('inventory_items').select('workplace_id').eq('id', itemId).maybeSingle();
  if (!item) return { history: [] };
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(item.workplace_id)) return { history: [] };

  const { data: txs } = await svc
    .from('inventory_transactions')
    .select('id, type, qty_delta, note, created_at, user_id')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(50);
  const ids = [...new Set((txs ?? []).map((t) => t.user_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profs } = await svc.from('profiles').select('user_id, name').in('user_id', ids);
    names = Object.fromEntries((profs ?? []).map((p) => [p.user_id, p.name]));
  }
  return { history: (txs ?? []).map((t) => ({ ...t, userName: names[t.user_id] ?? null })) };
}

export async function closeInventoryMonth({ workplaceId, year, month, itemCount, totalQtyEstimate, lowStockCount, snapshot, notes }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_closings').upsert({
    workplace_id: workplaceId,
    year,
    month,
    item_count: itemCount,
    total_qty_estimate: totalQtyEstimate,
    low_stock_count: lowStockCount,
    snapshot,
    notes: notes?.trim() || null,
    closed_by: user.id,
    closed_at: new Date().toISOString(),
  }, { onConflict: 'workplace_id,year,month' });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function deleteInventoryClosing({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: row, error: fetchErr } = await svc
    .from('inventory_closings')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row) return { ok: false, error: '마감 기록을 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_closings').delete().eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function saveInventoryItem({ id, workplaceId, payload }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const base = {
    name: payload.name,
    category: payload.category,
    unit: payload.unit,
    ...('current_qty' in payload ? { current_qty: payload.current_qty } : {}),
    min_qty: payload.min_qty,
    vendor: payload.vendor,
    notes: payload.notes,
    ...(payload.lead_time_days != null ? { lead_time_days: Math.max(0, Math.round(Number.isFinite(Number(payload.lead_time_days)) && payload.lead_time_days !== '' ? Number(payload.lead_time_days) : 2)) } : {}),
    ...('unit_cost' in payload ? { unit_cost: payload.unit_cost === '' || payload.unit_cost == null ? null : Math.max(0, Number(payload.unit_cost) || 0) } : {}),
    ...('order_unit' in payload ? { order_unit: payload.order_unit === '' || payload.order_unit == null || !(Number(payload.order_unit) > 0) ? null : Number(payload.order_unit) } : {}),
  };

  let error;
  if (id) {
    ({ error } = await svc
      .from('inventory_items')
      .update({ ...base, updated_at: new Date().toISOString() })
      .eq('id', id));
  } else {
    ({ error } = await svc
      .from('inventory_items')
      .insert({ ...base, workplace_id: workplaceId }));
  }
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function archiveInventoryItem({ id }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();

  const { data: row, error: fetchErr } = await svc
    .from('inventory_items')
    .select('workplace_id')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: friendlyDbError(fetchErr) };
  if (!row) return { ok: false, error: '품목을 찾을 수 없습니다.' };

  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(row.workplace_id)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_items').update({ archived: true }).eq('id', id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

export async function recordInventoryTransaction({ workplaceId, itemId, type, qtyDelta, note }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { error } = await svc.from('inventory_transactions').insert({
    item_id: itemId,
    workplace_id: workplaceId,
    user_id: user.id,
    type,
    qty_delta: qtyDelta,
    note: note?.trim() || null,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return { ok: true };
}

/**
 * 소요량 연결 편집용 데이터 — 최근 90일 토스 상품(판매량 순), 기존 연결, 레시피(추천용), 최근 30일 하루 평균 소진.
 */
export async function getProductUsage({ workplaceId, inventoryItemId }) {
  const user = await getActor();
  if (!user || !workplaceId || !inventoryItemId) return null;
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return null;

  const { data: item } = await svc.from('inventory_items').select('id, workplace_id').eq('id', inventoryItemId).maybeSingle();
  if (!item || item.workplace_id !== workplaceId) return null;

  const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  const today = kst(new Date());
  const d90 = kst(new Date(Date.now() - 90 * 86400_000));
  // 평균 분모 30일 = 어제까지 30일 (오늘은 진행 중이라 제외)
  const yesterday = kst(new Date(Date.now() - 86400_000));
  const d30 = kst(new Date(Date.now() - 30 * 86400_000));

  const [{ data: products, error: e1 }, { data: links }, { data: recipes }, { data: usage, error: e2 }] = await Promise.all([
    svc.rpc('pos_product_sales', { p_workplace_id: workplaceId, p_from: d90, p_to: today }),
    svc.from('pos_product_usage').select('item_title, qty_per_unit').eq('inventory_item_id', inventoryItemId),
    // 전사 공유(workplace_id null) + 이 매장 전용 레시피만 (다른 매장 전용 레시피는 내려보내지 않음)
    svc.from('recipes').select('name, ingredients, workplace_id').eq('active', true).or(`workplace_id.is.null,workplace_id.eq.${workplaceId}`),
    svc.rpc('inventory_daily_usage', { p_workplace_id: workplaceId, p_from: d30, p_to: yesterday, p_item_id: inventoryItemId }),
  ]);
  if (e1) throw new Error(`pos_product_sales: ${e1.message}`);
  if (e2) throw new Error(`inventory_daily_usage: ${e2.message}`);

  const mine = usage ?? [];
  const avgDailyUsage = mine.length ? mine.reduce((s, u) => s + Number(u.usage || 0), 0) / 30 : null;

  return {
    products: (products ?? []).map((p) => ({ item_title: p.item_title, qty90: Number(p.qty) || 0 })),
    links: (links ?? []).map((l) => ({ item_title: l.item_title, qty_per_unit: Number(l.qty_per_unit) })),
    // 매장 전용 레시피를 앞에 — 같은 이름이면 전용이 우선 매칭되도록
    recipes: [...(recipes ?? [])].sort((a, b) => (b.workplace_id ? 1 : 0) - (a.workplace_id ? 1 : 0)).map((r) => ({ name: r.name, ingredients: r.ingredients })),
    avgDailyUsage,
  };
}

/**
 * 품목의 소요량 연결을 통째로 교체. rows: [{ item_title, qty_per_unit }] (qty_per_unit > 0 만 저장).
 */
export async function saveProductUsage({ workplaceId, inventoryItemId, rows }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const { data: item } = await svc.from('inventory_items').select('id, workplace_id').eq('id', inventoryItemId).maybeSingle();
  if (!item || item.workplace_id !== workplaceId) return { ok: false, error: '품목을 찾을 수 없습니다.' };

  const clean = [];
  const seen = new Set();
  for (const r of rows ?? []) {
    const title = String(r.item_title ?? '');            // 토스 상품명 그대로 (조인은 정확 일치)
    const qty = Math.round(Number(r.qty_per_unit) * 1000) / 1000;
    if (!title.trim() || !Number.isFinite(qty) || !(qty > 0) || qty >= 1e9 || seen.has(title)) continue;
    seen.add(title);
    clean.push({ workplace_id: workplaceId, inventory_item_id: inventoryItemId, item_title: title, qty_per_unit: qty });
  }

  // upsert 후 목록에 없는 행만 삭제 — delete→insert 와 달리 중간에 실패해도 기존 연결이 사라지지 않음
  if (clean.length) {
    const { error: e1 } = await svc.from('pos_product_usage')
      .upsert(clean.map((r) => ({ ...r, updated_at: new Date().toISOString() })), { onConflict: 'inventory_item_id,item_title' });
    if (e1) return { ok: false, error: friendlyDbError(e1) };
  }
  // 새 목록에 없는 기존 행만 id 로 삭제 (상품명을 쿼리스트링에 넣지 않음)
  const { data: existing, error: e2 } = await svc.from('pos_product_usage').select('id, item_title').eq('inventory_item_id', inventoryItemId);
  if (e2) return { ok: false, error: friendlyDbError(e2) };
  const keep = new Set(clean.map((r) => r.item_title));
  const staleIds = (existing ?? []).filter((r) => !keep.has(r.item_title)).map((r) => r.id);
  if (staleIds.length) {
    const { error: e3 } = await svc.from('pos_product_usage').delete().in('id', staleIds);
    if (e3) return { ok: false, error: friendlyDbError(e3) };
  }
  return { ok: true, count: clean.length };
}

/**
 * 발주 추천 — inventory_order_suggestions. 권장 수량 > 0 인 품목만, 남은 일수 적은 순.
 * 홈·재고 페이지 공용. 멤버면 조회 가능.
 */
export async function getOrderSuggestions({ workplaceId }) {
  const user = await getActor();
  if (!user || !workplaceId) return null;
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return null;

  const { data, error } = await svc.rpc('inventory_order_suggestions', { p_workplace_id: workplaceId });
  if (error) throw new Error(`inventory_order_suggestions: ${error.message}`);
  const rows = (data ?? []).map((r) => ({
    ...r,
    current_qty: Number(r.current_qty) || 0,
    min_qty: Number(r.min_qty) || 0,
    suggested_qty: Number(r.suggested_qty) || 0,
    avg_daily_usage: r.avg_daily_usage == null ? null : Number(r.avg_daily_usage),
    days_left: r.days_left == null ? null : Number(r.days_left),
    forecast_usage: r.forecast_usage == null ? null : Number(r.forecast_usage),
    unit_cost: r.unit_cost == null ? null : Number(r.unit_cost),
    order_unit: r.order_unit == null ? null : Number(r.order_unit),
  }));
  return {
    suggestions: rows.filter((r) => r.suggested_qty > 0),
    daysLeftById: Object.fromEntries(rows.filter((r) => r.days_left != null).map((r) => [r.inventory_item_id, r.days_left])),
  };
}
