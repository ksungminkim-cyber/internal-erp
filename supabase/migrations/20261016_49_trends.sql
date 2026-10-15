-- ========================================================================
-- 홈 "이번 주 트렌드 픽" — 네이버 데이터랩 검색 추이 + 블로그 게시물 수 + 매장 POS 신호 → 메뉴 개발 후보
-- 1) trend_keywords: 추적 키워드(전사 공용). 시드 50개
-- 2) trend_snapshots: 키워드×주 단위 검색 지수·블로그 게시물 수
-- 3) trend_picks: 매장×주 단위 생성 결과(점수 상위 키워드 + 메뉴 후보 jsonb)
-- 4) pg_cron: 매주 화요일 05:00 KST(월요일 20:00 UTC) /api/trends/refresh 호출
-- 실행 전: __POS_SYNC_SECRET__ 을 Vercel 환경변수 POS_SYNC_SECRET 값으로 바꿀 것
-- Supabase Dashboard → SQL Editor → 이 파일 전체 복붙 → Run
-- ========================================================================

create table if not exists trend_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null unique,
  group_name text,                         -- '과일', '디저트', '음료', '재료', '주류'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  keyword_id uuid not null references trend_keywords(id) on delete cascade,
  week_start date not null,                -- 네이버 데이터랩 주 시작일(월요일)
  search_index numeric(8,2),               -- 데이터랩 상대 지수 (키워드별 기간 내 최대 100)
  blog_posts integer,                      -- 네이버 블로그 검색 총 게시물 수(스냅샷 시점)
  fetched_at timestamptz not null default now(),
  unique (keyword_id, week_start)
);
create index if not exists idx_trend_snap_week on trend_snapshots(week_start desc);

create table if not exists trend_picks (
  id uuid primary key default gen_random_uuid(),
  workplace_id uuid not null references workplaces(id) on delete cascade,
  week_start date not null,
  generated_at timestamptz not null default now(),
  items jsonb not null default '[]',       -- [{ keyword, group, score, change_pct, series:[..], blog_posts, internal:{...}|null, cafe:[{name,why}], bar:[{name,why}] }]
  model text,                              -- 메뉴 후보 생성에 쓴 모델 (없으면 null = 추이만)
  unique (workplace_id, week_start)
);

alter table trend_keywords enable row level security;
alter table trend_snapshots enable row level security;
alter table trend_picks enable row level security;

-- 키워드·스냅샷은 전사 공용: 활성 멤버면 조회
drop policy if exists "trend_keywords_select" on trend_keywords;
create policy "trend_keywords_select" on trend_keywords for select using (
  exists (select 1 from memberships where user_id = auth.uid() and active = true)
);
drop policy if exists "trend_snapshots_select" on trend_snapshots;
create policy "trend_snapshots_select" on trend_snapshots for select using (
  exists (select 1 from memberships where user_id = auth.uid() and active = true)
);
drop policy if exists "trend_picks_select" on trend_picks;
create policy "trend_picks_select" on trend_picks for select using (is_member_of(workplace_id));

-- 시드 키워드 (제철 과일·디저트·음료·재료·주류)
insert into trend_keywords (keyword, group_name) values
  ('무화과', '과일'), ('샤인머스캣', '과일'), ('딸기', '과일'), ('감', '과일'), ('밤', '과일'), ('고구마', '과일'),
  ('유자', '과일'), ('한라봉', '과일'), ('청포도', '과일'), ('복숭아', '과일'), ('자두', '과일'), ('애플망고', '과일'),
  ('레몬', '과일'), ('라임', '과일'), ('자몽', '과일'), ('블루베리', '과일'), ('체리', '과일'), ('멜론', '과일'),
  ('두바이 초콜릿', '디저트'), ('피스타치오', '디저트'), ('크로플', '디저트'), ('프렌치토스트', '디저트'), ('티라미수', '디저트'),
  ('바스크 치즈케이크', '디저트'), ('말렌카', '디저트'), ('소금빵', '디저트'), ('약과', '디저트'), ('몽블랑', '디저트'),
  ('타르트', '디저트'), ('스콘', '디저트'), ('마카롱', '디저트'), ('젤라또', '디저트'),
  ('말차', '음료'), ('흑임자', '음료'), ('얼그레이', '음료'), ('밀크티', '음료'), ('콜드브루', '음료'), ('아인슈페너', '음료'),
  ('플랫화이트', '음료'), ('바닐라라떼', '음료'), ('초코라떼', '음료'), ('히비스커스', '음료'), ('제로 음료', '음료'), ('에이드', '음료'),
  ('하이볼', '주류'), ('네그로니', '주류'), ('에스프레소 마티니', '주류'), ('위스키', '주류'), ('내추럴 와인', '주류'), ('칵테일', '주류')
on conflict (keyword) do nothing;

-- 주간 자동 실행 (화요일 05:00 KST). 본문 {} = 전 매장
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'trends-weekly';
select cron.schedule('trends-weekly', '0 20 * * 1', $$
  select net.http_post(
    url     := 'https://counter.mclean21.com/api/trends/refresh',
    headers := '{"Content-Type":"application/json","x-sync-secret":"__POS_SYNC_SECRET__"}'::jsonb,
    body    := '{}'::jsonb);
$$);
