// src/lib/pushSupport.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushState, buildPushPayload, urlBase64ToUint8Array } from './pushSupport.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const KAKAO = IPHONE + ' KAKAOTALK 11.2.0';
const full = { hasSW: true, hasPush: true, hasNotification: true };

test('pushState: 아이폰은 홈 화면에 추가해서 열어야 푸시 가능', () => {
  assert.equal(pushState({ ua: IPHONE, standalone: false, ...full, permission: 'default' }), 'ios-install');
  assert.equal(pushState({ ua: IPHONE, standalone: true, ...full, permission: 'default' }), 'default');
  assert.equal(pushState({ ua: IPHONE, standalone: true, ...full, permission: 'granted' }), 'granted');
  // 홈 화면 앱인데도 푸시 API 가 없으면(iOS 16.4 미만) 지원 안 함
  assert.equal(pushState({ ua: IPHONE, standalone: true, hasSW: true, hasPush: false, hasNotification: false, permission: 'default' }), 'unsupported');
});

test('pushState: 아이패드(맥 UA + 터치)도 아이폰과 같은 규칙', () => {
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
  assert.equal(pushState({ ua: IPAD, maxTouchPoints: 5, standalone: false, ...full, permission: 'default' }), 'ios-install');
  assert.equal(pushState({ ua: IPAD, maxTouchPoints: 0, standalone: false, ...full, permission: 'default' }), 'default'); // 진짜 맥
});

test('pushState: 카카오톡·네이버 등 앱 안 브라우저는 푸시 불가 → 기본 브라우저로 열라고 안내', () => {
  assert.equal(pushState({ ua: KAKAO, standalone: false, ...full, permission: 'default' }), 'in-app-browser');
  assert.equal(pushState({ ua: ANDROID + ' NAVER(inapp; search; 2000; 12.9.1)', standalone: false, ...full, permission: 'default' }), 'in-app-browser');
});

test('pushState: 안드로이드·PC 는 허용 상태 그대로', () => {
  assert.equal(pushState({ ua: ANDROID, standalone: false, ...full, permission: 'default' }), 'default');
  assert.equal(pushState({ ua: ANDROID, standalone: false, ...full, permission: 'denied' }), 'denied');
  assert.equal(pushState({ ua: ANDROID, standalone: false, hasSW: false, hasPush: false, hasNotification: true, permission: 'default' }), 'unsupported');
});

test('buildPushPayload: 알림 행 → 푸시 내용 (링크 없으면 홈, 긴 본문은 자름)', () => {
  assert.deepEqual(
    buildPushPayload({ id: 'n1', title: '결재 요청', body: '11월 2주차 식자재 발주', link: '/approvals/abc' }),
    { title: '결재 요청', body: '11월 2주차 식자재 발주', url: '/approvals/abc', tag: 'n1' },
  );
  const p = buildPushPayload({ id: 'n2', title: '', body: 'x'.repeat(300), link: null });
  assert.equal(p.title, 'Counter');
  assert.equal(p.url, '/home');
  assert.equal(p.body.length, 141); // 140자 + …
  // 외부 주소는 열지 않는다
  assert.equal(buildPushPayload({ id: 'n3', title: 'a', body: 'b', link: 'https://evil.example/x' }).url, '/home');
});

test('urlBase64ToUint8Array: VAPID 공개키(base64url) → 바이트', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);
});
