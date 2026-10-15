-- ========================================================================
-- 토스 POS 일 매출 자동 채움 — 리뷰 반영
-- 1) pos_fill_sales_daily 실행 권한: PUBLIC 기본 부여 때문에 anon/authenticated 회수가 무효였음 → public 까지 회수
-- 2) search_path 고정 (security definer 함수 권장)
-- 3) 값이 같은 날은 갱신하지 않음 (realtime 이벤트·updated_at 불필요 갱신 방지)
-- 4) 완료 주문이 0건이 된 날(전부 취소 등)의 pos_toss 행 삭제 (옛 값 잔존 방지)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create or replace function pos_fill_sales_daily(p_workplace_id uuid, p_from date, p_to date)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  n integer;
  n_del integer;
begin
  create temp table _pos_src on commit drop as
    select s.* from pos_daily_summary(p_workplace_id, p_from, p_to) s
    where not exists (
      select 1 from month_closings mc
      where mc.workplace_id = p_workplace_id
        and mc.year = extract(year from s.sales_date)
        and mc.month = extract(month from s.sales_date)
        and (mc.locked = true or mc.locked_at is not null)
    );

  with up as (
    insert into sales_daily (workplace_id, sales_date, total_amount, transaction_count,
                             cash_amount, card_amount, other_amount, source, recorded_at, updated_at)
    select p_workplace_id, sales_date, total_amount, transaction_count,
           cash_amount, card_amount, other_amount, 'pos_toss', now(), now()
    from _pos_src
    on conflict (workplace_id, sales_date) do update
      set total_amount      = excluded.total_amount,
          transaction_count = excluded.transaction_count,
          cash_amount       = excluded.cash_amount,
          card_amount       = excluded.card_amount,
          other_amount      = excluded.other_amount,
          updated_at        = now()
      where sales_daily.source = 'pos_toss'
        and (sales_daily.total_amount, sales_daily.transaction_count, sales_daily.cash_amount,
             sales_daily.card_amount, sales_daily.other_amount)
            is distinct from
            (excluded.total_amount, excluded.transaction_count, excluded.cash_amount,
             excluded.card_amount, excluded.other_amount)
    returning 1
  )
  select count(*) into n from up;

  -- 범위 안에서 자동 행만 있고 완료 주문이 더 이상 없는 날 → 행 삭제 (마감 월 제외)
  with del as (
    delete from sales_daily sd
    where sd.workplace_id = p_workplace_id
      and sd.sales_date between p_from and p_to
      and sd.source = 'pos_toss'
      and not exists (select 1 from _pos_src s where s.sales_date = sd.sales_date)
      and not exists (
        select 1 from month_closings mc
        where mc.workplace_id = p_workplace_id
          and mc.year = extract(year from sd.sales_date)
          and mc.month = extract(month from sd.sales_date)
          and (mc.locked = true or mc.locked_at is not null)
      )
    returning 1
  )
  select count(*) into n_del from del;

  return n + n_del;
end;
$$;

revoke execute on function pos_fill_sales_daily(uuid, date, date) from public, anon, authenticated;
alter function pos_daily_summary(uuid, date, date) set search_path = public;
alter function pos_product_sales(uuid, date, date) set search_path = public;
