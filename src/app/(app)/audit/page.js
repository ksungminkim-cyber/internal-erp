'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatDateTime } from '@/lib/format';
import { ChevronLeft, Shield, FileSearch } from 'lucide-react';

const ENTITY_LABEL = {
  profiles: '직원',
  memberships: '배정',
  approval_requests: '결재',
  month_closings: '월마감',
};

const ACTION_META = {
  insert: { label: '생성', color: 'var(--success)', tag: 'tag-success' },
  update: { label: '수정', color: 'var(--accent)',  tag: 'tag-accent'  },
  delete: { label: '삭제', color: 'var(--danger)',  tag: 'tag-danger'  },
};

export default function AuditLogPage() {
  const router = useRouter();
  const { user, profile, memberships, supabase } = useApp();
  const [logs, setLogs] = useState([]);
  const [filterEntity, setFilterEntity] = useState('all');

  const isOwner = memberships.some((m) => m.role === 'owner');
  const isAdmin = profile?.is_super_admin === true || isOwner;

  const load = useCallback(async () => {
    let q = supabase
      .from('audit_logs')
      .select('*, user:profiles!audit_logs_user_id_fkey(name)')
      .order('created_at', { ascending: false })
      .limit(300);
    if (filterEntity !== 'all') q = q.eq('entity', filterEntity);
    const { data } = await q;
    setLogs(data ?? []);
  }, [supabase, filterEntity]);

  useEffect(() => {
    if (!isAdmin) return;
    load();
  }, [load, isAdmin]);

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="감사 로그" hideSwitcher />
        <main className="page-main">
          <div className="card empty">
            <div className="empty-icon"><Shield size={26} /></div>
            <div className="empty-title">접근 권한 없음</div>
            <div className="empty-desc">대표 또는 본사 직원만 이용 가능</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="감사 로그"
        subtitle="민감 데이터 변경 이력"
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button className={`tag ${filterEntity === 'all' ? 'tag-accent' : ''}`} onClick={() => setFilterEntity('all')}>전체</button>
          {Object.entries(ENTITY_LABEL).map(([k, label]) => (
            <button key={k} className={`tag ${filterEntity === k ? 'tag-accent' : ''}`} onClick={() => setFilterEntity(k)}>
              {label}
            </button>
          ))}
        </div>

        {logs.length === 0 ? (
          <div className="card empty">
            <div className="empty-icon"><FileSearch size={26} /></div>
            <div className="empty-desc">로그 없음</div>
          </div>
        ) : (
          <div className="stack stack-2">
            {logs.map((l) => {
              const m = ACTION_META[l.action] || ACTION_META.update;
              const entityLabel = ENTITY_LABEL[l.entity] || l.entity;
              return (
                <details key={l.id} className="card compact" style={{ padding: 12 }}>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={`tag ${m.tag}`} style={{ fontSize: 10, flexShrink: 0 }}>{m.label}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {entityLabel} <span className="text-muted" style={{ fontWeight: 500 }}>· {l.user?.name || l.user_email || '시스템'}</span>
                        </div>
                        <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {formatDateTime(l.created_at)}
                        </div>
                      </div>
                    </div>
                  </summary>
                  {l.changes && (
                    <pre style={{
                      marginTop: 10, padding: 10,
                      background: 'var(--surface-soft)',
                      borderRadius: 8,
                      fontSize: 11, overflowX: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {JSON.stringify(l.changes, null, 2)}
                    </pre>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
