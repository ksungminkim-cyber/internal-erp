import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoreOverview } from './storeOverview.js';

const stores = [{ id: 'n', name: '녹턴' }, { id: 'a', name: '나울' }];
const base = { stores, today: '2026-11-17', yesterday: '2026-11-16' };

test('매장별 오늘·어제 매출과 거래 수, 두 매장 합계', () => {
  const o = buildStoreOverview({
    ...base,
    sales: [
      { workplace_id: 'n', sales_date: '2026-11-17', total_amount: '273000', transaction_count: 31 },
      { workplace_id: 'n', sales_date: '2026-11-16', total_amount: '410000', transaction_count: 40 },
      { workplace_id: 'a', sales_date: '2026-11-17', total_amount: 139000, transaction_count: 7 },
    ],
  });
  assert.deepEqual(o.stores.map((s) => [s.name, s.todaySales, s.todayCount, s.yesterdaySales]),
    [['녹턴', 273000, 31, 410000], ['나울', 139000, 7, 0]]);
  assert.equal(o.totalSales, 412000);
  assert.equal(o.totalCount, 38);
});

test('매출 기록이 없는 매장은 0 으로 나온다 (빠지지 않는다)', () => {
  const o = buildStoreOverview({ ...base, sales: [] });
  assert.equal(o.stores.length, 2);
  assert.equal(o.stores[0].todaySales, 0);
  assert.equal(o.totalSales, 0);
});

test('근무 중 = 근무·휴게 상태인 사람, 이름과 함께', () => {
  const o = buildStoreOverview({
    ...base,
    boards: [
      { workplace_id: 'n', user_id: 'u1', status: 'working', name: '윤예원' },
      { workplace_id: 'n', user_id: 'u2', status: 'on_break', name: '이종환' },
      { workplace_id: 'n', user_id: 'u3', status: 'off', name: '퇴근한사람' },
      { workplace_id: 'a', user_id: 'u4', status: 'off', name: '나울직원' },
    ],
  });
  assert.deepEqual(o.stores[0].working, ['윤예원', '이종환']);
  assert.deepEqual(o.stores[1].working, []);
});

test('진행 중 결재·발주 권장·평소 대비는 매장별로', () => {
  const o = buildStoreOverview({
    ...base,
    pending: [{ workplace_id: 'n' }, { workplace_id: 'n' }, { workplace_id: 'a' }],
    orderCounts: { n: 5 },
    vsUsual: { n: 12, a: null },
  });
  assert.deepEqual(o.stores.map((s) => [s.pendingApprovals, s.orderCount, s.vsUsualPct]), [[2, 5, 12], [1, 0, null]]);
});
