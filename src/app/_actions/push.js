'use server';

import { getServiceClient, getActor } from '@/lib/server/guard';
import { sendPush } from '@/lib/server/push';

/** 푸시 구독에 쓸 공개키. 키가 아직 설정되지 않았으면 null (설정 카드가 숨겨짐) */
export async function getPushConfig() {
  const user = await getActor();
  if (!user) return { publicKey: null };
  return { publicKey: process.env.VAPID_PUBLIC_KEY || null };
}

/** 이 기기의 푸시 구독 저장 (같은 기기에서 다른 사람이 로그인하면 그 사람 것으로 옮겨진다) */
export async function savePushSubscription({ endpoint, p256dh, auth, userAgent }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) return { ok: false, error: '구독 정보가 올바르지 않습니다.' };
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth || p256dh.length > 300 || auth.length > 100) return { ok: false, error: '구독 정보가 올바르지 않습니다.' };
  const svc = getServiceClient();
  const { error } = await svc.from('push_subscriptions').upsert({
    user_id: user.id, endpoint, p256dh, auth,
    user_agent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null,
  }, { onConflict: 'endpoint' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removePushSubscription({ endpoint }) {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const { error } = await svc.from('push_subscriptions').delete().eq('endpoint', String(endpoint ?? '')).eq('user_id', user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 내 기기들로 테스트 알림 한 번 */
export async function sendTestPush() {
  const user = await getActor();
  if (!user) return { ok: false, error: '로그인이 필요합니다.' };
  const svc = getServiceClient();
  const r = await sendPush(svc, [{ id: `test-${Date.now()}`, user_id: user.id, title: 'Counter 알림 테스트', body: '이 기기에서 결재·공지 알림을 받을 수 있어요.', link: '/me' }]);
  if (r.reason) return { ok: false, error: r.reason };
  if (r.sent === 0) return { ok: false, error: r.removed ? '구독이 만료돼 있었어요. 알림을 다시 켜 주세요.' : '보낼 기기가 없거나 전송에 실패했어요.' };
  return { ok: true, sent: r.sent };
}
