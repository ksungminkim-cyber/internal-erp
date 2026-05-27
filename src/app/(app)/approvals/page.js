'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatRelative, formatCurrency } from '@/lib/format';
import { downloadCsv, fmtDate } from '@/lib/csvExport';
import { Plus, CheckCircle2, XCircle, Clock, Inbox, Download } from 'lucide-react';

const STATUS_META = {
  pending:   { label: '진행중', tag: 'tag-warning' },
  approved:  { label: '승인',   tag: 'tag-success' },
  rejected:  { label: '반려',   tag: 'tag-danger'  },
  cancelled: { label: '취소',   tag: 'tag'         },
};

const TABS = [
  { key: 'inbox', label: '결재함' },
  { key: 'mine', label: '내 기안' },
  { key: 'all', label: '전체' },
];

export default function ApprovalsListPage() {
  const { user, currentWorkplaceId, supabase } = useApp();
  const [tab, setTab] = useState('inbox');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    setLoading(true);

    let query = supabase
      .from('approval_requests')
      .select(`
        id, title, status, total_amount, current_step, submitted_at, drafter_id, doc_type,
        drafter:profiles!approval_requests_drafter_id_fkey(name),
        approval_steps(id, step_order, approver_id, status)
      `)
      .eq('workplace_id', currentWorkplaceId)
      .order('submitted_at', { ascending: false })
      .limit(200);

    if (tab === 'mine') query = query.eq('drafter_id', user.id);
    if (dateFrom) query = query.gte('submitted_at', dateFrom);
    if (dateTo) {
      // 종료일은 그날 끝까지 포함
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      query = query.lte('submitted_at', endDate.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      console.error(error);
      setItems([]);
    } else {
      let list = data ?? [];
      if (tab === 'inbox') {
        list = list.filter(
          (r) =>
            r.status === 'pending' &&
            r.approval_steps?.some(
              (s) => s.step_order === r.current_step && s.approver_id === user.id && s.status === 'waiting'
            )
        );
      }
      setItems(list);
    }
    setLoading(false);
  }, [supabase, currentWorkplaceId, user, tab, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const channel = supabase
      .channel(`approvals:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_steps' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, currentWorkplaceId, load]);

  function exportCsv() {
    downloadCsv(
      `approvals_${tab}.csv`,
      [
        { key: 'submitted_at', label: '기안일', format: (v) => fmtDate(v) },
        { key: 'drafter_name', label: '기안자' },
        { key: 'title', label: '제목' },
        { key: 'total_amount', label: '금액' },
        { key: 'status', label: '상태', format: (v) => STATUS_META[v]?.label || v },
        { key: 'current_step', label: '진행단계' },
        { key: 'step_total', label: '전체단계' },
      ],
      items.map((r) => ({
        ...r,
        drafter_name: r.drafter?.name ?? '',
        step_total: r.approval_steps?.length ?? 0,
      }))
    );
  }

  return (
    <>
      <PageHeader title="전자결재" subtitle="지출결의서 · 시프트 · KPI 등 사내 결재" />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div className="segment">
            {TABS.map((t) => (
              <button
                key={t.key}
                className={`segment-item ${tab === t.key ? 'is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!items.length}>
            <Download size={14} /> CSV
          </button>
        </div>

        {/* 날짜 범위 필터 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <span className="text-muted" style={{ fontWeight: 600 }}>기간</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input"
            style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
          />
          <span className="text-muted">~</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input"
            style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => { setDateFrom(''); setDateTo(''); }}
            >
              초기화
            </button>
          )}
        </div>

        {loading ? (
          <div className="stack stack-3">
            <div className="skeleton" style={{ height: 100 }} />
            <div className="skeleton" style={{ height: 100 }} />
          </div>
        ) : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon"><Inbox size={26} /></div>
              <div className="empty-title">
                {tab === 'inbox' ? '결재 대기 없음' : tab === 'mine' ? '기안한 문서 없음' : '문서 없음'}
              </div>
              <div className="empty-desc">
                {tab === 'mine' ? '+ 버튼으로 새 기안을 작성해보세요' : '여기에 표시될 문서가 없어요'}
              </div>
            </div>
          </div>
        ) : (
          <div className="stack stack-3 stagger">
            {items.map((r) => {
              const meta = STATUS_META[r.status];
              const stepText = r.status === 'pending'
                ? `${r.current_step}/${r.approval_steps?.length ?? 0} 단계`
                : null;
              return (
                <Link key={r.id} href={`/approvals/${r.id}`} style={{ textDecoration: 'none' }}>
                  <div className="card compact interactive">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Avatar name={r.drafter?.name} userId={r.drafter_id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="h4" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                          {r.title}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {r.drafter?.name || '—'} · {formatRelative(r.submitted_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                        {stepText && (
                          <div className="text-muted" style={{ fontSize: 10, marginTop: 4, fontWeight: 600 }}>
                            {stepText}
                          </div>
                        )}
                      </div>
                    </div>
                    {r.total_amount != null && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="text-muted" style={{ fontSize: 12, fontWeight: 600 }}>합계</span>
                        <span className="num" style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent)' }}>
                          {formatCurrency(r.total_amount)}<span style={{ fontSize: 12, marginLeft: 2, color: 'var(--text-muted)' }}>원</span>
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      {/* FAB — 새 기안 */}
      <Link href="/approvals/new" className="fab" style={{ textDecoration: 'none' }} aria-label="새 기안">
        <Plus size={26} />
      </Link>
    </>
  );
}
