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

export default function HomePage() {
  const { user, profile, currentWorkplaceId, currentWorkplace, supabase, memberships } = useApp();
  const [stats, setStats] = useState({
    working: 0, inbox: 0, unread: 0, todayCheckins: 0,
    todaySales: 0, lowStock: 0, todayShifts: 0, handoverUnresolved: 0,
  });
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);

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
    const readIds = new Set((reads.data ?? []).map((r) => r.announcement_id));
    const lowStock = (inv.data ?? []).filter((i) => Number(i.current_qty) < Number(i.min_qty)).length;

    setRecentAnnouncements(anns.data ?? []);
    setStats({
      working: (board.data ?? []).filter((b) => b.status === 'working' || b.status === 'on_break').length,
      inbox: inboxValid.length,
      unread: Math.max(0, (annTotal.count ?? 0) - readIds.size),
      todayCheckins: new Set((todayLogs.data ?? []).map((l) => l.user_id)).size,
      todaySales: Number(salesToday.data?.total_amount ?? 0),
      lowStock,
      todayShifts: todayShifts.count ?? 0,
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
    if (h < 6) return '깊은 밤이에요';
    if (h < 12) return '좋은 아침이에요';
    if (h < 14) return '점심 잘 챙기세요';
    if (h < 18) return '오후 화이팅이에요';
    if (h < 22) return '저녁 수고하세요';
    return '오늘도 수고하셨어요';
  })();

  const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  const urgentCount = stats.lowStock + stats.handoverUnresolved + stats.inbox;

  return (
    <>
      <PageHeader title={`${greeting},`} subtitle={`${profile?.name ?? ''}님 · ${today}`} large />

      <main className="fade-in" style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 긴급 알림 */}
        {urgentCount > 0 && (
          <section className="bento warm pop-in" style={{ minHeight: 90 }}>
            <div className="bento-decor" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertTriangle size={26} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>확인이 필요해요</div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.92, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {stats.inbox > 0 && <Link href="/approvals" style={{ color: '#fff', textDecoration: 'underline' }}>결재 {stats.inbox}건</Link>}
                  {stats.lowStock > 0 && <Link href="/inventory" style={{ color: '#fff', textDecoration: 'underline' }}>발주 {stats.lowStock}품목</Link>}
                  {stats.handoverUnresolved > 0 && <Link href="/handover" style={{ color: '#fff', textDecoration: 'underline' }}>인수인계 {stats.handoverUnresolved}건</Link>}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Hero stats */}
        <section className="stack stack-3 stagger">
          <Link href="/sales" style={{ textDecoration: 'none' }}>
            <div className="bento accent interactive" style={{ minHeight: 130 }}>
              <div className="bento-decor" />
              <div className="bento-label">
                <TrendingUp size={14} /> 오늘 매출
              </div>
              <div className="bento-value num">
                {formatCurrency(stats.todaySales)}<span style={{ fontSize: 14, opacity: 0.85, marginLeft: 4 }}>원</span>
              </div>
              <div className="bento-sub">{currentWorkplace?.name}</div>
            </div>
          </Link>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Link href="/attendance" style={{ textDecoration: 'none' }}>
              <div className="bento interactive" style={{ minHeight: 110 }}>
                <div className="bento-label text-secondary">
                  <Users size={14} /> 매장 인원
                </div>
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

        {/* 빠른 액션 */}
        <section className="stack stack-3">
          <h2 className="h3">바로가기</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <QuickAction href="/attendance" icon={Clock} label="출퇴근" desc="지금 기록" tone="accent" />
            <QuickAction href="/approvals/new" icon={Plus} label="지출결의서" desc="새 기안" tone="mint" />
            <QuickAction href="/schedule" icon={Calendar} label="시프트" desc={`오늘 ${stats.todayShifts}건`} tone="violet" />
            <QuickAction href="/checklists" icon={ClipboardCheck} label="체크리스트" desc="오픈/마감" tone="warm" />
            <QuickAction href="/inventory" icon={Package} label="재고" desc={stats.lowStock > 0 ? `발주 ${stats.lowStock}` : '재고 점검'} tone={stats.lowStock > 0 ? 'danger' : 'neutral'} />
            <QuickAction href="/handover" icon={ClipboardCheck} label="인수인계" desc={stats.handoverUnresolved > 0 ? `미확인 ${stats.handoverUnresolved}` : '교대 메모'} tone="neutral" />
          </div>
        </section>

        {/* 최근 공지 */}
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
        <div
          style={{
            width: 38, height: 38, borderRadius: 12,
            background: s.bg, color: s.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
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
