-- ========================================================================
-- 자동 차감 동시 실행 잠금 (리뷰 반영)
-- 10분 주기·일일 재조회·수동 백필이 겹쳐 같은 매장을 동시에 처리하면 갱신 경로에서 차액이 두 번
-- 빠질 수 있다. 매장 단위 advisory lock 으로 한 번에 하나만 실행되게 한다.
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create or replace function pos_apply_usage_deductions(p_workplace_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  v_start date;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  r record;
  v_delta numeric;
  v_tx uuid;
  n integer := 0;
begin
  -- 같은 매장의 차감은 트랜잭션 단위로 직렬화
  perform pg_advisory_xact_lock(hashtext('pos_deduct:' || p_workplace_id::text));

  select pos_deduct_from into v_start from workplaces where id = p_workplace_id;
  if v_start is null then return 0; end if;
  p_from := greatest(p_from, v_start);
  p_to := least(p_to, v_today);
  if p_from > p_to then return 0; end if;

  for r in
    with u as (
      select sales_date, inventory_item_id, usage from inventory_daily_usage(p_workplace_id, p_from, p_to)
    ),
    keys as (
      select sales_date, inventory_item_id from u
      union
      select sales_date, inventory_item_id from pos_usage_deductions
      where workplace_id = p_workplace_id and sales_date between p_from and p_to
    )
    select k.sales_date, k.inventory_item_id,
           coalesce(u.usage, 0) as usage,
           d.id as ledger_id, d.deducted_qty, d.transaction_id
    from keys k
    left join u on u.sales_date = k.sales_date and u.inventory_item_id = k.inventory_item_id
    left join pos_usage_deductions d on d.inventory_item_id = k.inventory_item_id and d.sales_date = k.sales_date
  loop
    v_delta := round(r.usage, 3) - coalesce(r.deducted_qty, 0);
    if abs(v_delta) < 0.0005 then continue; end if;

    if r.ledger_id is null then
      insert into inventory_transactions (item_id, workplace_id, user_id, type, qty_delta, note)
      values (r.inventory_item_id, p_workplace_id, null, 'use', -round(r.usage, 3),
              'POS 판매 자동 차감 ' || to_char(r.sales_date, 'MM/DD'))
      returning id into v_tx;   -- 트리거가 current_qty 차감
      insert into pos_usage_deductions (workplace_id, inventory_item_id, sales_date, deducted_qty, transaction_id)
      values (p_workplace_id, r.inventory_item_id, r.sales_date, round(r.usage, 3), v_tx);
    else
      update inventory_transactions set qty_delta = -round(r.usage, 3)
        where id = r.transaction_id;
      update inventory_items set current_qty = current_qty - v_delta, updated_at = now()
        where id = r.inventory_item_id;
      update pos_usage_deductions set deducted_qty = round(r.usage, 3), updated_at = now()
        where id = r.ledger_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function pos_apply_usage_deductions(uuid, date, date) from public, anon, authenticated;
