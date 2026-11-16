// src/lib/pushSupport.js
// 웹 푸시 — 기기 상태 판정·푸시 내용 구성 순수 로직 (클라이언트·서버 공용).

const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i;

export function isIOS({ ua = '', maxTouchPoints = 0 } = {}) {
  // iPadOS 13+ 는 맥 UA 를 쓰므로 터치 지원으로 구분
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/**
 * 이 기기에서 푸시를 켤 수 있는 상태.
 *  'in-app-browser' 카카오톡·네이버 등 앱 안 브라우저 (푸시 불가 → 기본 브라우저로 열기)
 *  'ios-install'    아이폰·아이패드인데 홈 화면 앱으로 연 게 아님 (홈 화면에 추가 필요)
 *  'unsupported'    브라우저에 푸시 API 없음 (구형 iOS 등)
 *  'default' | 'granted' | 'denied'  알림 권한 상태
 */
export function pushState({ ua = '', maxTouchPoints = 0, standalone = false, hasSW = false, hasPush = false, hasNotification = false, permission = 'default' }) {
  if (IN_APP.test(ua)) return 'in-app-browser';
  if (isIOS({ ua, maxTouchPoints }) && !standalone) return 'ios-install';
  if (!hasSW || !hasPush || !hasNotification) return 'unsupported';
  return permission === 'granted' || permission === 'denied' ? permission : 'default';
}

/** notifications 행 → 푸시 payload. 링크는 사이트 안 경로만 허용 */
export function buildPushPayload(n) {
  const body = String(n?.body ?? '');
  const link = String(n?.link ?? '');
  return {
    title: String(n?.title ?? '').trim() || 'Counter',
    body: body.length > 140 ? `${body.slice(0, 140)}…` : body,
    url: link.startsWith('/') && !link.startsWith('//') ? link : '/home',
    tag: String(n?.id ?? ''),
  };
}

/** VAPID 공개키(base64url) → pushManager.subscribe 의 applicationServerKey */
export function urlBase64ToUint8Array(base64) {
  const s = String(base64).replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  const raw = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
