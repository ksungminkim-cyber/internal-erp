// src/lib/server/push.js
// 웹 푸시 발송 (서버 전용). 환경변수 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys).
import { sendNotification } from 'web-push';
import { buildPushPayload } from '@/lib/pushSupport';

const SUBJECT = 'https://counter.mclean21.com';

// 발송 서명 정보. 키가 없으면 null (푸시 기능 꺼짐)
function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  return publicKey && privateKey ? { subject: SUBJECT, publicKey, privateKey } : null;
}

/**
 * notifications 행들을 각 사용자의 구독 기기로 보낸다. 만료된 구독(404/410)은 지운다.
 * @param svc 서비스롤 클라이언트
 * @param {{ id, user_id, title, body, link }[]} notifications
 * @returns {{ sent: number, failed: number, removed: number, reason?: string }}
 */
export async function sendPush(svc, notifications) {
  const vapidDetails = vapid();
  if (!vapidDetails) return { sent: 0, failed: 0, removed: 0, reason: 'VAPID 키 없음' };
  const userIds = [...new Set((notifications ?? []).map((n) => n.user_id).filter(Boolean))];
  if (!userIds.length) return { sent: 0, failed: 0, removed: 0 };
  const { data: subs, error } = await svc.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);
  if (error) return { sent: 0, failed: 0, removed: 0, reason: error.message };
  const byUser = new Map();
  for (const s of subs ?? []) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }

  let sent = 0, failed = 0;
  const dead = new Set(), ok = new Set();
  await Promise.all(notifications.flatMap((n) => (byUser.get(n.user_id) ?? []).map(async (s) => {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(buildPushPayload(n)), { vapidDetails, TTL: 86400, urgency: 'high' });
      sent += 1; ok.add(s.id);
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.add(s.id); else failed += 1;
    }
  })));
  if (dead.size) await svc.from('push_subscriptions').delete().in('id', [...dead]);
  if (ok.size) await svc.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).in('id', [...ok]);
  return { sent, failed, removed: dead.size };
}
