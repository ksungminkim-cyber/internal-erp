'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatRelative, formatCurrency, todayBoundary } from '@/lib/format';
import {
  Clock, FileText, Megaphone, Users, ChevronRight, Plus, Sparkles,
  Calendar, ClipboardCheck, Package, TrendingUp, AlertTriangle,
} from 'lucide-react';

function todayKey() { return new Date().toISOString().slice(0, 10); }

// ─── 날씨 ──────────────────────────────────────────────────────────────────
const SHOPS = [
  { name: '나울', sub: '경기 김포', lat: 37.6143, lon: 126.7044 },
  { name: '녹턴', sub: '서울 합정', lat: 37.5497, lon: 126.9137 },
];

// WMO 날씨 코드 → [이모지, 한국어]
function wmo(code) {
  const MAP = {
    0: ['☀️', '맑음'],   1: ['🌤', '맑음'],    2: ['⛅', '구름조금'], 3: ['☁️', '흐림'],
    45: ['🌫', '안개'],  48: ['🌫', '짙은안개'],
    51: ['🌦', '이슬비'], 53: ['🌦', '이슬비'],  55: ['🌦', '이슬비'],
    61: ['🌧', '비'],    63: ['🌧', '비'],      65: ['🌧', '강한비'],
    71: ['❄️', '눈'],   73: ['❄️', '눈'],      75: ['❄️', '강한눈'],  77: ['🌨', '눈'],
    80: ['🌦', '소나기'], 81: ['🌦', '소나기'],  82: ['⛈', '강소나기'],
    85: ['🌨', '눈소나기'], 86: ['🌨', '눈소나기'],
    95: ['⛈', '천둥번개'], 96: ['⛈', '우박'],   99: ['⛈', '우박'],
  };
  return MAP[code] ?? ['🌡', '—'];
}

function WeatherWidget() {
  const [data, setData] = useState(null); // null = 로딩, [] = 실패
  const [updatedAt, setUpdatedAt] = useState(null);

  const fetch_ = useCallback(async () => {
    try {
      const results = await Promise.all(
        SHOPS.map(({ lat, lon }) =>
          fetch(
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lon}` +
            `&current=temperature_2m,apparent_temperature,weathercode` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
            `&timezone=Asia%2FSeoul&forecast_days=3`
          ).then((r) => r.json())
        )
      );
      setData(
        results.map((r) => ({
          temp:   Math.round(r.current.temperature_2m),
          feels:  Math.round(r.current.apparent_temperature),
          code:   r.current.weathercode,
          daily:  r.daily.time.map((date, i) => ({
            date,
            code: r.daily.weathercode[i],
            rain: r.daily.precipitation_probability_max[i] ?? 0,
            maxT: Math.round(r.daily.temperature_2m_max[i]),
            minT: Math.round(r.daily.temperature_2m_min[i]),
          })),
        }))
      );
      setUpdatedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    } catch {
      setData([]); // 실패 시 빈 배열 — 컴포넌트 자체를 숨김
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => { if (mounted) await fetch_(); })();
    // 30분마다 갱신
    const id = setInterval(() => { if (mounted) fetch_(); }, 30 * 60 * 1000);
    return () => { mounted = false; clearInterval(id); };
  }, [fetch_]);

  // 로딩 중 → 미표시 (화면 깜빡임 없이 등장)
  if (!data || data.length === 0) return null;

  return (
    <section className="stack stack-2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 className="h3">매장 날씨</h2>
        {updatedAt && (
          <span className="text-muted" style={{ fontSize: 11 }}>{updatedAt} 기준</span>
        )}
      </div>

      <div className="grid-2">
        {SHOPS.map((shop, i) => {
          const w = data[i];
          const [icon, label] = wmo(w.code);
          // 오늘~모레 일별 최대 강수 확률 60% 이상이면 우산 경보
          const rainAlert = w.daily.some((d) => d.rain >= 60);
          // 기온에 따른 색감
          const tempColor = w.temp >= 30 ? '#dc2626' : w.temp <= 5 ? '#2563eb' : 'var(--text)';

          return (
            <div
              key={shop.name}
              className="card"
              style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}
            >
              {/* 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{shop.name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{shop.sub}</div>
                </div>
                {rainAlert && (
                  <span
                    className="tag tag-warning"
                    style={{ fontSize: 10, padding: '2px 7px', flexShrink: 0 }}
                  >
                    ☂ 우산
                  </span>
                )}
              </div>

              {/* 현재 기온 */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: tempColor, fontVariantNumeric: 'tabular-nums' }}>
                  {w.temp}°
                </span>
                <span style={{ fontSize: 24, lineHeight: 1.2 }}>{icon}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.2 }}>{label}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginBottom: 10 }}>
                체감 {w.feels}°
              </div>

              {/* 3일 미니 예보 */}
              <div
                style={{
                  display: 'flex', gap: 0,
                  borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2,
                }}
              >
                {w.daily.slice(0, 3).map((d, di) => {
                  const [dIcon] = wmo(d.code);
                  const dayLabel = di === 0 ? '오늘' : di === 1 ? '내일' : '모레';
                  return (
                    <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{dayLabel}</div>
                      <div style={{ fontSize: 18, lineHeight: 1.3 }}>{dIcon}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.maxT}°</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.minT}°</div>
                      {d.rain >= 30 && (
                        <div style={{ fontSize: 10, color: '#0891b2', fontWeight: 600 }}>{d.rain}%</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── 메인 ──────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { user, profile, currentWorkplaceId, currentWorkplace, supabase, memberships } = useApp();
  const [stats, setStats] = useState({
    working: 0, inbox: 0, unread: 0, todayCheckins: 0,
    todaySales: 0, lowStock: 0, todayShifts: 0, handoverUnresolved: 0,
  });
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);
  const [announcementReadIds, setAnnouncementReadIds] = useState(new Set());

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    const since = todayBoundary();
    const today = todayKey();
    const tomorrow = new Date(); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);

    const [
      board, inboxSteps, anns, reads, todayLogs, annTotal,
      salesToday, inv, todayShifts, handover,
    ] = await Promise.all([
      supabase.from('attendance_current_status').select('user_id, status').eq('workplace_id', currentWorkplaceId),
      supabase
        .from('approval_steps')
        .select('id, request_id, approval_requests!inner(workplace_id, status, current_step), step_order')
        .eq('approver_id', user.id)
        .eq('status', 'waiting'),
      supabase
        .from('announcements')
        .select('id, title, created_at, pinned, author:profiles!announcements_author_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(3),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
      supabase
        .from('attendance_logs')
        .select('user_id')
        .eq('workplace_id', currentWorkplaceId)
        .eq('event_type', 'clock_in')
        .gte('event_at', since),
      supabase.from('announcements').select('*', { count: 'exact', head: true }).eq('workplace_id', currentWorkplaceId),
      supabase
        .from('sales_daily')
        .select('total_amount, transaction_count')
        .eq('workplace_id', currentWorkplaceId)
        .eq('sales_date', today)
        .maybeSingle(),
      supabase
        .from('inventory_items')
        .select('id, current_qty, min_qty')
        .eq('workplace_id', currentWorkplaceId)
        .eq('archived', false),
      supabase
        .from('shifts')
        .select('id, user_id', { count: 'exact' })
        .eq('workplace_id', currentWorkplaceId)
        .gte('start_at', todayDate.toISOString())
        .lt('start_at', tomorrow.toISOString()),
      supabase
        .from('handover_notes')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId)
        .eq('resolved', false),
    ]);

    const inboxValid = (inboxSteps.data ?? []).filter(
      (s) =>
        s.approval_requests?.workplace_id === currentWorkplaceId &&
        s.approval_requests?.status === 'pending' &&
        s.approval_requests?.current_step === s.step_order
    );
    const readIds  = new Set((reads.data ?? []).map((r) => r.announcement_id));
    const lowStock = (inv.data ?? []).filter((i) => Number(i.current_qty) < Number(i.min_qty)).length;

    setRecentAnnouncements(anns.data ?? []);
    setAnnouncementReadIds(readIds);
    setStats({
      working:           (board.data ?? []).filter((b) => b.status === 'working' || b.status === 'on_break').length,
      inbox:             inboxValid.length,
      unread:            Math.max(0, (annTotal.count ?? 0) - readIds.size),
      todayCheckins:     new Set((todayLogs.data ?? []).map((l) => l.user_id)).size,
      todaySales:        Number(salesToday.data?.total_amount ?? 0),
      lowStock,
      todayShifts:       todayShifts.count ?? 0,
      handoverUnresolved: handover.count ?? 0,
    });
  }, [supabase, currentWorkplaceId, user]);

  useEffect(() => { load(); }, [load]);

  if (!memberships?.length) {
    return (
      <>
        <PageHeader title={`안녕하세요, ${profile?.name ?? '직원'}님`} />
        <main className="section">
          <div className="card">
            <div className="empty">
              <div className="empty-icon"><Sparkles size={28} /></div>
              <div className="empty-title">사업장 배정 대기 중</div>
              <div className="empty-desc">관리자가 사업장을 배정하면 사용할 수 있어요.</div>
            </div>
          </div>
        </main>
      </>
    );
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6)  return '깊은 밤이에요';
    if (h < 12) return '좋은 아침이에요';
    if (h < 14) return '점심 잘 챙기세요';
    if (h < 18) return '오후 화이팅이에요';
    if (h < 22) return '저녁 수고하세요';
    return '오늘도 수고하셨어요';
  })();

  const today        = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const urgentCount  = stats.lowStock + stats.handoverUnresolved + stats.inbox;

  return (
    <>
      <PageHeader title={`${greeting},`} subtitle={`${profile?.name ?? ''}님 · ${today}`} large />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 안 읽은 공지 */}
        {recentAnnouncements.filter((a) => !announcementReadIds.has(a.id)).length > 0 && (
          <section className="stack stack-3">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h2 className="h3">
                <Megaphone size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: -2, color: 'var(--accent)' }} />
                안 읽은 공지
              </h2>
              <span className="tag tag-danger">{recentAnnouncements.filter((a) => !announcementReadIds.has(a.id)).length}건</span>
              <Link href="/announcements" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                전체 보기 →
              </Link>
            </div>
            <div className="stack stack-2">
              {recentAnnouncements.filter((a) => !announcementReadIds.has(a.id)).slice(0, 3).map((a) => (
                <Link key={a.id} href="/announcements" style={{ textDecoration: 'none' }}>
                  <div
                    className="card interactive"
                    style={{
                      borderLeft: '3px solid var(--accent)',
                      background: a.pinned
                        ? 'linear-gradient(180deg, var(--accent-soft) 0%, var(--surface) 60%)'
                        : 'var(--surface)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="h4" style={{ fontSize: 15, color: 'var(--text)' }}>
                          {a.pinned && '📌 '}{a.title}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                          {a.author?.name || '—'} · {formatRelative(a.created_at)}
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-faint" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 긴급 알림 */}
        {urgentCount > 0 && (
          <section
            className="card"
            style={{
              borderLeft: '3px solid var(--warning)',
              background: 'var(--warning-soft)',
              boxShadow: 'none',
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <AlertTriangle size={18} color="#c2410c" />
            <div style={{ flex: 1, fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {stats.inbox > 0 && <Link href="/approvals" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>결재 {stats.inbox}건</Link>}
              {stats.lowStock > 0 && <Link href="/inventory" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>발주 {stats.lowStock}품목</Link>}
              {stats.handoverUnresolved > 0 && <Link href="/handover" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>인수인계 {stats.handoverUnresolved}건</Link>}
            </div>
          </section>
        )}

        {/* Hero — 매출 + 인원/결재 */}
        <section className="stack stack-3 stagger">
          <Link href="/sales" style={{ textDecoration: 'none' }}>
            <div className="bento accent interactive" style={{ minHeight: 130 }}>
              <div className="bento-decor" />
              <div className="bento-label"><TrendingUp size={14} /> 오늘 매출</div>
              <div className="bento-value num">
                {formatCurrency(stats.todaySales)}<span style={{ fontSize: 14, opacity: 0.85, marginLeft: 4 }}>원</span>
              </div>
              <div className="bento-sub">{currentWorkplace?.name}</div>
            </div>
          </Link>

          <div className="grid-2">
            <Link href="/attendance" style={{ textDecoration: 'none' }}>
              <div className="bento interactive" style={{ minHeight: 110 }}>
                <div className="bento-label text-secondary"><Users size={14} /> 매장 인원</div>
                <div className="bento-value sm num">
                  {stats.working}<span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 4 }}>명</span>
                </div>
                <div className="bento-sub text-muted">오늘 출근 {stats.todayCheckins}명</div>
              </div>
            </Link>

            <Link href="/approvals" style={{ textDecoration: 'none' }}>
              <div className={`bento interactive ${stats.inbox > 0 ? 'violet' : ''}`} style={{ minHeight: 110 }}>
                {stats.inbox > 0 && <div className="bento-decor" />}
                <div className="bento-label" style={{ color: stats.inbox > 0 ? undefined : 'var(--text-secondary)' }}>
                  <FileText size={14} /> 결재 대기
                </div>
                <div className="bento-value sm num" style={{ color: stats.inbox > 0 ? '#fff' : 'var(--text)' }}>
                  {stats.inbox}<span style={{ fontSize: 14, opacity: 0.7, marginLeft: 4 }}>건</span>
                </div>
                <div className="bento-sub" style={{ color: stats.inbox > 0 ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}>
                  {stats.inbox > 0 ? '확인 필요' : '모두 처리됨'}
                </div>
              </div>
            </Link>
          </div>
        </section>

        {/* 날씨 위젯 */}
        <WeatherWidget />

        {/* 바로가기 */}
        <section className="stack stack-3">
          <h2 className="h3">바로가기</h2>
          <div className="grid-4">
            <QuickAction href="/attendance"  icon={Clock}          label="출퇴근"     desc="지금 기록"                                              tone="accent"   />
            <QuickAction href="/approvals/new" icon={Plus}         label="지출결의서"  desc="새 기안"                                               tone="mint"    />
            <QuickAction href="/schedule"    icon={Calendar}        label="시프트"     desc={`오늘 ${stats.todayShifts}건`}                          tone="violet"  />
            <QuickAction href="/checklists"  icon={ClipboardCheck}  label="체크리스트"  desc="오픈/마감"                                             tone="warm"    />
            <QuickAction href="/inventory"   icon={Package}         label="재고"       desc={stats.lowStock > 0 ? `발주 ${stats.lowStock}` : '재고 점검'} tone={stats.lowStock > 0 ? 'danger' : 'neutral'} />
            <QuickAction href="/handover"    icon={ClipboardCheck}  label="인수인계"    desc={stats.handoverUnresolved > 0 ? `미확인 ${stats.handoverUnresolved}` : '교대 메모'} tone="neutral" />
          </div>
        </section>

        {/* 최근 공지 (안 읽은 공지가 없을 때만) */}
        {recentAnnouncements.filter((a) => !announcementReadIds.has(a.id)).length === 0 && (
          <section className="stack stack-3">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="h3">최근 공지</h2>
              <Link href="/announcements" style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none' }}>
                전체 보기 →
              </Link>
            </div>
            {recentAnnouncements.length === 0 ? (
              <div className="card">
                <div className="empty" style={{ padding: '32px 16px' }}>
                  <div className="empty-icon" style={{ width: 48, height: 48 }}><Megaphone size={20} /></div>
                  <div className="empty-desc">아직 공지가 없어요</div>
                </div>
              </div>
            ) : (
              <div className="stack stack-2">
                {recentAnnouncements.map((a) => (
                  <Link key={a.id} href="/announcements" style={{ textDecoration: 'none' }}>
                    <div className="card compact interactive" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: a.pinned ? 'var(--accent-soft)' : 'var(--surface-soft)',
                        color: a.pinned ? 'var(--accent)' : 'var(--text-muted)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Megaphone size={18} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="h4" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                          {a.pinned && '📌 '}{a.title}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {a.author?.name || '—'} · {formatRelative(a.created_at)}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-faint" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}

function QuickAction({ href, icon: Icon, label, desc, tone }) {
  const styles = {
    accent:  { bg: 'var(--accent-soft)', color: 'var(--accent)' },
    mint:    { bg: '#cffafe', color: '#0e7490' },
    violet:  { bg: '#f3e8ff', color: '#6d28d9' },
    warm:    { bg: '#fff1e0', color: '#c2410c' },
    danger:  { bg: 'var(--danger-soft)', color: 'var(--danger)' },
    neutral: { bg: 'var(--surface-soft)', color: 'var(--text-secondary)' },
  };
  const s = styles[tone] || styles.neutral;
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div className="card compact interactive" style={{ minHeight: 100, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: s.bg, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={18} />
        </div>
        <div>
          <div className="h4" style={{ color: 'var(--text)' }}>{label}</div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div>
        </div>
      </div>
    </Link>
  );
}
