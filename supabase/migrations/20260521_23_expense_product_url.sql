-- 지출 항목에 구매처 URL 추가 (재발주 시 바로가기용)
alter table expense_items
  add column if not exists product_url text;
