-- OPI → OKR 으로 명칭 변경
-- (Objectives and Key Results — 목표와 핵심 결과)

-- 1) 기존 데이터 변환
update kpis set category = 'okr' where category = 'opi';

-- 2) CHECK constraint 갱신
alter table kpis drop constraint if exists kpis_category_check;
alter table kpis
  add constraint kpis_category_check
  check (category in ('kpi', 'okr'));
