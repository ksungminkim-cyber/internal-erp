-- POS 가맹점 코드(매장 코드)를 workplaces 에 매핑하기 위한 컬럼
alter table workplaces
  add column if not exists pos_store_code text unique,
  add column if not exists pos_provider text;     -- 'toss', 'kis', 'other'
