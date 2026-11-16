// src/lib/welcome.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomePlan, dismissRecord } from './welcome.js';

const base = { today: '2026-11-16', dismissed: null, unreadAnnIds: [], dueChecklistCount: 0, onboarding: false };

test('welcomePlan: 오늘 처음이면 미완 체크리스트·안 읽은 공지를 보여준다', () => {
  assert.deepEqual(welcomePlan({ ...base, dueChecklistCount: 2 }), { open: true, annIds: [], showChecklists: true });
  assert.deepEqual(welcomePlan({ ...base, unreadAnnIds: ['a'] }), { open: true, annIds: ['a'], showChecklists: false });
  assert.deepEqual(welcomePlan(base), { open: false, annIds: [], showChecklists: false });
});

test('welcomePlan: 오늘 한 번 닫았으면 체크리스트 때문에 다시 뜨지 않는다 (들어올 때마다 뜨던 문제)', () => {
  const dismissed = { d: '2026-11-16', anns: ['a'] };
  assert.deepEqual(welcomePlan({ ...base, dismissed, dueChecklistCount: 2, unreadAnnIds: ['a'] }), { open: false, annIds: [], showChecklists: false });
});

test('welcomePlan: 닫은 뒤에 새로 올라온 공지는 그 공지만 다시 알린다', () => {
  const dismissed = { d: '2026-11-16', anns: ['a'] };
  assert.deepEqual(welcomePlan({ ...base, dismissed, dueChecklistCount: 2, unreadAnnIds: ['a', 'b'] }), { open: true, annIds: ['b'], showChecklists: false });
});

test('welcomePlan: 어제 닫은 기록은 오늘 무효', () => {
  const dismissed = { d: '2026-11-15', anns: ['a'] };
  assert.deepEqual(welcomePlan({ ...base, dismissed, dueChecklistCount: 1, unreadAnnIds: ['a'] }), { open: true, annIds: ['a'], showChecklists: true });
});

test('welcomePlan: 첫 로그인(온보딩)은 닫은 기록과 무관하게 뜬다', () => {
  const dismissed = { d: '2026-11-16', anns: [] };
  assert.equal(welcomePlan({ ...base, dismissed, onboarding: true }).open, true);
});

test('dismissRecord: 오늘 날짜와 그때까지 본 공지 id (이전 기록과 합침, 깨진 기록은 무시)', () => {
  assert.deepEqual(dismissRecord({ today: '2026-11-16', dismissed: { d: '2026-11-16', anns: ['a'] }, unreadAnnIds: ['b'] }), { d: '2026-11-16', anns: ['a', 'b'] });
  assert.deepEqual(dismissRecord({ today: '2026-11-16', dismissed: { d: '2026-11-15', anns: ['x'] }, unreadAnnIds: ['b'] }), { d: '2026-11-16', anns: ['b'] });
  assert.deepEqual(dismissRecord({ today: '2026-11-16', dismissed: 'garbage', unreadAnnIds: [] }), { d: '2026-11-16', anns: [] });
});
