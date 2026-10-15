// src/lib/usageSuggest.js
// 레시피(recipes.ingredients)에서 "토스 상품 1개당 재고 품목 소요량" 기본값을 추천하는 순수 함수.

// 품목명에 들어 있는 키워드 → 레시피 재료명에서 찾을 키워드
const KEYWORDS = [
  { item: ['원두', '에스프레소'], ingredient: ['에스프레소', '원두', '샷'] },
  { item: ['우유'], ingredient: ['우유'] },
  { item: ['시럽'], ingredient: ['시럽'] },
  { item: ['토스트', '식빵'], ingredient: ['식빵', '토스트'] },
];

// 공백·대소문자·온도 표기(ICE/HOT/아이스/핫)·괄호·구분 기호 제거
export function normalizeTitle(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\(|\)|\[|\]|-|–|·|\/|,/g, ' ')
    .replace(/\b(ice|hot|iced)\b/g, ' ')
    .replace(/아이스|핫/g, ' ')
    .replace(/\s+/g, '');
}

function firstNumber(s) {
  const m = String(s ?? '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * @param {string} productTitle 토스 상품명
 * @param {string} itemName 재고 품목명
 * @param {{ name: string, ingredients: { name: string, qty: string|number }[] }[]} recipes
 * @returns {number|null}
 */
export function suggestQty(productTitle, itemName, recipes) {
  const kw = KEYWORDS.find((k) => k.item.some((w) => String(itemName).includes(w)));
  if (!kw) return null;
  const p = normalizeTitle(productTitle);
  if (!p) return null;
  // 상품명이 레시피명을 포함(또는 반대)하는 것 중 가장 긴 레시피명 우선
  const candidates = (recipes ?? [])
    .map((r) => ({ r, n: normalizeTitle(r.name) }))
    .filter(({ n }) => n && (p.includes(n) || n.includes(p)))
    .sort((a, b) => b.n.length - a.n.length);
  for (const { r } of candidates) {
    const ing = (r.ingredients ?? []).find((i) => kw.ingredient.some((w) => String(i.name ?? '').includes(w)));
    if (ing) {
      const q = firstNumber(ing.qty);
      if (q != null && q > 0) return q;
    }
  }
  return null;
}
