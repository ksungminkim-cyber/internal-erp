'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { formatTime, formatRelative, todayBoundary } from '@/lib/format';
import { LogIn, LogOut, Coffee, Play, Sparkles, Users } from 'lucide-react';

const EVENT_LABEL = {
  clock_in: '출근',
  clock_out: '퇴근',
  break_start: '휴게',
  break_end: '복귀',
};

const STATUS_META = {
  working:  { label: '근무 중', tag: 'tag-success', color: 'var(--success)' },
  on_break: { label: '휴게 중', tag: 'tag-warning', color: 'var(--warning)' },
  off:      { label: '퇴근',    tag: 'tag',         color: 'var(--text-muted)' },
};

export default function AttendancePage() {
  const { user, currentWorkplaceId, supabase, loading, memberships } = useApp();
  const [todayLogs, setTodayLogs] = useState([]);
  const [board, setBoard] = useState([]);
  const [actionLoading, setActionLoading] = useState(null);
  const [error, setError] = useState(null);

  const todayMine = todayLogs.filter((l) => l.user_id === user?.id);
  const latestMine = todayMine[0];
  const myStatus = useMemo(() => {
    if (!latestMine) return 'off';
    if (latestMine.event_type === 'clock_in' || latestMine.event_type === 'break_end') return 'working';
    if (latestMine.event_type === 'break_start') return 'on_break';
    return 'off';
  }, [latestMine]);

  const firstClockIn = useMemo(() => {
    const ins = todayMine.filter((l) => l.event_type === 'clock_in');
    return ins.length ? ins[ins.length - 1] : null;
  }, [todayMine]);

  const workedMinutes = useMemo(() => {
    if (!firstClockIn) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(firstClockIn.event_at).getTime()) / 60000));
  }, [firstClockIn]);

  const loadData = useCallback(async () => {
    if (!currentWorkplaceId) return;
    const since = todayBoundary();

    const [{ data: logs }, { data: brd }] = await Promise.all([
      supabase
        .from('attendance_logs')
        .select('id, user_id, event_type, event_at, note, profiles:profiles!attendance_logs_user_id_fkey(name)')
        .eq('workplace_id', currentWorkplaceId)
        .gte('event_at', since)
        .order('event_at', { ascending: false }),
      supabase
        .from('attendance_current_status')
        .select('*')
        .eq('workplace_id', currentWorkplaceId)
        .order('event_at', { ascending: false }),
    ]);

    setTodayLogs(logs ?? []);
    setBoard(brd ?? []);
  }, [supabase, currentWorkplaceId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const channel = supabase
      .channel(`attendance:${currentWorkplaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_logs', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => loadData()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, currentWorkplaceId, loadData]);

  async function record(eventType) {
    if (!user || !currentWorkplaceId) return;
    setActionLoading(eventType);
    setError(null);
    const { error } = await supabase.from('attendance_logs').insert({
      user_id: user.id,
      workplace_id: currentWorkplaceId,
      event_type: eventType,
    });
    if (error) setError(error.message);
    setActionLoading(null);
  }

  if (loading) {
    return (
      <>
        <PageHeader title="근태" />
        <main className="section">
          <div className="skeleton" style={{ height: 220, marginBottom: 16 }} />
          <div className="skeleton" style={{ height: 140 }} />
        </main>
      </>
    );
  }

  if (!memberships?.length) {
    return (
      <>
        <PageHeader title="근태" />
        <main className="section">
          <div className="card empty">
            <div className="empty-icon"><Sparkles size={28} /></div>
            <div className="empty-title">사업장 배정 대기</div>
            <div className="empty-desc">관리자에게 문의해주세요.</div>
          </div>
        </main>
      </>
    );
  }

  const buttons = [];
  if (myStatus === 'off') {
    buttons.push({ type: 'clock_in', label: '출근하기', icon: LogIn, cls: 'btn-primary' });
  } else if (myStatus === 'working') {
    buttons.push({ type: 'break_start', label: '휴게 시작', icon: Coffee, cls: 'btn-soft' });
    buttons.push({ type: 'clock_out', label: '퇴근', icon: LogOut, cls: 'btn-danger' });
  } else if (myStatus === 'on_break') {
    buttons.push({ type: 'break_end', label: '복귀', icon: Play, cls: 'btn-primary' });
    buttons.push({ type: 'clock_out', label: '퇴근', icon: LogOut, cls: 'btn-danger' });
  }

  const hh = Math.floor(workedMinutes / 60);
  const mm = workedMinutes % 60;
  const workedText = firstClockIn ? `${hh}시간 ${mm}분 근무` : '오늘 출근 전';

  const meta = STATUS_META[myStatus];

  return (
    <>
      <PageHeader title="근태" subtitle="버튼을 눌러 출/퇴근을 기록해요" />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 본인 상태 카드 */}
        <section
          className={`bento ${myStatus === 'working' ? 'mint' : myStatus === 'on_break' ? 'warm' : 'dark'}`}
          style={{ padding: 24, minHeight: 200 }}
        >
          <div className="bento-decor" />
          <div className="bento-label">
            <Sparkles size={14} /> 내 상태
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 12 }}>
            <div className="bento-value" style={{ fontSize: 36 }}>
              {meta.label}
            </div>
            {latestMine && (
              <div style={{ textAlign: 'right', fontSize: 12, opacity: 0.85 }}>
                마지막 기록<br />
                <span className="num" style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatTime(latestMine.event_at)}
                </span>
              </div>
            )}
          </div>
          <div className="bento-sub" style={{ marginTop: 14, fontSize: 13 }}>
            {workedText}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: buttons.length === 1 ? '1fr' : '1fr 1fr', gap: 10, marginTop: 20 }}>
            {buttons.map((b) => (
              <button
                key={b.type}
                className={`btn ${b.cls} btn-lg`}
                onClick={() => record(b.type)}
                disabled={!!actionLoading}
              >
                <b.icon size={18} />
                {actionLoading === b.type ? '기록 중...' : b.label}
              </button>
            ))}
          </div>

          {error && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,93,93,0.18)', color: '#fff', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              {error}
            </div>
          )}
        </section>

        {/* 매장 현황 */}
        <section className="stack stack-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <span className="eyebrow">실시간</span>
              <h2 className="h3" style={{ marginTop: 2 }}>매장 현황</h2>
            </div>
            <span className="tag dot">
              <Users size={11} /> {board.filter((b) => b.status === 'working' || b.status === 'on_break').length}명
            </span>
          </div>

          {board.length === 0 ? (
            <div className="card empty" style={{ padding: '32px 16px' }}>
              <div className="empty-desc">오늘 출근 기록이 아직 없어요</div>
            </div>
          ) : (
            <div className="card" style={{ padding: 8 }}>
              {board.map((b, i) => {
                const m = STATUS_META[b.status];
                return (
                  <div key={b.user_id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 12 }}>
                      <Avatar name={b.name} userId={b.user_id} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="h4">{b.name || '이름 미상'}</div>
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                          {EVENT_LABEL[b.event_type]} · {formatRelative(b.event_at)}
                        </div>
                      </div>
                      <span className={`tag ${m.tag} dot`}>{m.label}</span>
                    </div>
                    {i < board.length - 1 && <hr className="divider" style={{ margin: '0 12px' }} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 오늘 전체 로그 */}
        <section className="stack stack-3">
          <h2 className="h3">오늘 기록</h2>
          {todayLogs.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>기록 없음</p>
          ) : (
            <div className="stack stack-2">
              {todayLogs.map((l) => (
                <div key={l.id} className="card compact" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span className="num" style={{ fontSize: 15, fontWeight: 800, width: 56 }}>{formatTime(l.event_at)}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{l.profiles?.name || '—'}</span>
                  <span className="tag">{EVENT_LABEL[l.event_type]}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
