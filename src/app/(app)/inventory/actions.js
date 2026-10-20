'use server';

import { getServiceClient, getActor, loadActorPerms, friendlyDbError } from '@/lib/server/guard';
import { buildCountPlan } from '@/lib/stockCount';
import { matchInboundLines, leadDaysBetween, blendLeadTime } from '@/lib/inboundMatch';
import { kstDateKey } from '@/lib/date';

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
    // 소진 단위(ml/g)와 1(세는 단위)당 소진량 — 둘 다 있어야 유효, 아니면 둘 다 비움
    ...('usage_unit' in payload || 'usage_per_unit' in payload ? (() => {
      const uu = String(payload.usage_unit ?? '').trim();
      const per = Number(payload.usage_per_unit);
      return uu && per > 0 ? { usage_unit: uu, usage_per_unit: per } : { usage_unit: null, usage_per_unit: null };
    })() : {}),
    ...('supply_type' in payload ? { supply_type: payload.supply_type === 'made' ? 'made' : 'purchase' } : {}),
  };

  let error;
  if (id) {
    // 1단위당 소진량(usage_per_unit)이 바뀌면 기존 소요량 연결(세는 단위로 저장)을 다시 환산해
    // "잔당 180ml" 같은 소진 단위 의미를 유지한다. 예) 1박스=1000개 → 500개 로 바꾸면 저장값 ×2
    if ('usage_per_unit' in base && base.usage_per_unit != null) {
      const { data: prev } = await svc.from('inventory_items').select('usage_per_unit, usage_unit').eq('id', id).maybeSingle();
      const oldPer = Number(prev?.usage_per_unit);
      const newPer = Number(base.usage_per_unit);
      if (prev?.usage_unit && oldPer > 0 && newPer > 0 && oldPer !== newPer) {
        const { data: links } = await svc.from('pos_product_usage').select('id, qty_per_unit').eq('inventory_item_id', id);
        for (const l of links ?? []) {
          const q = Math.round((Number(l.qty_per_unit) * oldPer / newPer) * 1e6) / 1e6;
          if (q > 0) await svc.from('pos_product_usage').update({ qty_per_unit: q, updated_at: new Date().toISOString() }).eq('id', l.id);
        }
      }
    }
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

  const { data: item } = await svc.from('inventory_items').select('id, workplace_id, unit, usage_unit, usage_per_unit').eq('id', inventoryItemId).maybeSingle();
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
    // 소진 단위 정보 — 화면은 이 단위로 입력받고 저장 시 세는 단위로 환산
    usageUnit: item.usage_unit ?? null,
    usagePerUnit: item.usage_per_unit == null ? null : Number(item.usage_per_unit),
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
    const raw = Number(r.qty_per_unit);
    const qty = Math.round(raw * 1e6) / 1e6;
    if (!title.trim() || seen.has(title)) continue;
    if (!Number.isFinite(raw) || raw <= 0 || raw >= 1e9) continue;
    // 환산 후 저장 정밀도(소수 6자리) 아래로 떨어지면 조용히 버리지 않고 알린다
    if (!(qty > 0)) return { ok: false, error: `"${title}" 소요량이 너무 작아 저장할 수 없어요. 품목의 1단위당 수량을 줄이거나 값을 키워 주세요.` };
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
    usage_per_unit: r.usage_per_unit == null ? null : Number(r.usage_per_unit),
  }));
  return {
    suggestions: rows.filter((r) => r.suggested_qty > 0),
    daysLeftById: Object.fromEntries(rows.filter((r) => r.days_left != null).map((r) => [r.inventory_item_id, r.days_left])),
  };
}

/**
 * 재고 실사 일괄 저장 — 입력한 품목만 adjust 거래(차이 0 이면 실사 시각만), 바꾼 단위는 품목에 저장.
 * 차이는 저장 시점의 최신 current_qty 로 다시 계산한다 (세는 동안 POS 자동 차감이 돌아도 센 수량이 기준).
 */
export async function applyStockCount({ workplaceId, lines }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };

  const ids = (lines ?? []).map((l) => l.itemId).filter(Boolean);
  if (!ids.length) return { ok: false, error: '센 수량을 입력해 주세요.' };
  const { data: items } = await svc.from('inventory_items').select('id, current_qty, unit').eq('workplace_id', workplaceId).in('id', ids);
  const plan = buildCountPlan(lines, items ?? [], { dateKey: kstDateKey() });
  if (!plan.countedIds.length) return { ok: false, error: '저장할 품목이 없습니다.' };

  if (plan.transactions.length) {
    const { error } = await svc.from('inventory_transactions').insert(
      plan.transactions.map((t) => ({ ...t, workplace_id: workplaceId, user_id: user.id }))
    );
    if (error) return { ok: false, error: friendlyDbError(error) };
  }
  const now = new Date().toISOString();
  await svc.from('inventory_items').update({ last_counted_at: now, updated_at: now }).in('id', plan.countedIds);
  for (const u of plan.unitChanges) await svc.from('inventory_items').update({ unit: u.unit, updated_at: now }).eq('id', u.id);
  return { ok: true, counted: plan.countedIds.length, adjusted: plan.transactions.length };
}

/** 입고 대기 — 승인된 지출결의서(received_at 없음) + 라인별 재고 품목 매칭 */
export async function getPendingInbound({ workplaceId }) {
  const user = await getActor();
  if (!user || !workplaceId) return null;
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return null;

  const [{ data: docs }, { data: items }] = await Promise.all([
    svc.from('approval_requests')
      .select('id, title, decided_at, expense_items(id, description, amount, inventory_item_id, qty, created_at)')
      .eq('workplace_id', workplaceId).eq('doc_type', 'expense').eq('status', 'approved').is('received_at', null)
      .order('decided_at', { ascending: false }).limit(20),
    svc.from('inventory_items').select('id, name, unit').eq('workplace_id', workplaceId).eq('archived', false).order('name'),
  ]);
  return {
    items: items ?? [],
    docs: (docs ?? []).map((d) => ({
      id: d.id, title: d.title, decided_at: d.decided_at,
      lines: matchInboundLines([...(d.expense_items ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))), items ?? []),
    })),
  };
}

async function loadInboundDoc(svc, workplaceId, requestId) {
  const { data: doc } = await svc.from('approval_requests').select('id, title, decided_at, status, doc_type, received_at').eq('id', requestId).eq('workplace_id', workplaceId).maybeSingle();
  if (!doc) return { error: '기안을 찾을 수 없어요.' };
  if (doc.doc_type !== 'expense' || doc.status !== 'approved') return { error: '승인된 지출결의서만 입고 처리할 수 있어요.' };
  if (doc.received_at) return { error: '이미 입고 처리된 기안이에요.' };
  return { doc };
}

/**
 * 입고 확인 — 라인별 restock 거래, 매핑 저장, 단가(amount/qty)·리드타임(승인→입고 일수 평균) 보정, 기안 received_at.
 * 라인마다 거래를 하나씩 남긴다(같은 품목이 두 줄이면 두 번).
 */
export async function confirmInbound({ workplaceId, requestId, lines }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };
  const chk = await loadInboundDoc(svc, workplaceId, requestId);
  if (chk.error) return { ok: false, error: chk.error };
  const doc = chk.doc;

  const valid = (lines ?? []).filter((l) => l.itemId && Number(l.qty) > 0);
  if (!valid.length) return { ok: false, error: '입고할 품목과 수량을 확인해 주세요.' };
  const { data: items } = await svc.from('inventory_items').select('id, lead_time_days').eq('workplace_id', workplaceId).in('id', valid.map((l) => l.itemId));
  const known = new Map((items ?? []).map((i) => [i.id, i]));
  const rows = valid.filter((l) => known.has(l.itemId));
  if (!rows.length) return { ok: false, error: '이 매장의 재고 품목이 아니에요.' };

  const { error } = await svc.from('inventory_transactions').insert(
    rows.map((l) => ({ item_id: l.itemId, workplace_id: workplaceId, user_id: user.id, type: 'restock', qty_delta: Number(l.qty), note: `입고 · ${doc.title}` }))
  );
  if (error) return { ok: false, error: friendlyDbError(error) };

  const now = new Date();
  // 승인 → 입고 일수 (0~30일만 반영) 로 리드타임을 절반씩 당겨 맞춘다
  const observed = leadDaysBetween(doc.decided_at, now);
  for (const l of rows) {
    const patch = { updated_at: now.toISOString() };
    const amount = Number(l.amount), qty = Number(l.qty);
    if (amount > 0 && qty > 0) patch.unit_cost = Math.round((amount / qty) * 100) / 100;
    if (observed != null) patch.lead_time_days = blendLeadTime(known.get(l.itemId)?.lead_time_days ?? 2, observed);
    await svc.from('inventory_items').update(patch).eq('id', l.itemId);
    if (l.expenseItemId) await svc.from('expense_items').update({ inventory_item_id: l.itemId, qty }).eq('id', l.expenseItemId).eq('request_id', requestId);
  }
  await svc.from('approval_requests').update({ received_at: now.toISOString(), received_by: user.id, updated_at: now.toISOString() }).eq('id', requestId);
  return { ok: true, restocked: rows.length };
}

/** 재고 입고가 아닌 기안 — 입고 대기에서 치우기만 (거래 없음) */
export async function dismissInbound({ workplaceId, requestId }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return { ok: false, error: '권한이 없습니다.' };
  const chk = await loadInboundDoc(svc, workplaceId, requestId);
  if (chk.error) return { ok: false, error: chk.error };
  const now = new Date().toISOString();
  const { error } = await svc.from('approval_requests').update({ received_at: now, received_by: user.id, updated_at: now }).eq('id', requestId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 장기 미사용 — p_days 동안 재고 거래가 없는 품목 { [itemId]: lastTxAt|null } */
export async function getIdleItems({ workplaceId, days = 30 }) {
  const user = await getActor();
  if (!user || !workplaceId) return {};
  const svc = getServiceClient();
  const perms = await loadActorPerms(svc, user.id);
  if (!perms.isMemberOf(workplaceId)) return {};
  const { data, error } = await svc.rpc('inventory_idle_items', { p_workplace_id: workplaceId, p_days: days });
  if (error) throw new Error(`inventory_idle_items: ${error.message}`);
  return Object.fromEntries((data ?? []).map((r) => [r.inventory_item_id, r.last_tx_at]));
}
