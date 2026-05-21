-- ========================================================================
-- Phase 3 — 장비 점검 / 레시피 / 고객 클레임
-- ========================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. EQUIPMENT — 장비 마스터
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists equipment (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  name text not null,                       -- '에스프레소 머신 1번', '그라인더 A'
  category text,                            -- '에스프레소 머신', '그라인더', '냉장고', 'POS', '청소기'
  model text,
  serial_no text,
  purchased_at date,
  warranty_until date,
  vendor text,                              -- 구매처/AS 연락처
  status text not null default 'ok'
    check (status in ('ok', 'warning', 'broken', 'retired')),
  next_check_at date,                       -- 다음 점검 예정일
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists equipment_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  workplace_id uuid not null references workplaces(id) on delete cascade,
  user_id uuid references profiles(user_id) on delete set null,
  log_type text not null
    check (log_type in ('check', 'maintenance', 'issue', 'repair', 'replace')),
  title text not null,
  description text,
  cost numeric(14,2),
  performed_at timestamptz not null default now(),
  next_check_at date,                       -- 이번 기록으로 갱신될 다음 점검일
  attachments jsonb,                        -- [{ path, name, type, size }]
  created_at timestamptz not null default now()
);

create index if not exists idx_equipment_workplace on equipment(workplace_id, archived);
create index if not exists idx_equipment_logs_equip on equipment_logs(equipment_id, performed_at desc);

-- 로그 기록 시 장비의 next_check_at, status 자동 반영
create or replace function apply_equipment_log()
returns trigger language plpgsql security definer as $$
begin
  update equipment
  set
    next_check_at = coalesce(new.next_check_at, next_check_at),
    status = case
      when new.log_type = 'repair'  then 'ok'
      when new.log_type = 'issue'   then 'warning'
      when new.log_type = 'replace' then 'ok'
      else status
    end,
    updated_at = now()
  where id = new.equipment_id;
  return new;
end;
$$;

drop trigger if exists trg_equipment_log on equipment_logs;
create trigger trg_equipment_log
  after insert on equipment_logs
  for each row execute function apply_equipment_log();

alter table equipment enable row level security;
alter table equipment_logs enable row level security;

drop policy if exists "equip_select" on equipment;
create policy "equip_select" on equipment
  for select using (is_member_of(workplace_id));
drop policy if exists "equip_modify_member" on equipment;
create policy "equip_modify_member" on equipment
  for all using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

drop policy if exists "equip_log_select" on equipment_logs;
create policy "equip_log_select" on equipment_logs
  for select using (is_member_of(workplace_id));
drop policy if exists "equip_log_insert" on equipment_logs;
create policy "equip_log_insert" on equipment_logs
  for insert with check (
    is_member_of(workplace_id) and (user_id = auth.uid() or user_id is null)
  );

alter publication supabase_realtime add table equipment;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RECIPES — 두 지점 공통 레시피 (조직 전체 공유)
-- ─────────────────────────────────────────────────────────────────────────
-- workplace_id 없음 — 모든 멤버가 공유. 매니저/대표만 수정 가능.
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,                            -- '에스프레소', '브루잉', '라떼/베리에이션', '논커피', '디저트', '베이커리'
  serving_size text,                        -- '1잔', '레귤러 240ml'
  ingredients jsonb not null default '[]',  -- [{ name, qty, unit, note }]
  steps jsonb not null default '[]',        -- ['샷 추출 18초', '우유 65도 스티밍', ...]
  cost numeric(14,2),                       -- 원가
  sell_price numeric(14,2),                 -- 판매가
  image_url text,
  notes text,                               -- 팁/주의사항
  active boolean not null default true,
  created_by uuid references profiles(user_id) on delete set null,
  updated_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recipes_category on recipes(category) where active = true;

alter table recipes enable row level security;

-- 조직 멤버(memberships 한 줄 이상 있으면) 누구나 SELECT
drop policy if exists "recipes_select_member" on recipes;
create policy "recipes_select_member" on recipes
  for select using (
    exists (select 1 from memberships where user_id = auth.uid() and active = true)
  );

-- 조직 내 매니저/대표 누구나 수정 가능 (전사 공유 콘텐츠)
drop policy if exists "recipes_modify_manager" on recipes;
create policy "recipes_modify_manager" on recipes
  for all using (
    exists (select 1 from memberships
            where user_id = auth.uid()
              and active = true
              and role in ('manager', 'owner'))
  )
  with check (
    exists (select 1 from memberships
            where user_id = auth.uid()
              and active = true
              and role in ('manager', 'owner'))
  );

alter publication supabase_realtime add table recipes;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. CUSTOMER COMPLAINTS — 고객 클레임 기록부
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists customer_complaints (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  reporter_id uuid references profiles(user_id) on delete set null,
  occurred_at timestamptz not null default now(),
  channel text not null default 'in_person'
    check (channel in ('in_person', 'phone', 'kakao', 'review', 'sns', 'other')),
  customer_label text,                      -- '여성 30대', '단골 김씨' 등 (개인정보 최소화)
  customer_contact text,                    -- 선택. 연락처
  category text not null default 'other'
    check (category in ('taste', 'service', 'hygiene', 'billing', 'wait', 'other')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high')),
  summary text not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  resolution text,
  resolved_at timestamptz,
  resolved_by uuid references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_complaints_workplace on customer_complaints(workplace_id, occurred_at desc);
create index if not exists idx_complaints_status on customer_complaints(workplace_id, status);

alter table customer_complaints enable row level security;

drop policy if exists "complaints_select_workplace" on customer_complaints;
create policy "complaints_select_workplace" on customer_complaints
  for select using (is_member_of(workplace_id));

drop policy if exists "complaints_insert_member" on customer_complaints;
create policy "complaints_insert_member" on customer_complaints
  for insert with check (
    is_member_of(workplace_id) and (reporter_id = auth.uid() or reporter_id is null)
  );

drop policy if exists "complaints_update_workplace" on customer_complaints;
create policy "complaints_update_workplace" on customer_complaints
  for update using (is_member_of(workplace_id))
  with check (is_member_of(workplace_id));

alter publication supabase_realtime add table customer_complaints;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. SEED — 기본 레시피 1개 (예시)
-- ─────────────────────────────────────────────────────────────────────────
insert into recipes (name, category, serving_size, ingredients, steps, sell_price, notes)
select '아메리카노', '에스프레소', '레귤러 350ml',
       '[{"name":"에스프레소","qty":2,"unit":"샷","note":""},{"name":"물","qty":300,"unit":"ml","note":"뜨거운 물"}]'::jsonb,
       '["20초 더블 샷 추출","300ml 뜨거운 물 컵에 따르기","샷 위로 가볍게 부어 layer 만들기"]'::jsonb,
       4500,
       '얼음 아메리카노는 얼음 7개 + 물 200ml로 조정'
where not exists (select 1 from recipes where name = '아메리카노');
