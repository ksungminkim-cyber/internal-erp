-- ========================================================================
-- 1) pos_product_usage.qty_per_unit 정밀도 확장: numeric(12,3) → numeric(14,6)
--    (750ml 병·5L 통처럼 1000이 아닌 용량에서 ml 입력이 3자리 반올림으로 어긋나는 문제)
-- 2) 직접 제조 품목은 리드타임 기본 0일 (만들면 바로 쓰므로 4일치 과제조 안내 방지)
-- 3) workplaces.monthly_sales_target: 월 매출 목표 (KPI 카드). 기본 2,000만원
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table pos_product_usage
  alter column qty_per_unit type numeric(14,6);

update inventory_items set lead_time_days = 0
  where supply_type = 'made' and lead_time_days = 2;

alter table workplaces
  add column if not exists monthly_sales_target numeric(14,0) not null default 20000000;
comment on column workplaces.monthly_sales_target is '월 매출 목표(원) — 매출 화면 KPI 카드';
