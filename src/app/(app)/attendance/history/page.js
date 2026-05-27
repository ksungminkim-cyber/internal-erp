'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import { formatTime } from '@/lib/format';
import { downloadCsv, fmtDateTime } from '@/lib/csvExport';
import { ChevronLeft, Download, Calendar, Users } from 'lucide-react';

const EVENT_LABEL = {
  clock_in: '출근',
  clock_out: '퇴근',
  break_start: '휴게',
  break_end: '복귀',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AttendanceHistoryPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, currentWorkplace, supabase, isManager } = useApp();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayStr());
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userFilter, setUserFilter] = useState('all'); // 'all' | 'mine'

  const load = useCallback(async () => {
    if (!currentWorkplaceId || !user) return;
    setLoading(true);
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    let q = supabase
      .from('attendance_logs')
      .select('id, user_id, event_type, event_at, note, profiles:profiles!attendance_logs_user_id_fkey(name)')
      .eq('workplace_id', currentWorkplaceId)
      .gte('event_at', start.toISOString())
      .lte('event_at', end.toISOString())
      .order('event_at', { ascending: false })
      .limit(2000);

    if (userFilter === 'mine') q = q.eq('user_id', user.id);

    const { data } = await q;
    setLogs(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId, user, from, to, userFilter]);

  useEffect(() => { load(); }, [load]);

  function exportCsv() {
    if (!logs.length) return;
    const ym = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
    const wpName = currentWorkplace?.name?.replace(/\s+/g, '_') || 'workplace';
    downloadCsv(
      `attendance_${wpName}_${ym}.csv`,
      [
        { key: 'event_at', label: '일시', format: (v) => fmtDateTime(v) },
        { key: 'name', label: '직원' },
        { key: 'event_type', label: '구분', format: (v) => EVENT_LABEL[v] || v },
        { key: 'note', label: '메모' },
      ],
      logs.map((r) => ({ ...r, name: r.profiles?.name ?? '' }))
    );
  }

  // 날짜별 그룹핑
  const groupedByDate = logs.reduce((acc, log) => {
    const date = log.event_at.slice(0, 10);
    if (!acc[date]) acc[date] = [];
    acc[date].push(log);
    return acc;
  }, {});
  const dates = Object.keys(groupedByDate).sort().reverse();

  return (
    <>
      <PageHeader
        title="근태 기록"
        subtitle={`${currentWorkplace?.name ?? ''} · 과거 출퇴근 조회`}
        action={
          <Link href="/attendance" className="btn btn-ghost btn-icon">
            <ChevronLeft size={20} />
          </Link>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 필터 카드 */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={16} color="var(--accent)" />
            <h2 className="h4">기간 선택</h2>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
            />
            <span className="text-muted">~</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 10px', fontSize: 13 }}
            />
          </div>

          <div className="segment" style={{ alignSelf: 'flex-start' }}>
            <button
              className={`segment-item ${userFilter === 'all' ? 'is-active' : ''}`}
              onClick={() => setUserFilter('all')}
            >
              <Users size={12} /> 전체
            </button>
            <button
              className={`segment-item ${userFilter === 'mine' ? 'is-active' : ''}`}
              onClick={() => setUserFilter('mine')}
            >
              내 기록만
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              총 <strong style={{ color: 'var(--text)' }}>{logs.length}</strong>건
            </span>
            <button onClick={exportCsv} className="btn btn-primary btn-sm" disabled={!logs.length}>
              <Download size={14} /> CSV 다운로드
            </button>
          </div>
        </section>

        {/* 결과 */}
        {logs.length === 0 ? (
          <div className="card empty">
            <div className="empty-desc">{loading ? '조회 중...' : '해당 기간에 기록이 없어요'}</div>
          </div>
        ) : (
          <div className="stack stack-3">
            {dates.map((date) => {
              const dateLogs = groupedByDate[date];
              const d = new Date(date);
              const dateLabel = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
              return (
                <section key={date}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <h3 className="h4">{dateLabel}</h3>
                    <span className="text-muted" style={{ fontSize: 12 }}>{dateLogs.length}건</span>
                  </div>
                  <div className="card" style={{ padding: 8 }}>
                    {dateLogs.map((l, i) => (
                      <div key={l.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10 }}>
                          <span className="num" style={{ fontSize: 14, fontWeight: 800, width: 54 }}>{formatTime(l.event_at)}</span>
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{l.profiles?.name || '—'}</span>
                          <span className="tag" style={{ fontSize: 11 }}>{EVENT_LABEL[l.event_type] || l.event_type}</span>
                        </div>
                        {i < dateLogs.length - 1 && <hr className="divider" style={{ margin: '0 10px' }} />}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
