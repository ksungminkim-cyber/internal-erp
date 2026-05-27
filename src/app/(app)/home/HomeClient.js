'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  const [data, setData] = useState(null);
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
          temp:  Math.round(r.current.temperature_2m),
          feels: Math.round(r.current.apparent_temperature),
          code:  r.current.weathercode,
          daily: r.daily.time.map((date, i) => ({
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
      setData([]);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => { if (mounted) await fetch_(); })();
    const id = setInterval(() => { if (mounted) fetch_(); }, 30 * 60 * 1000);
    return () => { mounted = false; clearInterval(id); };
  }, [fetch_]);

  if (!data || data.length === 0) return null;

  return (
    <section className="stack stack-2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 className="h3">매장 날씨</h2>
        {updatedAt && <span className="text-muted" style={{ fontSize: 11 }}>{updatedAt} 기준</span>}
      </div>
      <div className="grid-2">
        {SHOPS.map((shop, i) => {
          const w = data[i];
          const [icon, label] = wmo(w.code);
          const rainAlert  = w.daily.some((d) => d.rain >= 60);
          const tempColor  = w.temp >= 30 ? '#dc2626' : w.temp <= 5 ? '#2563eb' : 'var(--text)';
          return (
            <div key={shop.name} className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{shop.name}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{shop.sub}</div>
                </div>
                {rainAlert && <span className="tag tag-warning" style={{ fontSize: 10, padding: '2px 7px', flexShrink: 0 }}>☂ 우산</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: tempColor, fontVariantNumeric: 'tabular-nums' }}>{w.temp}°</span>
                <span style={{ fontSize: 24, lineHeight: 1.2 }}>{icon}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.2 }}>{label}</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11, marginBottom: 10 }}>체감 {w.feels}°</div>
              <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2 }}>
                {w.daily.slice(0, 3).map((d, di) => {
                  const [dIcon] = wmo(d.code);
                  const dayLabel = di === 0 ? '오늘' : di === 1 ? '내일' : '모레';
                  return (
                    <div key={d.date} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{dayLabel}</div>
                      <div style={{ fontSize: 18, lineHeight: 1.3 }}>{dIcon}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{d.maxT}°</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.minT}°</div>
                      {d.rain >= 30 && <div style={{ fontSize: 10, color: '#0891b2', fontWeight: 600 }}>{d.rain}%</div>}
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
export default function HomeClient({
  initialStats,
  initialAnnouncements,
  initialReadIds,
  ssrWorkplaceId,
  userId,
  hqWorkplaceStatuses = null,
}) {
  const { currentWorkplaceId, currentWorkplace, supabase, profile, memberships } = useApp();

  // SSR 데이터로 즉시 초기화 → 스켈레톤 없음
  const [stats, setStats] = useState(initialStats);
  const [recentAnnouncements, setRecentAnnouncements] = useState(initialAnnouncements ?? []);
  const [announcementReadIds, setAnnouncementReadIds] = useState(() => new Set(initialReadIds ?? []));

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    const since    = todayBoundary();
    const today    = todayKey();
    const todayObj = new Date(); todayObj.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayObj); tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      board, inboxSteps, anns, reads, todayLogs, annTotal,
      salesToday, inv, todayShifts, handover,
    ] = await Promise.all([
      supabase.from('attendance_current_status').select('user_id, status').eq('workplace_id', currentWorkplaceId),
      supabase
        .from('approval_steps')
        .select('id, request_id, approval_requests!inner(workplace_id, status, current_step), step_order')
        .eq('approver_id', userId)
        .eq('status', 'waiting'),
      supabase
        .from('announcements')
        .select('id, title, created_at, pinned, author:profiles!announcements_author_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(3),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', userId),
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
        .gte('start_at', todayObj.toISOString())
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
      working:            (board.data ?? []).filter((b) => b.status === 'working' || b.status === 'on_break').length,
      inbox:              inboxValid.length,
      unread:             Math.max(0, (annTotal.count ?? 0) - readIds.size),
      todayCheckins:      new Set((todayLogs.data ?? []).map((l) => l.user_id)).size,
      todaySales:         Number(salesToday.data?.total_amount ?? 0),
      lowStock,
      todayShifts:        todayShifts.count ?? 0,
      handoverUnresolved: handover.count ?? 0,
    });
  }, [supabase, currentWorkplaceId, userId]);

  // workplace가 SSR과 다를 때(사업장 전환)만 재로드
  const initialSkipped = useRef(false);
  useEffect(() => {
    if (!initialSkipped.current) {
      initialSkipped.current = true;
      // SSR workplace와 동일하고 초기 데이터 있으면 재fetch 생략
      if (currentWorkplaceId === ssrWorkplaceId && stats !== null) return;
    }
    load();
  }, [load]); // load는 currentWorkplaceId 변경 시에만 교체됨

  // ── 배정 대기 ────────────────────────────────────────────────────────────
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

  const today       = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const s           = stats ?? { working: 0, inbox: 0, unread: 0, todayCheckins: 0, todaySales: 0, lowStock: 0, todayShifts: 0, handoverUnresolved: 0 };
  const urgentCount = s.lowStock + s.handoverUnresolved + s.inbox;

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
              {s.inbox > 0 && <Link href="/approvals" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>결재 {s.inbox}건</Link>}
              {s.lowStock > 0 && <Link href="/inventory" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>발주 {s.lowStock}품목</Link>}
              {s.handoverUnresolved > 0 && <Link href="/handover" style={{ color: '#c2410c', fontWeight: 700, textDecoration: 'none' }}>인수인계 {s.handoverUnresolved}건</Link>}
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
                {formatCurrency(s.todaySales)}<span style={{ fontSize: 14, opacity: 0.85, marginLeft: 4 }}>원</span>
              </div>
              <div className="bento-sub">{currentWorkplace?.name}</div>
            </div>
          </Link>

          <div className="grid-2">
            <Link href="/attendance" style={{ textDecoration: 'none' }}>
              <div className="bento interactive" style={{ minHeight: 110 }}>
                <div className="bento-label text-secondary"><Users size={14} /> 매장 인원</div>
                <div className="bento-value sm num">
                  {s.working}<span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 4 }}>명</span>
                </div>
                <div className="bento-sub text-muted">오늘 출근 {s.todayCheckins}명</div>
              </div>
            </Link>

            <Link href="/approvals" style={{ textDecoration: 'none' }}>
              <div className={`bento interactive ${s.inbox > 0 ? 'violet' : ''}`} style={{ minHeight: 110 }}>
                {s.inbox > 0 && <div className="bento-decor" />}
                <div className="bento-label" style={{ color: s.inbox > 0 ? undefined : 'var(--text-secondary)' }}>
                  <FileText size={14} /> 결재 대기
                </div>
                <div className="bento-value sm num" style={{ color: s.inbox > 0 ? '#fff' : 'var(--text)' }}>
                  {s.inbox}<span style={{ fontSize: 14, opacity: 0.7, marginLeft: 4 }}>건</span>
                </div>
                <div className="bento-sub" style={{ color: s.inbox > 0 ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}>
                  {s.inbox > 0 ? '확인 필요' : '모두 처리됨'}
                </div>
              </div>
            </Link>
          </div>
        </section>

        {/* 본사: 전 매장 출근 현황 */}
        {hqWorkplaceStatuses && hqWorkplaceStatuses.length > 0 && (
          <section className="stack stack-3">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <h2 className="h3">
                <Users size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: -2, color: 'var(--accent)' }} />
                전 매장 출근 현황
              </h2>
              <span className="tag tag-accent" style={{ fontSize: 10 }}>본사</span>
            </div>
            <div className="grid-2">
              {hqWorkplaceStatuses.map((wp) => (
                <Link key={wp.id} href="/attendance" style={{ textDecoration: 'none' }}>
                  <div className="card interactive">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div className="h4">{wp.name}</div>
                      <span className={`tag ${wp.workingCount > 0 ? 'tag-success' : ''}`} style={{ fontSize: 11 }}>
                        {wp.workingCount > 0 ? `${wp.workingCount}명 근무 중` : '근무자 없음'}
                      </span>
                    </div>
                    {wp.workingNames.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {wp.workingNames.map((name, i) => (
                          <span key={i} className="tag dot" style={{ fontSize: 11 }}>{name}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted" style={{ fontSize: 12 }}>오늘 출근 기록 {wp.totalToday}건</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* 날씨 위젯 */}
        <WeatherWidget />

        {/* 바로가기 */}
        <section className="stack stack-3">
          <h2 className="h3">바로가기</h2>
          <div className="grid-4">
            <QuickAction href="/attendance"    icon={Clock}          label="출퇴근"     desc="지금 기록"                                                             tone="accent"  />
            <QuickAction href="/approvals/new" icon={Plus}           label="지출결의서"  desc="새 기안"                                                              tone="mint"    />
            <QuickAction href="/schedule"      icon={Calendar}        label="시프트"     desc={`오늘 ${s.todayShifts}건`}                                             tone="violet"  />
            <QuickAction href="/checklists"    icon={ClipboardCheck}  label="체크리스트"  desc="오픈/마감"                                                            tone="warm"    />
            <QuickAction href="/inventory"     icon={Package}         label="재고"       desc={s.lowStock > 0 ? `발주 ${s.lowStock}` : '재고 점검'}  tone={s.lowStock > 0 ? 'danger' : 'neutral'} />
            <QuickAction href="/handover"      icon={ClipboardCheck}  label="인수인계"    desc={s.handoverUnresolved > 0 ? `미확인 ${s.handoverUnresolved}` : '교대 메모'} tone="neutral" />
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
  const st = styles[tone] || styles.neutral;
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div className="card compact interactive" style={{ minHeight: 100, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: st.bg, color: st.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
