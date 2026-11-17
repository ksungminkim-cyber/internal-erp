import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHQWorkplace, splitWorkplaces, needsStore, hiddenInHQView, countInbox } from './hqView.js';

const mem = (id, name) => ({ workplace_id: id, workplaces: { id, name } });

test('본사만 전체 보기 사업장으로 본다', () => {
  assert.equal(isHQWorkplace({ name: '본사' }), true);
  assert.equal(isHQWorkplace({ name: '녹턴' }), false);
  assert.equal(isHQWorkplace(null), false);
});

test('사업장 목록을 본사와 매장으로 나눈다 (매장 순서는 그대로)', () => {
  const { hq, stores } = splitWorkplaces([mem('a', '나울'), mem('h', '본사'), mem('b', '녹턴')]);
  assert.equal(hq.workplace_id, 'h');
  assert.deepEqual(stores.map((m) => m.workplace_id), ['a', 'b']);
});

test('본사 소속이 아니면 hq 는 없다', () => {
  const { hq, stores } = splitWorkplaces([mem('b', '녹턴')]);
  assert.equal(hq, null);
  assert.equal(stores.length, 1);
});

test('매장 하나를 골라야 볼 수 있는 화면', () => {
  for (const p of ['/attendance', '/attendance/history', '/schedule', '/handover', '/checklists', '/inventory',
    '/sales', '/kpis', '/reports', '/closing', '/closing/print', '/announcements']) {
    assert.equal(needsStore(p), true, p);
  }
});

test('전체 보기에서도 그대로 열리는 화면', () => {
  for (const p of ['/home', '/approvals', '/approvals/new', '/approvals/abc-123', '/members', '/members/u1', '/audit',
    '/staffing', '/ads', '/recipes', '/recipes/r1', '/guide', '/me', '/operations']) {
    assert.equal(needsStore(p), false, p);
  }
});

test('전체 보기 메뉴에서 빠지는 것은 매장 일상 운영 항목', () => {
  for (const p of ['/attendance', '/schedule', '/handover', '/checklists', '/inventory', '/sales', '/kpis']) {
    assert.equal(hiddenInHQView(p), true, p);
  }
  for (const p of ['/home', '/approvals', '/announcements', '/recipes', '/guide', '/reports', '/closing', '/members', '/audit', '/staffing', '/ads']) {
    assert.equal(hiddenInHQView(p), false, p);
  }
});

test('결재 대기 수: 매장을 주면 그 매장 것만, 안 주면 전 매장', () => {
  const step = (wp, status, current, order) => ({ step_order: order, approval_requests: { workplace_id: wp, status, current_step: current } });
  const steps = [
    step('a', 'pending', 1, 1),   // 나울, 내 차례
    step('b', 'pending', 2, 2),   // 녹턴, 내 차례
    step('b', 'pending', 1, 2),   // 녹턴, 아직 앞 단계
    step('b', 'approved', 2, 2),  // 끝난 문서
  ];
  assert.equal(countInbox(steps, 'a'), 1);
  assert.equal(countInbox(steps, 'b'), 1);
  assert.equal(countInbox(steps, null), 2);
});
