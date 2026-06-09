'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatRelative, formatCurrency } from '@/lib/format';
import { downloadCsv, fmtDate } from '@/lib/csvExport';
import { getApprovals } from './actions';
import { Plus, Inbox, Download, Search, X, Building2 } from 'lucide-react';

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

const STATUS_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'pending', label: '진행중' },
  { key: 'overdue', label: '지연' },
  { key: 'approved', label: '승인' },
  { key: 'rejected', label: '반려' },
  { key: 'cancelled', label: '취소' },
];

function daysSince(iso) {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const DOC_TYPES = [
  { key: 'all', label: '전체 종류' },
  { key: 'expense', label: '지출결의' },
  { key: 'schedule', label: '시프트' },
  { key: 'kpi', label: 'KPI' },
  { key: 'closing', label: '월마감' },
];

const DOC_TYPE_LABEL = { expense: '지출', schedule: '시프트', kpi: 'KPI', closing: '월마감' };

export default function ApprovalsClient({ initialItems, ssrWorkplaceId, userId }) {
  const { user, profile, memberships, currentWorkplaceId, supabase } = useApp();
  const [tab, setTab] = useState('inbox');
  const [statusFilter, setStatusFilter] = useState('all');
  const [docType, setDocType] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(''); // 디바운스된 검색어
  const [allWp, setAllWp] = useState(false); // 전 매장 통합 뷰
  const [items, setItems] = useState(initialItems ?? []);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const uid = user?.id ?? userId;
  // 본사/대표/super_admin만 전 매장 통합 조회 가능
  const canAllWp = profile?.is_super_admin === true || profile?.is_executive === true
    || (memberships ?? []).some((m) => m.workplaces?.name === '본사');

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !uid) return;
    setLoading(true);
    try {
      const { items: list, summary: sum } = await getApprovals({
        workplaceId: currentWorkplaceId,
        scope: tab,
        status: statusFilter,
        docType,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        search: search || undefined,
        allWorkplaces: allWp && canAllWp,
      });
      setItems(list ?? []);
      setSummary(sum ?? null);
    } catch {
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [currentWorkplaceId, uid, tab, statusFilter, docType, dateFrom, dateTo, search, allWp, canAllWp]);

  // 초기 SSR 데이터는 inbox·무필터 → 조건 동일하면 첫 호출 생략
  const initialSkipped = useRef(false);
  useEffect(() => {
    if (!initialSkipped.current) {
      initialSkipped.current = true;
      if (tab === 'inbox' && statusFilter === 'all' && docType === 'all' && !dateFrom && !dateTo && !search && !allWp && currentWorkplaceId === ssrWorkplaceId) return;
    }
    load();
  }, [load, tab, statusFilter, docType, dateFrom, dateTo, search, allWp, currentWorkplaceId, ssrWorkplaceId]);

  // 검색어 디바운스 (350ms) — 키 입력마다 서버 호출 방지
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Realtime — 결재/단계 변경 시 목록 자동 갱신
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
      `approvals_${tab}_${statusFilter}.csv`,
      [
        { key: 'submitted_at', label: '기안일', format: (v) => fmtDate(v) },
        { key: 'workplace_name', label: '매장' },
        { key: 'drafter_name', label: '기안자' },
        { key: 'doc_type', label: '종류', format: (v) => DOC_TYPE_LABEL[v] || v },
        { key: 'title', label: '제목' },
        { key: 'total_amount', label: '금액' },
        { key: 'status', label: '상태', format: (v) => STATUS_META[v]?.label || v },
        { key: 'current_step', label: '진행단계' },
        { key: 'step_total', label: '전체단계' },
      ],
      items.map((r) => ({
        ...r,
        workplace_name: r.workplace?.name ?? '',
        drafter_name: r.drafter?.name ?? '',
        step_total: r.approval_steps?.length ?? 0,
      }))
    );
  }

  const hasFilter = statusFilter !== 'all' || docType !== 'all' || dateFrom || dateTo || searchInput;

  return (
    <>
      <PageHeader title="전자결재" subtitle="지출결의서 · 시프트 · KPI 등 사내 결재" />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {canAllWp && (
              <button
                type="button"
                onClick={() => setAllWp((v) => !v)}
                className={`btn btn-sm ${allWp ? 'btn-primary' : 'btn-soft'}`}
                title="모든 매장의 결재를 한 화면에서 봅니다"
              >
                <Building2 size={14} /> 전 매장
              </button>
            )}
            <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!items.length}>
              <Download size={14} /> CSV
            </button>
          </div>
        </div>

        {/* 상태 필터 칩 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => {
            const cnt = s.key === 'overdue' ? summary?.overdue : summary?.byStatus?.[s.key];
            const isOverdue = s.key === 'overdue';
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                className={`tag ${statusFilter === s.key ? (isOverdue ? 'tag-danger' : 'tag-accent') : ''}`}
                style={{ cursor: 'pointer', fontWeight: statusFilter === s.key ? 700 : 500, color: isOverdue && statusFilter !== s.key && cnt > 0 ? 'var(--danger)' : undefined }}
              >
                {s.label}
                {summary && s.key !== 'all' && cnt > 0 && (
                  <span style={{ marginLeft: 4, opacity: 0.75 }}>{cnt}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 검색 + 종류 + 기간 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="제목 검색"
              className="input"
              style={{ width: '100%', padding: '8px 10px 8px 30px', fontSize: 13 }}
            />
          </div>
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)} style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}>
            {DOC_TYPES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input" style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }} />
          <span className="text-muted">~</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input" style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }} />
          {hasFilter && (
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setStatusFilter('all'); setDocType('all'); setDateFrom(''); setDateTo(''); setSearchInput(''); setSearch(''); }}>
              <X size={12} /> 초기화
            </button>
          )}
        </div>

        {/* 요약 바 */}
        {summary && summary.count > 0 && (
          <div className="card compact" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline', padding: '12px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>총 {summary.count}건</span>
            <span className="text-muted" style={{ fontSize: 12 }}>
              승인 <strong style={{ color: 'var(--success)' }}>{summary.byStatus.approved}</strong> ·
              진행 <strong style={{ color: 'var(--warning)' }}>{summary.byStatus.pending}</strong> ·
              반려 <strong style={{ color: 'var(--danger)' }}>{summary.byStatus.rejected}</strong> ·
              취소 {summary.byStatus.cancelled}
            </span>
            {summary.overdue > 0 && (
              <span className="tag tag-danger" style={{ fontSize: 11 }}>지연 {summary.overdue}건</span>
            )}
            {summary.approvedAmount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 12 }} className="text-muted">
                승인 합계 <strong className="num" style={{ color: 'var(--accent)', fontSize: 14 }}>{formatCurrency(summary.approvedAmount)}</strong>원
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="skeleton" style={{ height: 180 }} />
        ) : items.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon"><Inbox size={26} /></div>
              <div className="empty-title">
                {tab === 'inbox' ? '결재 대기 없음' : hasFilter ? '조건에 맞는 문서 없음' : tab === 'mine' ? '기안한 문서 없음' : '문서 없음'}
              </div>
              <div className="empty-desc">
                {tab === 'mine' ? '+ 버튼으로 새 기안을 작성해보세요' : hasFilter ? '필터를 바꾸거나 초기화해보세요' : '여기에 표시될 문서가 없어요'}
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
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {allWp && r.workplace?.name && <span className="tag tag-accent" style={{ fontSize: 10 }}>{r.workplace.name}</span>}
                          {r.doc_type && r.doc_type !== 'expense' && <span className="tag" style={{ fontSize: 10 }}>{DOC_TYPE_LABEL[r.doc_type] || r.doc_type}</span>}
                          {r.drafter?.name || '—'} · {formatRelative(r.submitted_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span className={`tag ${meta.tag}`}>{meta.label}</span>
                        {r.overdue && (
                          <div style={{ marginTop: 4 }}>
                            <span className="tag tag-danger" style={{ fontSize: 10 }}>지연 {daysSince(r.submitted_at)}일</span>
                          </div>
                        )}
                        {stepText && !r.overdue && (
                          <div className="text-muted" style={{ fontSize: 10, marginTop: 4, fontWeight: 600 }}>
                            {stepText}
                          </div>
                        )}
                      </div>
                    </div>
                    {r.total_amount != null && r.total_amount > 0 && (
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
