'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/PageHeader';
import Avatar from '@/components/Avatar';
import { calcLabor } from '@/lib/laborCalc';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { ymd } from '@/lib/date';
import { ChevronLeft, Clock, Wallet, Calendar, TrendingUp, History, AlertTriangle } from 'lucide-react';

function dateLabel(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} (${['일','월','화','수','목','금','토'][d.getDay()]})`;
}

export default function MemberStatsClient({
  target, year, month, logs, shifts, wageHistory, memberships, isMe,
}) {
  const router = useRouter();
  const [tab, setTab] = useState('overview');

  // 인건비 계산
  const laborSummary = useMemo(() => {
    if (!logs?.length) return null;
    return calcLabor(logs, Number(target.hourly_wage ?? 0));
  }, [logs, target.hourly_wage]);

  // 시프트 vs 근태 비교
  const shiftCheck = useMemo(() => {
    if (!shifts?.length) return [];
    const result = [];
    for (const s of shifts) {
      const shiftStart = new Date(s.start_at);
      const shiftEnd = new Date(s.end_at);
      const dayLogs = logs.filter((l) => {
        const lt = new Date(l.event_at);
        return lt >= new Date(shiftStart.getFullYear(), shiftStart.getMonth(), shiftStart.getDate())
            && lt <  new Date(shiftStart.getFullYear(), shiftStart.getMonth(), shiftStart.getDate() + 1);
      });
      const clockIn = dayLogs.find((l) => l.event_type === 'clock_in');
      const clockOut = [...dayLogs].reverse().find((l) => l.event_type === 'clock_out');

      let status = 'normal';
      let note = null;
      if (!clockIn) {
        status = 'absent';
        note = '결근';
      } else {
        const inT = new Date(clockIn.event_at);
        if (inT.getTime() > shiftStart.getTime() + 10 * 60000) {
          const lateMin = Math.round((inT - shiftStart) / 60000);
          status = 'late';
          note = `지각 ${lateMin}분`;
        }
        if (clockOut) {
          const outT = new Date(clockOut.event_at);
          if (outT.getTime() < shiftEnd.getTime() - 10 * 60000) {
            const earlyMin = Math.round((shiftEnd - outT) / 60000);
            status = status === 'late' ? 'late_early' : 'early';
            note = (note ? note + ' / ' : '') + `조퇴 ${earlyMin}분`;
          }
        } else {
          status = status === 'late' ? 'late_no_out' : 'no_out';
          note = (note ? note + ' / ' : '') + '미퇴근';
        }
      }
      result.push({
        date: s.start_at,
        shiftStart: shiftStart.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        shiftEnd:   shiftEnd.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
        clockIn:    clockIn?.event_at,
        clockOut:   clockOut?.event_at,
        workplaceName: s.workplaces?.name,
        status, note,
      });
    }
    return result;
  }, [shifts, logs]);

  const issuesCount = shiftCheck.filter((r) => r.status !== 'normal').length;

  function goMonth(delta) {
    const d = new Date(year, month - 1 + delta, 1);
    router.push(`/members/${target.user_id}?year=${d.getFullYear()}&month=${d.getMonth() + 1}`);
  }

  return (
    <>
      <PageHeader
        title={`${target.name || '이름 없음'}`}
        subtitle={`${year}년 ${month}월 근무 통계`}
        hideSwitcher
        action={
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
            <ChevronLeft size={20} />
          </button>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 프로필 카드 */}
        <section className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar name={target.name} userId={target.user_id} size="lg" />
          <div style={{ flex: 1 }}>
            <div className="h3">{target.name || '이름 없음'}</div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {target.phone || '연락처 없음'}
              {target.retired_at && (
                <span className="tag tag-danger" style={{ marginLeft: 8, fontSize: 10 }}>
                  퇴사 {ymd(new Date(target.retired_at))}
                </span>
              )}
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              시급 <strong style={{ color: 'var(--accent)' }}>{formatCurrency(target.hourly_wage)}원/h</strong>
              {memberships.filter((m) => m.active).map((m) => (
                <span key={m.id} className="tag dot" style={{ fontSize: 10, marginLeft: 6 }}>
                  {m.workplaces?.name} · {m.role}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* 월 이동 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => goMonth(-1)} className="btn btn-soft btn-sm">← 이전 달</button>
          <span className="h4" style={{ minWidth: 100, textAlign: 'center' }}>{year}년 {month}월</span>
          <button onClick={() => goMonth(1)} className="btn btn-soft btn-sm">다음 달 →</button>
        </div>

        {/* 탭 */}
        <div className="segment">
          <button className={`segment-item ${tab === 'overview' ? 'is-active' : ''}`} onClick={() => setTab('overview')}>요약</button>
          <button className={`segment-item ${tab === 'shifts' ? 'is-active' : ''}`} onClick={() => setTab('shifts')}>
            시프트-근태 {issuesCount > 0 && <span className="tag tag-danger" style={{ marginLeft: 4, fontSize: 9 }}>{issuesCount}</span>}
          </button>
          {isMe || (
            <button className={`segment-item ${tab === 'wage' ? 'is-active' : ''}`} onClick={() => setTab('wage')}>시급 이력</button>
          )}
        </div>

        {/* 요약 탭 */}
        {tab === 'overview' && (
          <div className="grid-2">
            <div className="bento accent" style={{ minHeight: 130 }}>
              <div className="bento-decor" />
              <div className="bento-label"><Clock size={14} /> 근무시간</div>
              <div className="bento-value num">
                {laborSummary ? `${Math.floor(laborSummary.totalMinutes / 60)}h ${laborSummary.totalMinutes % 60}m` : '0h 0m'}
              </div>
              <div className="bento-sub">{logs.filter((l) => l.event_type === 'clock_in').length}회 출근</div>
            </div>

            <div className="bento" style={{ minHeight: 130 }}>
              <div className="bento-label text-secondary"><Wallet size={14} /> 인건비</div>
              <div className="bento-value sm num">
                {laborSummary ? formatCurrency(Math.round(laborSummary.totalPay)) : '0'}
                <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 4 }}>원</span>
              </div>
              <div className="bento-sub text-muted">기본 + 야간 + 연장 + 주휴</div>
            </div>

            <div className="bento" style={{ minHeight: 110 }}>
              <div className="bento-label text-secondary"><Calendar size={14} /> 시프트 배정</div>
              <div className="bento-value sm num">{shifts.length}<span style={{ fontSize: 14, marginLeft: 4 }}>회</span></div>
            </div>

            <div className={`bento ${issuesCount > 0 ? 'warm' : ''}`} style={{ minHeight: 110 }}>
              <div className="bento-label" style={{ color: issuesCount > 0 ? undefined : 'var(--text-secondary)' }}>
                <AlertTriangle size={14} /> 지각/결근/조퇴
              </div>
              <div className="bento-value sm num" style={{ color: issuesCount > 0 ? '#fff' : 'var(--text)' }}>
                {issuesCount}<span style={{ fontSize: 14, opacity: 0.7, marginLeft: 4 }}>건</span>
              </div>
            </div>

            {laborSummary && (
              <>
                <div className="card" style={{ gridColumn: '1 / -1', padding: 14 }}>
                  <div className="h4" style={{ marginBottom: 10 }}>수당 분류</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Detail label="기본" minutes={laborSummary.baseMinutes} amount={laborSummary.basePay} />
                    {laborSummary.nightMinutes > 0 && <Detail label="야간" minutes={laborSummary.nightMinutes} amount={laborSummary.nightPay} accent="violet" />}
                    {laborSummary.overtimeMinutes > 0 && <Detail label="연장" minutes={laborSummary.overtimeMinutes} amount={laborSummary.overtimePay} accent="warning" />}
                    {laborSummary.weeklyRestPay > 0 && <Detail label="주휴" minutes={0} amount={laborSummary.weeklyRestPay} accent="success" />}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 시프트-근태 비교 탭 */}
        {tab === 'shifts' && (
          shiftCheck.length === 0 ? (
            <div className="card empty">
              <div className="empty-desc">이 달 시프트 배정 없음</div>
            </div>
          ) : (
            <div className="stack stack-2">
              {shiftCheck.map((r, i) => {
                const meta = {
                  normal:       { label: '정상', tag: 'tag-success' },
                  late:         { label: '지각', tag: 'tag-warning' },
                  early:        { label: '조퇴', tag: 'tag-warning' },
                  late_early:   { label: '지각/조퇴', tag: 'tag-warning' },
                  no_out:       { label: '미퇴근', tag: 'tag-danger' },
                  late_no_out:  { label: '지각/미퇴근', tag: 'tag-danger' },
                  absent:       { label: '결근', tag: 'tag-danger' },
                }[r.status];
                return (
                  <div key={i} className="card compact" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="num" style={{ fontWeight: 700, fontSize: 13, width: 80 }}>{dateLabel(r.date)}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {r.shiftStart} - {r.shiftEnd}
                          {r.workplaceName && <span className="text-muted" style={{ marginLeft: 6, fontWeight: 500 }}>· {r.workplaceName}</span>}
                        </div>
                        {r.note && <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>{r.note}</div>}
                      </div>
                      <span className={`tag ${meta.tag}`} style={{ fontSize: 11 }}>{meta.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* 시급 이력 탭 */}
        {tab === 'wage' && (
          wageHistory.length === 0 ? (
            <div className="card empty">
              <div className="empty-icon"><History size={26} /></div>
              <div className="empty-desc">시급 변경 이력 없음</div>
            </div>
          ) : (
            <div className="stack stack-2">
              {wageHistory.map((h) => (
                <div key={h.id} className="card compact" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <TrendingUp size={16} color={Number(h.new_wage) > Number(h.old_wage || 0) ? 'var(--success)' : 'var(--danger)'} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {formatCurrency(h.old_wage || 0)}원 → {formatCurrency(h.new_wage)}원
                      </div>
                      <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {formatDateTime(h.changed_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </>
  );
}

function Detail({ label, minutes, amount, accent }) {
  const accentColor = accent === 'violet' ? '#6d28d9'
    : accent === 'warning' ? '#c2410c'
    : accent === 'success' ? '#00876c'
    : 'var(--text)';
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 10,
      background: 'var(--surface-soft)',
      display: 'flex', flexDirection: 'column', gap: 2,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</div>
      {minutes > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {Math.floor(minutes / 60)}h {minutes % 60}m
        </div>
      )}
      <div className="num" style={{ fontSize: 14, fontWeight: 700, color: accentColor }}>
        {formatCurrency(Math.round(amount))}원
      </div>
    </div>
  );
}
