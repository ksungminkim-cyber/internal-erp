// src/lib/adsInsights.js
// 광고 현황 해석 엔진 (순수 함수, 브라우저·서버 공용). 숫자를 "무슨 뜻인지 · 뭘 할지 · 무엇을 실험할지"로 바꾼다.
// 입력은 ad_dashboard.data 의 days 항목들: { d, meta:{cost,imp,in,reach,c:[...]}, google:{...}, naver:{...,rank}, karrot:{...} }

export const CHANNELS = [
  { k: 'meta', label: '메타', inL: '프로필 방문' },
  { k: 'google', label: '구글', inL: '클릭' },
  { k: 'naver', label: '네이버', inL: '클릭' },
  { k: 'karrot', label: '당근', inL: '클릭' },
];

// 채널 하나의 기간 집계. days: 일 항목 배열, ch: 채널 키
export function stats(days, ch) {
  const o = { cost: 0, imp: 0, inn: 0, reach: 0, days: 0, spendDays: 0, rankSum: 0, rankN: 0, camps: {} };
  for (const x of days) {
    const v = x && x[ch];
    if (!v) continue;
    o.days++;
    o.cost += v.cost || 0; o.imp += v.imp || 0; o.inn += v.in || 0; o.reach += v.reach || 0;
    if ((v.cost || 0) > 0) o.spendDays++;
    if (v.rank) { o.rankSum += v.rank; o.rankN++; }
    for (const c of v.c || []) { const m = (o.camps[c.name] = o.camps[c.name] || { cost: 0, imp: 0, inn: 0 }); m.cost += c.cost || 0; m.imp += c.imp || 0; m.inn += c.clicks || c.results || 0; }
  }
  o.ctr = o.imp ? o.inn / o.imp : 0;
  o.cpi = o.inn ? o.cost / o.inn : 0;
  o.freq = o.reach ? o.imp / o.reach : 0;
  o.perDay = o.days ? o.cost / o.days : 0;
  o.rank = o.rankN ? o.rankSum / o.rankN : 0;
  return o;
}

const ymdOf = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
const monday = (s) => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };

// 일·주·월 묶음. unit: 'day' | 'week' | 'month'. 최신이 마지막. live(오늘)는 마지막 묶음에 합친다.
export function bucketize(days, unit, { limit = 14 } = {}) {
  const keyOf = unit === 'day' ? (d) => d : unit === 'week' ? monday : (d) => d.slice(0, 7);
  const m = new Map();
  for (const x of days) {
    const k = keyOf(x.d);
    if (!m.has(k)) m.set(k, { key: k, from: x.d, to: x.d, days: [], live: false });
    const b = m.get(k);
    b.days.push(x); if (x.d < b.from) b.from = x.d; if (x.d > b.to) b.to = x.d; if (x.live) b.live = true;
  }
  const out = [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const b of out) {
    b.label = unit === 'day' ? b.from : unit === 'week' ? `${b.key} 주` : b.key;
    b.expectDays = unit === 'day' ? 1 : unit === 'week' ? 7 : new Date(+b.key.slice(0, 4), +b.key.slice(5, 7), 0).getDate();
    b.partial = b.days.length < b.expectDays;
  }
  return out.slice(-limit);
}

// 버튼: kind 가 'link' 면 새 탭으로 열고, 그 외는 서버 액션(runAdAction)으로 실제 설정을 바꾼다
export const LINKS = {
  naver: 'https://searchad.naver.com/', google: 'https://ads.google.com/aw/campaigns', googleBilling: 'https://ads.google.com/aw/billing/summary',
  meta: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=1513789977241121', karrot: 'https://ads-pro.business.daangn.com/', karrotCash: 'https://ads.business.daangn.com/',
};
const link = (label, url) => ({ kind: 'link', label, url });
const op = (kind, label, args, confirm) => ({ kind, label, args, confirm });
const CH_KEY = { 메타: 'meta', 구글: 'google', 네이버: 'naver', 당근: 'karrot' };
const managerLink = (ch) => link(`${ch} 광고 관리자 열기`, LINKS[CH_KEY[ch]]);
const pct = (a, b) => (b ? (a - b) / b : 0);
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const p1 = (n) => `${(n * 100).toFixed(1)}%`;

// 해석 생성. cur/prev/base 는 일 항목 배열. D 는 마감 데이터 전체(naver.ads, google.status, alerts, funding), L 은 오늘 실시간(없으면 null).
// 반환: { findings: [{ch, level:'bad'|'warn'|'good'|'info', title, meaning, action, test?, priority}], plan: [...findings 중 액션 우선순위순] }
export function buildInsights({ cur, prev = [], base = [], D = {}, isToday = false }) {
  const F = [];
  const add = (ch, level, title, meaning, action, test, priority, ops = []) => F.push({ ch, level, title, meaning, action, test, priority: priority ?? (level === 'bad' ? 1 : level === 'warn' ? 2 : 3), ops });
  // 채널별 "예산 +20%" 버튼 (당근은 쓰기 API 미확인이라 링크)
  const budgetUp = (ch, campaign) => ch === '네이버' ? op('naver.budget', '일예산 +20%', { pct: 20 }, '네이버 플레이스 캠페인 일예산을 20% 올립니다.')
    : ch === '메타' ? op('meta.budget', '일예산 +20%', { campaign, pct: 20 }, `메타 「${campaign}」 광고 세트 일예산을 20% 올립니다.`)
    : ch === '구글' ? op('google.budget', '일예산 +20%', { campaign, pct: 20 }, `구글 「${campaign}」 캠페인 일예산을 20% 올립니다.`)
    : managerLink(ch);
  const resume = (ch) => ch === '네이버' ? op('naver.campaignLock', '캠페인 재개', { lock: false }, '네이버 플레이스 캠페인을 다시 켭니다.')
    : ch === '메타' ? op('meta.status', '광고 세트 재개', { status: 'ACTIVE' }, '메타 광고 세트를 모두 다시 켭니다.')
    : managerLink(ch);
  const topCamp = (k) => Object.entries(S[k].camps).sort((a, b) => b[1].cost - a[1].cost)[0]?.[0];
  const small = (s) => s.imp < 500 || s.inn < 10;
  const S = {}, B = {}, P = {};
  for (const c of CHANNELS) { S[c.k] = stats(cur, c.k); B[c.k] = stats(base, c.k); P[c.k] = stats(prev, c.k); }

  // ── 채널 공통: 집행 중단 · 효율 변화
  for (const c of CHANNELS) {
    const s = S[c.k], b = B[c.k];
    if (!s.days) { add(c.label, 'info', '이 기간 집행 기록 없음', '수집이 안 됐거나 광고가 꺼져 있었습니다.', '캠페인 상태와 잔액을 확인하세요.', null, 3); continue; }
    if (!isToday && s.days >= 2 && s.spendDays < s.days && b.spendDays > 0) {
      add(c.label, s.spendDays === 0 ? 'bad' : 'warn', `${s.days}일 중 ${s.days - s.spendDays}일 지출 0원`, '잔액 소진·일시중지·승인 대기 중 하나입니다. 꺼진 날은 노출이 아예 없어 유입도 0입니다.', '잔액과 캠페인 상태를 보고, 의도한 중단이 아니면 바로 재개. 선불 채널은 자동충전을 켜 두면 재발하지 않습니다.', null, s.spendDays === 0 ? 1 : 2, [resume(c.label), managerLink(c.label)]);
    }
    if (small(s)) { add(c.label, 'info', '표본이 작아 효율 판단 유보', `노출 ${s.imp.toLocaleString('ko-KR')} · ${c.inL} ${s.inn}. 이 정도로는 소재·입찰 판단이 흔들립니다.`, '최소 노출 1,000 · 유입 30 이상 쌓인 뒤 비교하세요.', null, 3); continue; }
    if (!small(b)) {
      const dc = pct(s.cpi, b.cpi), dt = pct(s.ctr, b.ctr);
      if (dc >= 0.25) {
        const fatigue = dt <= -0.2;
        add(c.label, 'warn', `${c.inL}당 비용 ${won(s.cpi)} (평소 ${won(b.cpi)}, +${Math.round(dc * 100)}%)`,
          fatigue ? `클릭률도 ${p1(b.ctr)}→${p1(s.ctr)}로 떨어졌습니다. 같은 사람에게 같은 소재가 반복 노출돼 반응이 식은 "소재 피로" 신호입니다.` : `클릭률은 그대로인데 단가만 올랐습니다. 경쟁 입찰이 세졌거나 노출 지면이 바뀐 것입니다.`,
          fatigue ? '새 소재(사진·첫 문장)를 1개 추가하고 2주 뒤 비교.' : '입찰가·타깃 지역을 먼저 확인하고, 변경 없이 올랐다면 예산을 효율 좋은 채널로 일부 옮기세요.',
          fatigue ? { what: '기존 소재 vs 새 소재', how: '같은 예산·같은 기간(14일) 동시 집행', judge: `${c.inL}당 비용이 20% 이상 낮은 쪽 유지` } : null, 2, [managerLink(c.label)]);
      } else if (dc <= -0.2) {
        add(c.label, 'good', `${c.inL}당 비용 ${won(s.cpi)} (평소보다 ${Math.round(-dc * 100)}% 저렴)`, '같은 돈으로 더 많은 유입을 받고 있습니다. 소재나 타깃이 잘 맞는 상태입니다.', '지금 소재·설정을 바꾸지 말고, 여유가 있으면 이 채널 일예산을 20% 올려 같은 효율이 유지되는지 보세요.', null, 3, [budgetUp(c.label, topCamp(c.k))]);
      }
      const ds = pct(s.perDay, b.perDay);
      if (Math.abs(ds) >= 0.3 && !isToday) add(c.label, 'info', `하루 광고비 ${won(s.perDay)} (평소 ${won(b.perDay)}, ${ds > 0 ? '+' : ''}${Math.round(ds * 100)}%)`, ds > 0 ? '예산을 올렸거나 새 캠페인이 추가된 상태입니다.' : '예산 축소·잔액 부족·캠페인 종료 중 하나입니다.', ds > 0 ? '유입당 비용이 같이 오르지 않는지 위 항목을 함께 보세요.' : '의도한 축소가 아니면 잔액과 상태를 확인하세요.', null, 3);
    }
  }

  // ── 구글
  {
    const s = S.google;
    if (s.days && !small(s)) {
      const camps = Object.entries(s.camps).sort((a, b) => b[1].cost - a[1].cost);
      const top = camps[0];
      if (top && s.cost && top[1].cost / s.cost >= 0.85) {
        const ctr = top[1].imp ? top[1].inn / top[1].imp : 0;
        add('구글', 'info', `광고비의 ${Math.round((top[1].cost / s.cost) * 100)}%가 「${top[0]}」 한 캠페인`, '한 캠페인에 성과가 묶여 있어 그 캠페인이 흔들리면 전체가 흔들립니다.', '검색 캠페인(의도가 분명한 유입)에도 예산을 나눠 두 축으로 운영하세요.', { what: '디맨드젠 vs 검색', how: '2주간 일예산 1:1로 맞춰 집행', judge: '클릭당 비용이 아니라 플레이스 길찾기·전화 수와 POS 매출 변화로 판단' }, 2, [managerLink('구글')]);
        if (/디스플레이|디맨드젠/.test(top[0]) && ctr >= 0.04) add('구글', 'warn', `「${top[0]}」 클릭률 ${p1(ctr)} — 디스플레이 지면치고 비정상적으로 높음`, '디스플레이·디맨드젠 평균 클릭률은 0.5~1%입니다. 4% 이상이면 앱·쇼츠 지면의 실수 클릭이 섞여 있을 가능성이 큽니다. 싸 보이는 클릭이 실제 방문으로 이어지지 않을 수 있습니다.', '광고 관리자에서 게재 지면별 성과를 열어 모바일 앱·쇼츠 지면을 제외하고, 이 캠페인 클릭 수와 네이버 플레이스 조회·길찾기 수가 같이 움직이는지 주 단위로 대조하세요.', { what: '앱 지면 포함 vs 제외', how: '캠페인을 복제해 지면만 다르게 2주', judge: '클릭당 비용이 올라도 플레이스 길찾기·전화가 더 늘어난 쪽 유지' }, 2, [link('게재 지면 보기', LINKS.google)]);
      }
      const limited = ((D.google && D.google.status && D.google.status.campaigns) || []).filter((c) => /제한/.test(c.status));
      for (const c of limited) add('구글', 'info', `「${c.name}」 예산 제약 상태`, '검색 광고는 "합정 카페"처럼 찾는 사람에게만 나가므로 유입의 질이 가장 높은데, 일예산이 작아 노출 기회를 놓치고 있습니다.', `일예산을 ${won((c.budget || 10000) * 1.5)} 정도로 올려 2주간 클릭당 비용 변화를 보세요.`, null, 3, [op('google.budget', `일예산 ${won((c.budget || 10000) * 1.5)}으로`, { campaign: c.name, amount: (c.budget || 10000) * 1.5 }, `구글 「${c.name}」 캠페인 일예산을 ${won((c.budget || 10000) * 1.5)}으로 바꿉니다.`)]);
    }
  }

  // ── 네이버 플레이스 소재
  {
    const ads = ((D.naver && D.naver.ads) || []).filter((a) => a.imp >= 1000);
    if (ads.length >= 2) {
      const withCtr = ads.map((a) => ({ ...a, ctr: a.clicks / a.imp })).sort((a, b) => b.ctr - a.ctr);
      const best = withCtr[0], worst = withCtr[withCtr.length - 1];
      if (worst.ctr < best.ctr * 0.8) add('네이버', 'warn', `소재 격차 (최근 7일): 「${best.name}」 ${p1(best.ctr)} vs 「${worst.name}」 ${p1(worst.ctr)}`, '플레이스 광고는 소재가 고르게 번갈아 노출되므로 클릭률 차이가 곧 문구의 힘 차이입니다. 낮은 소재가 노출을 나눠 먹는 만큼 전체 유입이 줄어듭니다.', `「${worst.name}」 소재를 내리고 「${best.name}」 소재의 문구 하나만 바꾼 변형을 올리세요.`, { what: `「${best.name}」 vs 그 변형(메뉴명·거리 문구 중 1개만 교체)`, how: '동시 노출 2주, 각 노출 5,000 이상', judge: '클릭률이 높은 쪽 유지, 진 쪽은 다음 변형으로 교체' }, 2, [op('naver.adLock', `「${worst.name}」 끄기`, { name: worst.name, lock: true }, `네이버 플레이스 소재 「${worst.name}」를 끕니다 (다시 켤 수 있음).`), link('변형 소재 올리기', LINKS.naver)]);
      else add('네이버', 'good', `소재 ${ads.length}개 클릭률 ${p1(worst.ctr)}~${p1(best.ctr)}로 고름 (최근 7일)`, '모든 문구가 비슷하게 먹히고 있어 소재 문제는 없습니다.', '지금 소재는 두고, 계절 메뉴가 바뀔 때만 1개씩 교체하세요.', null, 3);
    }
    const s = S.naver;
    if (s.rank && s.rank > 3.5) add('네이버', 'info', `평균 노출 순위 ${s.rank.toFixed(1)}위`, '플레이스 광고는 상위 2~3개가 클릭을 대부분 가져갑니다. 4위 근처면 노출은 되지만 클릭 기회가 줄어듭니다.', '입찰가를 10% 올려 순위와 클릭당 비용이 어떻게 움직이는지 1주 보세요.', { what: '현재 입찰가 vs +10%', how: '1주씩 번갈아', judge: '클릭당 비용 상승분보다 클릭 수 증가가 크면 유지' }, 3, [op('naver.bid', '입찰가 +10%', { pct: 10 }, '네이버 플레이스 광고그룹 입찰가를 10% 올립니다.'), op('naver.bid', '입찰가 −10%', { pct: -10 }, '네이버 플레이스 광고그룹 입찰가를 10% 내립니다.')]);
  }

  // ── 메타
  {
    const s = S.meta;
    if (s.days && s.reach && s.freq >= 2.5) add('메타', 'warn', `같은 사람에게 평균 ${s.freq.toFixed(1)}회 노출`, '도달한 사람 수에 비해 노출이 많습니다. 3회를 넘기면 프로필 방문당 비용이 오르기 시작합니다.', '타깃 지역을 넓히거나(반경 +1km) 소재를 바꾸세요.', { what: '창가 바 자리 vs 프렌치토스트 소재', how: '같은 예산으로 7일 동시 집행', judge: '프로필 방문당 비용이 낮은 쪽에 예산 집중' }, 2, [managerLink('메타')]);
    else if (s.days && !small(s)) add('메타', 'info', `프로필 방문당 ${won(s.cpi)}`, '메타 유입은 "클릭"이 아니라 인스타 프로필 방문입니다. 팔로우·DM·저장으로 이어지는지가 진짜 성과입니다.', '인스타 인사이트에서 같은 기간 팔로워 증가·프로필 방문을 대조하세요. 광고비 대비 팔로워 1명당 비용이 1,000원 아래면 유지.', null, 3);
  }

  // ── 당근
  {
    const s = S.karrot;
    const camps = Object.entries(s.camps).filter(([, v]) => v.inn >= 10).map(([n, v]) => [n, v.cost / v.inn]).sort((a, b) => a[1] - b[1]);
    if (camps.length >= 2 && camps[camps.length - 1][1] >= camps[0][1] * 1.4) add('당근', 'warn', `캠페인 효율 차이: 「${camps[0][0]}」 클릭당 ${won(camps[0][1])} vs 「${camps[camps.length - 1][0]}」 ${won(camps[camps.length - 1][1])}`, '같은 동네 타깃인데 소재·문구에 따라 클릭 단가가 1.4배 이상 벌어졌습니다.', '비싼 캠페인 예산을 싼 캠페인으로 옮기거나, 비싼 쪽 소재를 싼 쪽 스타일로 바꾸세요.', { what: '소재 사진(바 vs 토스트) · 첫 문장', how: '전문가모드 소재 6개 중 클릭률 상위 2개만 남기고 2주', judge: '클릭당 300원 아래 유지되면 일예산 증액' }, 2, [managerLink('당근')]);
    if (s.days && !small(s)) add('당근', 'info', `클릭당 ${won(s.cpi)} — 네이버·구글보다 비싸지만 성격이 다름`, '당근은 반경 몇 km 안 주민에게만 나갑니다. 단골이 될 확률이 높은 대신 클릭 단가는 높습니다.', '클릭 수보다 비즈프로필 "단골"·"관심" 증가로 판단하세요. 주 단위로 단골 수를 적어 두면 비용 대비 효과가 보입니다.', null, 3);
  }

  // ── 마감 때 남긴 메모성 경고만 참고로 (잔액 경고는 채널 카드의 잔액 표시로 대신한다)
  for (const a of D.alerts || []) if (!/잔액|비즈머니|캐시|소진|한도/.test(a.text)) add(a.ch, 'info', a.text, null, null, null, 3);

  // ── 전체: 채널 믹스
  {
    const tot = CHANNELS.reduce((a, c) => a + S[c.k].cost, 0);
    const rows = CHANNELS.filter((c) => S[c.k].inn >= 10).map((c) => ({ ...c, cpi: S[c.k].cpi, share: tot ? S[c.k].cost / tot : 0 }));
    if (rows.length >= 2) {
      const cheap = [...rows].sort((a, b) => a.cpi - b.cpi)[0];
      add('종합', 'info', `유입 단가 최저 채널: ${cheap.label} (${cheap.inL}당 ${won(cheap.cpi)}, 광고비의 ${Math.round(cheap.share * 100)}%)`, '단가만 보면 이 채널에 몰아야 하지만, 채널마다 "유입"의 뜻이 다릅니다. 구글 클릭은 실수 클릭이 섞이고, 메타는 프로필 방문, 네이버는 가게를 찾던 사람의 클릭, 당근은 동네 주민입니다.', '광고비 배분은 단가가 아니라 매출로 정하세요. 주 단위로 채널별 광고비와 POS 매출(낮·바 분리)을 같은 표에 두고, 광고비를 올린 주에 매출이 따라오는 채널에 더 주세요.', { what: '한 채널씩 예산 +30%', how: '2주씩 순서대로(다른 채널은 고정)', judge: '그 2주의 매출 증가분이 추가 광고비의 3배 이상이면 유지' }, 2);
    }
  }

  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  F.sort((a, b) => a.priority - b.priority || order[a.level] - order[b.level]);
  const plan = F.filter((f) => f.action && f.level !== 'good').slice(0, 6);
  return { findings: F, plan };
}

// 선불 잔액 추정: 기준일(asOf) 끝의 잔액에서 그 뒤 날짜의 채널 지출을 뺀다. 잔액 조회 API가 없는 당근용
export function prepaidBalance(base, asOf, days, ch) {
  return Math.max(0, base - days.reduce((a, x) => a + (x.d > asOf && x[ch] ? x[ch].cost || 0 : 0), 0));
}

// 하루 지출 속도: 최근 n일 중 지출이 있었던 날의 중앙값. 0원인 날(잔액 소진·중지)과 중간에 끊긴 날에 덜 흔들린다 (「며칠 남음」 계산용)
export function spendPace(days, ch, n = 7) {
  const v = days.slice(-n).map((x) => (x[ch] && x[ch].cost) || 0).filter((c) => c > 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
