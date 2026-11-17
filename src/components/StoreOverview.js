'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Users, FileText, Package, ChevronRight } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { formatCurrency } from '@/lib/format';
import { todayKey, ymd } from '@/lib/date';
import { getOrderSuggestions } from '@/lib/reads';
import { splitWorkplaces } from '@/lib/hqView';
import { buildStoreOverview } from '@/lib/storeOverview';

// 전체(본사) 홈 — 매장별 오늘 매출·근무 인원·진행 중 결재·발주 권장을 나란히 보여준다.
// 포스 매출은 10분마다 sales_daily 에 들어오고, 들어올 때마다 이 화면도 다시 불러온다.
// 숫자를 누르면 그 매장으로 바꿔서 해당 화면으로 간다.
export default function StoreOverview() {
  const { supabase, memberships, switchWorkplace } = useApp();
  const stores = useMemo(
    () => splitWorkplaces(memberships).stores.map((m) => ({ id: m.workplace_id, name: m.workplaces?.name })),
    [memberships]
  );
  const [view, setView] = useState(null); // { overview, at }

  const load = useCallback(async () => {
    if (!stores.length) return;
    const ids = stores.map((s) => s.id);
    const today = todayKey();
    const yesterday = ymd(new Date(Date.now() - 86400_000));
    const [sales, boards, pending, usual, orders] = await Promise.all([
      supabase.from('sales_daily').select('workplace_id, sales_date, total_amount, transaction_count')
        .in('workplace_id', ids).in('sales_date', [today, yesterday]),
      supabase.from('attendance_current_status').select('workplace_id, user_id, status, name').in('workplace_id', ids),
      supabase.from('approval_requests').select('workplace_id').in('workplace_id', ids).eq('status', 'pending'),
      Promise.all(ids.map((id) => supabase.rpc('sales_vs_usual', { p_workplace_id: id }))),
      // 발주 권장은 실패해도 나머지는 보여준다
      Promise.all(ids.map((id) => getOrderSuggestions({ workplaceId: id }).catch(() => null))),
    ]);
    const pct = (r) => (r.data?.[0]?.pct == null ? null : Number(r.data[0].pct));
    setView({
      overview: buildStoreOverview({
        stores, today, yesterday,
        sales: sales.data ?? [],
        boards: boards.data ?? [],
        pending: pending.data ?? [],
        vsUsual: Object.fromEntries(ids.map((id, i) => [id, pct(usual[i])])),
        orderCounts: Object.fromEntries(ids.map((id, i) => [id, orders[i]?.suggestions?.length ?? 0])),
      }),
      at: new Date(),
    });
  }, [supabase, stores]);

  useEffect(() => { load(); }, [load]);

  // 포스 동기화가 매출을 쓸 때마다 다시 불러온다
  useEffect(() => {
    const ch = supabase
      .channel('hq-overview-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_daily' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, load]);

  if (!stores.length) return null;

  const o = view?.overview;
  const at = view?.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

  return (
    <section className="stack stack-3">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 className="h3">매장별 현황</h2>
        {o && (
          <span className="text-secondary" style={{ fontSize: 13, fontWeight: 600 }}>
            오늘 합계 <strong className="num" style={{ color: 'var(--text)' }}>{formatCurrency(o.totalSales)}원</strong> · 거래 {o.totalCount}건
          </span>
        )}
        {at && <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{at} 기준 · 포스 매출은 10분마다 들어옵니다</span>}
      </div>

      {!o ? (
        <div className="grid-2">
          {stores.map((s) => <div key={s.id} className="skeleton" style={{ height: 250, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : (
        <div className="grid-2 store-overview">
          {o.stores.map((s) => {
            const go = () => switchWorkplace(s.id);
            return (
              <div key={s.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <Link href="/sales" onClick={go} className="store-overview-hero">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span className="h4">{s.name}</span>
                    <span className="text-muted" style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <TrendingUp size={13} /> 오늘 매출
                    </span>
                  </div>
                  <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', marginTop: 10, lineHeight: 1 }}>
                    {formatCurrency(s.todaySales)}<span style={{ fontSize: 14, fontWeight: 700, marginLeft: 3 }}>원</span>
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                    거래 {s.todayCount}건 · 어제 {formatCurrency(s.yesterdaySales)}원
                    {s.vsUsualPct != null && (
                      <strong className="num" style={{ marginLeft: 4, color: s.vsUsualPct < 0 ? '#c2410c' : '#00876c' }}>
                        · 평소 대비 {s.vsUsualPct > 0 ? '+' : ''}{s.vsUsualPct}%
                      </strong>
                    )}
                  </div>
                </Link>
                <Row href="/attendance" onClick={go} icon={Users} label="근무 중"
                  value={s.working.length ? `${s.working.length}명` : '없음'} sub={s.working.join(' · ')} />
                <Row href="/approvals" onClick={go} icon={FileText} label="진행 중 결재"
                  value={`${s.pendingApprovals}건`} strong={s.pendingApprovals > 0} />
                <Row href="/inventory" onClick={go} icon={Package} label="발주 권장"
                  value={s.orderCount ? `${s.orderCount}품목` : '없음'} strong={s.orderCount > 0} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Row({ href, onClick, icon: Icon, label, value, sub, strong }) {
  return (
    <Link href={href} onClick={onClick} className="store-overview-row">
      <Icon size={15} className="text-muted" style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</span>
      {sub && <span className="text-muted" style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      <span className="num" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: strong ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap' }}>{value}</span>
      <ChevronRight size={15} className="text-faint" style={{ flexShrink: 0 }} />
    </Link>
  );
}
