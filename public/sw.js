// Counter 서비스 워커 — 웹 푸시 전용 (페이지 캐시는 하지 않는다).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 서버(/api/push/send)가 보낸 { title, body, url, tag } 를 알림으로 표시
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Counter', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/home' },
  }));
});

// 알림을 누르면 열려 있는 Counter 창을 그 화면으로 보내고, 없으면 새로 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/home', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (!('focus' in c)) continue;
      await c.focus();
      if ('navigate' in c) { try { await c.navigate(url); } catch { /* 다른 출처면 무시 */ } }
      return;
    }
    await self.clients.openWindow(url);
  })());
});
