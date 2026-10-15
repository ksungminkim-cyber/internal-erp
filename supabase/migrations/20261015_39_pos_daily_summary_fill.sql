-- ========================================================================
-- 토스 POS 주문 → 일 매출 자동 채움 (1b)
-- 1) pos_daily_summary: 완료 주문을 KST 날짜별 총액·건수·카드·현금·기타로 합산
-- 2) pos_fill_sales_daily: 위 합산을 sales_daily 에 upsert (수기 입력·마감 월은 건드리지 않음)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

-- 1. 날짜별 합산. 결제 수단: CARD→카드, CASH→현금, 그 외(BARCODE 간편결제 등)→기타
create or replace function pos_daily_summary(p_workplace_id uuid, p_from date, p_to date)
returns table (
  sales_date date,
  total_amount numeric,
  transaction_count integer,
  card_amount numeric,
  cash_amount numeric,
  other_amount numeric
)
language sql stable security invoker as $$
  with o as (
    select id,
           charge_total,
           (completed_at at time zone 'Asia/Seoul')::date as d,
           raw -> 'payments' as payments
    from pos_orders
    where workplace_id = p_workplace_id
      and order_state = 'COMPLETED'
      and completed_at is not null
      and (completed_at at time zone 'Asia/Seoul')::date between p_from and p_to
  ),
  p as (
    select o.id, o.d,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and pay->>'sourceType' = 'CARD' then (pay->>'amount')::numeric else 0 end), 0) as card,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and pay->>'sourceType' = 'CASH' then (pay->>'amount')::numeric else 0 end), 0) as cash,
           coalesce(sum(case when pay->>'state' = 'APPROVED' and coalesce(pay->>'sourceType', '') not in ('CARD', 'CASH') then (pay->>'amount')::numeric else 0 end), 0) as other
    from o
    left join lateral jsonb_array_elements(coalesce(o.payments, '[]'::jsonb)) as pay on true
    group by o.id, o.d
  )
  select o.d                                  as sales_date,
         coalesce(sum(o.charge_total), 0)     as total_amount,
         count(*)::integer                    as transaction_count,
         coalesce(sum(p.card), 0)             as card_amount,
         coalesce(sum(p.cash), 0)             as cash_amount,
         coalesce(sum(p.other), 0)            as other_amount
  from o
  join p on p.id = o.id
  group by o.d
  order by o.d;
$$;

-- 2. sales_daily 채움. 반환: 영향받은 행 수.
--    - 기존 행이 없거나 source = 'pos_toss' 인 날만 씀 (수기 입력 보존)
--    - 마감(잠금)된 월은 건너뜀 (check_month_locked 트리거 회피)
--    - 그날 완료 주문이 0건이면 행을 만들지 않는다 (휴무일을 0원으로 기록하지 않음)
create or replace function pos_fill_sales_daily(p_workplace_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer as $$
declare
  n integer;
begin
  with src as (
    select * from pos_daily_summary(p_workplace_id, p_from, p_to) s
    where not exists (
      select 1 from month_closings mc
      where mc.workplace_id = p_workplace_id
        and mc.year = extract(year from s.sales_date)
        and mc.month = extract(month from s.sales_date)
        and (mc.locked = true or mc.locked_at is not null)
    )
  ),
  up as (
    insert into sales_daily (workplace_id, sales_date, total_amount, transaction_count,
                             cash_amount, card_amount, other_amount, source, recorded_at, updated_at)
    select p_workplace_id, sales_date, total_amount, transaction_count,
           cash_amount, card_amount, other_amount, 'pos_toss', now(), now()
    from src
    on conflict (workplace_id, sales_date) do update
      set total_amount      = excluded.total_amount,
          transaction_count = excluded.transaction_count,
          cash_amount       = excluded.cash_amount,
          card_amount       = excluded.card_amount,
          other_amount      = excluded.other_amount,
          updated_at        = now()
      where sales_daily.source = 'pos_toss'
    returning 1
  )
  select count(*) into n from up;
  return n;
end;
$$;

revoke execute on function pos_fill_sales_daily(uuid, date, date) from anon, authenticated;
