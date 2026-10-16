// src/lib/server/trendIdeas.js
// 트렌드 키워드 + 매장 메뉴 맥락 → 카페/바 메뉴 개발 후보. Claude 구조화 출력. 서버 전용.
import Anthropic from '@anthropic-ai/sdk';

export const IDEAS_MODEL = 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          headline: { type: 'string', description: '이 트렌드를 한 줄로 (20자 이내)' },
          cafe: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'], additionalProperties: false },
          },
          bar: {
            type: 'array',
            items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string' } }, required: ['name', 'why'], additionalProperties: false },
          },
        },
        required: ['keyword', 'headline', 'cafe', 'bar'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
};

/**
 * @param {{ workplaceName: string, hasBar: boolean, menu: string[], topSellers: string[], recipes: string[],
 *           trends: { keyword: string, group: string, changePct: number|null, recentAvg: number, blogPosts: number|null, internal: string|null }[] }} ctx
 * @returns {Promise<{ picks: Array, model: string }>}
 */
export async function generateTrendIdeas(ctx, deps = {}) {
  const client = deps.client ?? new Anthropic();
  // 키워드는 입력 그대로 돌려받도록 enum 으로 고정 (변형되면 카드 행과 매칭이 끊김)
  const schema = JSON.parse(JSON.stringify(SCHEMA));
  schema.properties.picks.items.properties.keyword = { type: 'string', enum: ctx.trends.map((t) => t.keyword) };
  const system = [
    '당신은 한국 동네 카페·바의 메뉴 개발을 돕는 컨설턴트입니다.',
    '주어진 검색 트렌드와 매장 맥락만 근거로, 실제로 2주 안에 시험 출시할 수 있는 현실적인 메뉴 후보를 제안합니다.',
    '이미 매장에 있는 메뉴와 겹치지 않게 하고, 매장 레시피·재료를 활용할 수 있으면 그 점을 why 에 적습니다.',
    '이름은 손님에게 보일 메뉴명처럼 짧게(15자 이내), why 는 한 문장(40자 이내)으로 씁니다.',
    '바 메뉴는 매장에 바가 있을 때만 제안하고, 없으면 bar 는 빈 배열로 둡니다.',
    '트렌드마다 cafe 2개, (바가 있으면) bar 2개를 제안합니다. 검색량이 내려가는 키워드는 "지금 지나가는 유행"이라고 headline 에 솔직히 적습니다.',
  ].join('\n');

  const user = [
    `매장: ${ctx.workplaceName} (바 ${ctx.hasBar ? '있음' : '없음'})`,
    `현재 판매 상위 상품: ${ctx.topSellers.slice(0, 15).join(', ') || '(없음)'}`,
    `현재 메뉴 전체: ${ctx.menu.slice(0, 60).join(', ') || '(없음)'}`,
    `매장 레시피 보유: ${ctx.recipes.slice(0, 30).join(', ') || '(없음)'}`,
    '',
    '이번 주 트렌드 키워드 (최근 4주 검색 변화, 블로그 게시물 수, 매장 내부 신호):',
    ...ctx.trends.map((t, i) => `${i + 1}. ${t.keyword} [${t.group}] 검색 ${t.changePct == null ? '신규' : (t.changePct >= 0 ? '+' : '') + t.changePct + '%'} · 지수 ${t.recentAvg} · 블로그 ${t.blogPosts ?? '-'}건${t.internal ? ` · 매장: ${t.internal}` : ''}`),
    '',
    '각 키워드별로 메뉴 후보를 JSON 으로 주세요.',
  ].join('\n');

  const res = await client.messages.create({
    model: IDEAS_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`claude refusal: ${res.stop_details?.category ?? ''}`);
  if (res.stop_reason === 'max_tokens') throw new Error('claude truncated (max_tokens)');
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  return { picks: parsed.picks ?? [], model: res.model ?? IDEAS_MODEL };
}
