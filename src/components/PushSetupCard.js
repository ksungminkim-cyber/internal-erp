// src/components/PushSetupCard.js
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BellRing, BellOff, Share, SquarePlus, Smartphone, X, Check } from 'lucide-react';
import { useFeedback } from '@/context/FeedbackContext';
import { pushState, isIOS, urlBase64ToUint8Array } from '@/lib/pushSupport';
import { savePushSubscription, removePushSubscription, sendTestPush } from '@/app/_actions/push';
import { getPushConfig } from '@/lib/reads';

const DISMISS_KEY = 'push:bannerDismissed';

function readEnv() {
  const ua = navigator.userAgent || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const hasSW = 'serviceWorker' in navigator, hasPush = 'PushManager' in window, hasNotification = 'Notification' in window;
  return { ua, maxTouchPoints, standalone, hasSW, hasPush, hasNotification, permission: hasNotification ? Notification.permission : 'default' };
}

async function saveSub(sub) {
  const j = sub.toJSON();
  return savePushSubscription({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, userAgent: navigator.userAgent });
}

// 현재 기기 상태 + 서버 공개키 + 이미 구독돼 있는지. 구독돼 있으면 서버 기록을 지금 로그인한 사람으로 맞춘다
async function detect() {
  const env = readEnv();
  const state = pushState(env);
  const { publicKey } = await getPushConfig().catch(() => ({ publicKey: null }));
  let subscribed = false;
  if (state === 'granted' && publicKey) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (sub) { subscribed = true; saveSub(sub).catch(() => {}); }
    } catch { /* 등록 실패 — 켜기 버튼에서 다시 시도 */ }
  }
  return { state, publicKey, subscribed, ios: isIOS(env), standalone: env.standalone };
}

const WHAT = ['나에게 결재 요청이 왔을 때', '내가 올린 결재가 승인·반려됐을 때', '새 공지사항', '(본사·매니저) 포스 동기화 중단, 주문 끊김, 매출 급감'];

function IosSteps() {
  const step = { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, lineHeight: 1.5 };
  const num = { flexShrink: 0, width: 20, height: 20, borderRadius: 999, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 };
  return (
    <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
      <li style={step}><span style={num}>1</span><span><strong>Safari</strong> 로 counter.mclean21.com 을 엽니다. (카카오톡·네이버 앱 안에서는 안 돼요)</span></li>
      <li style={step}><span style={num}>2</span><span>화면 아래 <strong>공유 버튼</strong> <Share size={14} style={{ display: 'inline', verticalAlign: -2 }} /> 을 누릅니다.</span></li>
      <li style={step}><span style={num}>3</span><span><strong>홈 화면에 추가</strong> <SquarePlus size={14} style={{ display: 'inline', verticalAlign: -2 }} /> 를 고르고 &ldquo;추가&rdquo;를 누릅니다.</span></li>
      <li style={step}><span style={num}>4</span><span>홈 화면에 생긴 <strong>Counter 아이콘</strong>으로 열어 로그인합니다.</span></li>
      <li style={step}><span style={num}>5</span><span>이 화면의 <strong>알림 켜기</strong>를 누르고 &ldquo;허용&rdquo;을 고릅니다.</span></li>
    </ol>
  );
}

/**
 * 웹 푸시 설정 — 이 기기에서 알림 켜기/끄기 + 아이폰 홈 화면 추가 안내.
 * variant 'settings': 내 정보 화면 (항상 표시, 받는 알림 목록 포함)
 * variant 'banner'  : 홈 상단 안내 (아직 안 켠 사람에게만, 닫으면 다시 안 뜸)
 */
export default function PushSetupCard({ variant = 'settings' }) {
  const { toast } = useFeedback();
  const [info, setInfo] = useState(null); // { state, publicKey, subscribed, ios, standalone }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    let alive = true;
    detect().then((r) => { if (alive) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      // 권한 요청은 사용자가 누른 직후 바로 (아이폰은 다른 작업 뒤에 부르면 창이 안 뜸)
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setInfo((s) => ({ ...s, state: perm === 'denied' ? 'denied' : 'default' })); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(info.publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); }
        catch { // 예전 키로 만든 구독이 남아 있으면 지우고 다시
          const old = await reg.pushManager.getSubscription(); if (old) await old.unsubscribe();
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        }
      }
      const res = await saveSub(sub);
      if (res?.error) throw new Error(res.error);
      setInfo((s) => ({ ...s, state: 'granted', subscribed: true }));
      toast('이 기기에서 알림을 켰어요', 'success');
    } catch (e) {
      setMsg(`알림을 켜지 못했어요. ${String(e?.message || e)}`);
    } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await removePushSubscription({ endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setInfo((s) => ({ ...s, subscribed: false }));
      toast('이 기기 알림을 껐어요', 'info');
    } catch (e) { setMsg(String(e?.message || e)); } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try {
      const res = await sendTestPush();
      if (res?.error) setMsg(res.error); else toast('테스트 알림을 보냈어요. 잠시 후 도착합니다', 'success');
    } catch (e) { setMsg(String(e?.message || e)); } finally { setBusy(false); }
  }

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* 무시 */ }
  }

  if (!info || !info.publicKey) return null; // 확인 중이거나 서버에 푸시 키가 아직 없음
  const { state, subscribed, ios } = info;
  const on = state === 'granted' && subscribed;
  const banner = variant === 'banner';
  if (banner && (on || dismissed || state === 'unsupported')) return null;

  const canEnable = state === 'default' || (state === 'granted' && !subscribed);

  return (
    <section id={banner ? undefined : 'push'} className="card" style={{ position: 'relative', ...(banner ? { borderLeft: '3px solid var(--accent)', background: 'linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 70%)' } : {}) }}>
      {banner && (
        <button type="button" onClick={dismiss} aria-label="안내 닫기" className="btn btn-ghost btn-icon" style={{ position: 'absolute', top: 6, right: 6, minHeight: 28, padding: 4 }}><X size={15} /></button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: banner ? 28 : 0 }}>
        {on ? <BellRing size={17} color="var(--accent-strong)" /> : <Smartphone size={17} color="var(--accent-strong)" />}
        <h2 className="h3">{banner ? '결재·공지 알림을 휴대폰으로 받아 보세요' : '휴대폰·PC 알림'}</h2>
        {on && <span className="tag tag-success" style={{ fontSize: 10 }}><Check size={10} /> 켜짐</span>}
      </div>
      <p className="text-secondary" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6 }}>
        Counter 를 닫아 놔도 결재 요청·결재 결과·새 공지가 {ios ? '아이폰 잠금화면으로' : '이 기기로'} 바로 옵니다. 알림을 누르면 해당 화면이 열려요.
        {banner && <> 기기마다 한 번만 켜면 됩니다.</>}
      </p>

      {!banner && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }} className="text-secondary">
          {WHAT.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {state === 'ios-install' && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--surface-soft)' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>아이폰은 홈 화면에 추가한 Counter 에서만 알림이 와요</div>
          <IosSteps />
          <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>iOS 16.4 이상이 필요합니다. (설정 → 일반 → 정보에서 확인)</div>
        </div>
      )}
      {state === 'in-app-browser' && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--warning-soft)', fontSize: 13, lineHeight: 1.55 }}>
          카카오톡·네이버 같은 앱 안의 화면에서는 알림을 켤 수 없어요. 메뉴(⋮ 또는 공유)에서 <strong>{ios ? 'Safari로 열기' : '다른 브라우저로 열기'}</strong>를 누른 뒤 다시 시도해 주세요.
        </div>
      )}
      {state === 'denied' && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--warning-soft)', fontSize: 13, lineHeight: 1.55 }}>
          <BellOff size={14} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
          이 기기에서 Counter 알림이 차단돼 있어요. {ios
            ? <>아이폰 <strong>설정 → 알림 → Counter</strong> 에서 &ldquo;알림 허용&rdquo;을 켜 주세요.</>
            : <>주소창 왼쪽 <strong>자물쇠(사이트 설정) → 알림 → 허용</strong>으로 바꾼 뒤 새로고침해 주세요.</>}
        </div>
      )}
      {state === 'unsupported' && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--surface-soft)', fontSize: 13, lineHeight: 1.55 }}>
          이 브라우저는 푸시 알림을 지원하지 않아요. {ios ? 'iOS 를 16.4 이상으로 업데이트해 주세요.' : '크롬·엣지·사파리 최신 버전에서 열어 주세요.'}
        </div>
      )}

      {msg && <div style={{ marginTop: 10, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {canEnable && (
          <button type="button" className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
            <BellRing size={14} /> {busy ? '켜는 중...' : '이 기기에서 알림 켜기'}
          </button>
        )}
        {on && !banner && (
          <>
            <button type="button" className="btn btn-soft btn-sm" onClick={test} disabled={busy}>테스트 알림 보내기</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={disable} disabled={busy}>이 기기 알림 끄기</button>
          </>
        )}
        {banner && <Link href="/me#push" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>자세히</Link>}
      </div>
      {!banner && (
        <div className="text-muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          알림은 기기마다 따로 켭니다 (휴대폰과 PC 를 둘 다 쓰면 각각). PC 는 크롬·엣지에서 켜 두면 Counter 탭을 보고 있지 않아도 화면 구석에 알림이 뜹니다.
        </div>
      )}
    </section>
  );
}
