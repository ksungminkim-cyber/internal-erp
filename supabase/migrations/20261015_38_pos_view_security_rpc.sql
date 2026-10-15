-- ========================================================================
-- 토스 POS 주문 수집 — 리뷰 반영
-- 1) pos_product_daily 뷰가 소유자 권한으로 실행돼 RLS를 우회하던 문제 → security_invoker
-- 2) 상품별 합산을 SQL 에서 수행하는 함수 (PostgREST 1000행 제한 회피)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

-- 1. 뷰가 호출자 권한으로 실행되도록 → 기반 테이블 RLS(is_member_of) 적용
alter view pos_product_daily set (security_invoker = true);

-- 2. 기간 내 매장 상품별 합산 (완료 주문만, KST 날짜 양 끝 포함)
--    security invoker: 호출자 RLS 적용. 서버 액션은 서비스 롤로 호출.
create or replace function pos_product_sales(p_workplace_id uuid, p_from date, p_to date)
returns table (item_title text, item_code text, qty numeric, amount numeric)
language sql stable security invoker as $$
  select i.item_title,
         i.item_code,
         sum(i.quantity)                as qty,
         sum(i.quantity * i.unit_price) as amount
  from pos_orders o
  join pos_order_items i on i.order_id = o.id
  where o.workplace_id = p_workplace_id
    and o.order_state = 'COMPLETED'
    and o.completed_at is not null
    and (o.completed_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by i.item_title, i.item_code
  order by qty desc;
$$;
