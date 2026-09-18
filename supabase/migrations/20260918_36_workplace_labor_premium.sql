-- ========================================================================
-- 매장별 가산수당 면제 플래그 (상시 5인 미만 사업장)
-- 근로기준법 제11조: 5인 미만 사업장은 연장·야간·휴일 가산수당 의무 없음 (주휴수당은 적용)
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

alter table workplaces
  add column if not exists labor_premium_exempt boolean not null default false;

comment on column workplaces.labor_premium_exempt is
  '5인 미만 사업장 — 인건비 계산 시 연장·야간 가산수당(+50%) 미적용';

-- 나울(김포): 5인 미만
update workplaces set labor_premium_exempt = true where name = '나울';
