// src/lib/usageSuggest.js
// 레시피(recipes.ingredients)에서 "토스 상품 1개당 재고 품목 소요량" 기본값을 추천하는 순수 함수.
// 반환값에 레시피 재료의 단위를 함께 담는다 — 품목 단위(봉·병·개)와 다를 수 있으므로 화면에서 비교해 보여준다.

// 품목명에 들어 있는 키워드 → 레시피 재료명에서 찾을 키워드
const KEYWORDS = [
  { item: ['원두', '에스프레소'], ingredient: ['에스프레소', '원두', '샷'] },
  { item: ['우유'], ingredient: ['우유'] },
  { item: ['시럽'], ingredient: ['시럽'] },
  { item: ['토스트', '식빵'], ingredient: ['식빵', '토스트'] },
];

// 상품명의 온도 표기 → 'ICE' | 'HOT' | null
export function temperatureOf(title) {
  const s = String(title ?? '').toLowerCase();
  if (/\b(ice|iced)\b|아이스(?!크림)/.test(s)) return 'ICE';
  if (/\bhot\b|(^|[^가-힣])핫|핫(초코|라떼|아메리카노)/.test(s)) return 'HOT';
  return null;
}

// 공백·대소문자·온도 표기(ICE/HOT/아이스/핫)·괄호·구분 기호 제거. "아이스크림"은 보존.
export function normalizeTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\(|\)|\[|\]|-|–|·|\/|,/g, ' ')
    .replace(/\b(ice|hot|iced)\b/g, ' ')
    .replace(/아이스(?!크림)/g, ' ')
    .replace(/(^|\s)핫(?=\s|$|[가-힣])/g, ' ')
    .replace(/\s+/g, '');
}

// "180(ICE), 250(HOT)" 같은 문자열에서 온도 라벨에 맞는 숫자. 라벨이 없으면 첫 숫자.
function pickNumber(qtyText, temp) {
  const s = String(qtyText ?? '');
  if (temp) {
    // "180(ICE)" / "250 HOT" 처럼 숫자 뒤에 온도 라벨이 붙은 조각을 찾는다
    const re = temp === 'ICE' ? /(\d+(?:\.\d+)?)\s*\(?\s*ice/i : /(\d+(?:\.\d+)?)\s*\(?\s*hot/i;
    const m = s.match(re);
    if (m) return Number(m[1]);
  }
  const m = s.match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * @param {string} productTitle 토스 상품명
 * @param {string} itemName 재고 품목명
 * @param {{ name: string, ingredients: { name: string, qty: string|number, unit?: string }[] }[]} recipes
 * @returns {{ qty: number, unit: string }|null}
 */
export function suggestQty(productTitle, itemName, recipes) {
  const kw = KEYWORDS.find((k) => k.item.some((w) => String(itemName).includes(w)));
  if (!kw) return null;
  const p = normalizeTitle(productTitle);
  if (!p) return null;
  const temp = temperatureOf(productTitle);
  // 상품명이 레시피명을 포함하는 것 중 가장 긴 레시피명 우선 ("라떼" 상품이 "바닐라 라떼"에 붙지 않도록 반대 방향은 보지 않음)
  const candidates = (recipes ?? [])
    .map((r) => ({ r, n: normalizeTitle(r.name) }))
    .filter(({ n }) => n && p.includes(n))
    .sort((a, b) => b.n.length - a.n.length);
  for (const { r } of candidates) {
    const ing = (r.ingredients ?? []).find((i) => kw.ingredient.some((w) => String(i.name ?? '').includes(w)));
    if (ing) {
      const q = pickNumber(ing.qty, temp);
      if (q != null && q > 0) return { qty: q, unit: String(ing.unit ?? '').trim() };
    }
  }
  return null;
}
