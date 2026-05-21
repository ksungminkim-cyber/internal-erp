'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import {
  Calendar, ClipboardCheck, ListTodo, Package, TrendingUp, Megaphone,
  AlertCircle, Sparkles, Wrench, BookOpen, MessageCircle, BarChart3, UserCog, Lock,
} from 'lucide-react';

export default function OperationsMenu() {
  const { currentWorkplaceId, supabase, user, profile, memberships } = useApp();
  const isAdmin = profile?.is_super_admin === true || memberships.some((m) => m.role === 'owner');
  const [stats, setStats] = useState({
    todayShifts: 0,
    handoverUnresolved: 0,
    lowStock: 0,
    unreadAnn: 0,
    equipmentIssue: 0,
    complaintOpen: 0,
  });

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const [shiftCount, handoverCount, invList, annTotal, reads, equipList, cmpCount] = await Promise.all([
      supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId)
        .gte('start_at', today.toISOString())
        .lt('start_at', tomorrow.toISOString()),
      supabase
        .from('handover_notes')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId)
        .eq('resolved', false),
      supabase
        .from('inventory_items')
        .select('id, current_qty, min_qty')
        .eq('workplace_id', currentWorkplaceId)
        .eq('archived', false),
      supabase
        .from('announcements')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId),
      supabase.from('announcement_reads').select('announcement_id').eq('user_id', user.id),
      supabase
        .from('equipment')
        .select('id, status, next_check_at')
        .eq('workplace_id', currentWorkplaceId)
        .eq('archived', false),
      supabase
        .from('customer_complaints')
        .select('id', { count: 'exact', head: true })
        .eq('workplace_id', currentWorkplaceId)
        .neq('status', 'resolved'),
    ]);

    const lowStock = (invList.data ?? []).filter((i) => Number(i.current_qty) < Number(i.min_qty)).length;
    const unread = Math.max(0, (annTotal.count ?? 0) - (reads.data?.length ?? 0));
    const equipIssue = (equipList.data ?? []).filter((e) => {
      if (e.status === 'warning' || e.status === 'broken') return true;
      if (!e.next_check_at) return false;
      const days = Math.ceil((new Date(e.next_check_at).getTime() - today.getTime()) / 86400000);
      return days <= 7;
    }).length;

    setStats({
      todayShifts: shiftCount.count ?? 0,
      handoverUnresolved: handoverCount.count ?? 0,
      lowStock,
      unreadAnn: unread,
      equipmentIssue: equipIssue,
      complaintOpen: cmpCount.count ?? 0,
    });
  }, [supabase, currentWorkplaceId, user]);

  useEffect(() => { load(); }, [load]);

  const urgentItems = [
    stats.lowStock > 0 && { href: '/inventory', label: `발주 ${stats.lowStock}품목` },
    stats.handoverUnresolved > 0 && { href: '/handover', label: `인수인계 ${stats.handoverUnresolved}건` },
    stats.equipmentIssue > 0 && { href: '/equipment', label: `장비 ${stats.equipmentIssue}대` },
    stats.complaintOpen > 0 && { href: '/complaints', label: `클레임 ${stats.complaintOpen}건` },
  ].filter(Boolean);

  return (
    <>
      <PageHeader title="운영" subtitle="매장 운영의 모든 기능" />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {urgentItems.length > 0 && (
          <Link href={urgentItems[0].href} style={{ textDecoration: 'none' }}>
            <div className="bento warm" style={{ minHeight: 90, padding: 18 }}>
              <div className="bento-decor" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <AlertCircle size={28} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, opacity: 0.9, fontWeight: 700 }}>확인이 필요해요</div>
                  <div style={{ fontSize: 12, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {urgentItems.map((it, i) => (
                      <span key={i}>{it.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Link>
        )}

        <section className="stack stack-3">
          <h2 className="h3">매장 운영</h2>
          <div className="grid-4">
            <OpsCard href="/schedule"    icon={Calendar}        label="시프트"     desc="근무 일정"
              accent="violet" badge={stats.todayShifts > 0 ? `오늘 ${stats.todayShifts}` : null} />
            <OpsCard href="/handover"    icon={ClipboardCheck}  label="인수인계"   desc="교대 메모"
              accent="mint" badge={stats.handoverUnresolved > 0 ? `${stats.handoverUnresolved}건` : null} urgent={stats.handoverUnresolved > 0} />
            <OpsCard href="/checklists"  icon={ListTodo}        label="체크리스트" desc="오픈·마감 루틴"   accent="accent" />
            <OpsCard href="/inventory"   icon={Package}         label="재고·발주"  desc="식자재·비품"
              accent="warm" badge={stats.lowStock > 0 ? `${stats.lowStock} 부족` : null} urgent={stats.lowStock > 0} />
          </div>
        </section>

        <section className="stack stack-3">
          <h2 className="h3">품질 · 서비스</h2>
          <div className="grid-4">
            <OpsCard href="/equipment"  icon={Wrench}        label="장비 점검"   desc="머신·기기 관리"
              accent="violet" badge={stats.equipmentIssue > 0 ? `${stats.equipmentIssue}` : null} urgent={stats.equipmentIssue > 0} />
            <OpsCard href="/recipes"    icon={BookOpen}      label="레시피"      desc="두 매장 공통"      accent="mint" />
            <OpsCard href="/complaints" icon={MessageCircle} label="고객 클레임" desc="불만·요청 기록"
              accent="warm" badge={stats.complaintOpen > 0 ? `${stats.complaintOpen}` : null} urgent={stats.complaintOpen > 0} />
          </div>
        </section>

        <section className="stack stack-3">
          <h2 className="h3">매출 · 인사이트</h2>
          <div className="grid-4">
            <OpsCard href="/sales"          icon={TrendingUp} label="매출"       desc="일별 매출"    accent="success" />
            <OpsCard href="/reports"        icon={BarChart3}  label="월별 리포트" desc="통합 대시보드" accent="accent" />
            <OpsCard href="/announcements"  icon={Megaphone}  label="공지사항"   desc="전직원 공지"
              accent="neutral" badge={stats.unreadAnn > 0 ? `${stats.unreadAnn} 신규` : null} urgent={stats.unreadAnn > 0} />
          </div>
        </section>

        {isAdmin && (
          <section className="stack stack-3">
            <h2 className="h3">관리</h2>
            <div className="grid-4">
              <OpsCard href="/closing" icon={Lock} label="월 마감" desc="손익·인건비·지출" accent="accent" />
              <OpsCard href="/members" icon={UserCog} label="직원 관리" desc="가입·배정·시급" accent="neutral" />
            </div>
          </section>
        )}

        <section style={{ paddingTop: 8 }}>
          <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Sparkles size={18} color="var(--accent)" />
              <div style={{ flex: 1 }}>
                <div className="h4" style={{ marginBottom: 4 }}>알아두면 좋아요</div>
                <ul style={{ listStyle: 'none', padding: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  <li>• 시프트는 매니저가 짜고 직원이 확인합니다</li>
                  <li>• 인수인계 노트는 다음 근무자가 꼭 읽도록 해주세요</li>
                  <li>• 체크리스트는 매일 한 번씩 진행도가 초기화됩니다</li>
                  <li>• 레시피는 두 매장 모두에서 공유됩니다 (전사 콘텐츠)</li>
                  <li>• 장비는 정기 점검일을 7일 전부터 알림으로 표시</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function OpsCard({ href, icon: Icon, label, desc, accent = 'accent', badge, urgent }) {
  const tones = {
    accent:  { bg: 'var(--accent-soft)',  color: 'var(--accent)' },
    violet:  { bg: '#f3e8ff',             color: '#6d28d9' },
    mint:    { bg: '#cffafe',             color: '#0e7490' },
    warm:    { bg: '#fff1e0',             color: '#c2410c' },
    success: { bg: 'var(--success-soft)', color: '#00876c' },
    neutral: { bg: 'var(--surface-soft)', color: 'var(--text-secondary)' },
  };
  const t = tones[accent] ?? tones.accent;
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div className="card compact interactive" style={{ minHeight: 130, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
        <div
          style={{
            width: 42, height: 42, borderRadius: 14,
            background: t.bg, color: t.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon size={20} />
        </div>
        <div>
          <div className="h4" style={{ color: 'var(--text)' }}>{label}</div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{desc}</div>
        </div>
        {badge && (
          <span
            className="tag"
            style={{
              position: 'absolute', top: 14, right: 14,
              background: urgent ? 'var(--danger)' : 'var(--accent)',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
}
