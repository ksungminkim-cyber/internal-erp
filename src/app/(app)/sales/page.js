'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import { downloadCsv } from '@/lib/csvExport';
import { ChevronLeft, ChevronRight, TrendingUp, Plus, X, Info, Calendar, CreditCard, Banknote, Download } from 'lucide-react';

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) { return d.toISOString().slice(0, 10); }

export default function SalesPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showGuide, setShowGuide] = useState(false);

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const start = useMemo(() => addDays(today, -29), [today]);

  const load = useCallback(async () => {
    if (!currentWorkplaceId) return;
    const { data } = await supabase
      .from('sales_daily')
      .select('*')
      .eq('workplace_id', currentWorkplaceId)
      .gte('sales_date', ymd(start))
      .order('sales_date', { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, [supabase, currentWorkplaceId, start]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!currentWorkplaceId) return;
    const ch = supabase
      .channel(`sales:${currentWorkplaceId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'sales_daily', filter: `workplace_id=eq.${currentWorkplaceId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, currentWorkplaceId, load]);

  const todayKey = ymd(today);
  const todayRow = rows.find((r) => r.sales_date === todayKey);
  const last7 = rows.filter((r) => new Date(r.sales_date) >= addDays(today, -6));
  const total7 = last7.reduce((s, r) => s + Number(r.total_amount || 0), 0);
  const avg7 = last7.length ? Math.round(total7 / last7.length) : 0;
  const maxBar = Math.max(...rows.map((r) => Number(r.total_amount || 0)), 1);

  // 30일 차트 데이터 (오래된 날짜부터)
  const chartData = useMemo(() => {
    const arr = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(today, -i);
      const k = ymd(d);
      const r = rows.find((x) => x.sales_date === k);
      arr.push({ date: d, amount: r ? Number(r.total_amount) : 0 });
    }
    return arr;
  }, [rows, today]);

  function exportCsv() {
    downloadCsv(
      `sales_${ymd(start)}_${ymd(today)}.csv`,
      [
        { key: 'sales_date', label: '날짜' },
        { key: 'total_amount', label: '총매출' },
        { key: 'card_amount', label: '카드' },
        { key: 'cash_amount', label: '현금' },
        { key: 'other_amount', label: '기타' },
        { key: 'transaction_count', label: '거래건수' },
        { key: 'source', label: '입력방식' },
        { key: 'notes', label: '메모' },
      ],
      rows
    );
  }

  return (
    <>
      <PageHeader
        title="매출"
        subtitle="일별 매출 현황"
        hideSwitcher
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {isManager && (
              <button onClick={exportCsv} className="btn btn-soft btn-sm" disabled={!rows.length}>
                <Download size={14} /> CSV
              </button>
            )}
            <button onClick={() => router.back()} className="btn btn-ghost btn-icon"><ChevronLeft size={20} /></button>
          </div>
        }
      />

      <main className="fade-in page-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* 오늘 */}
        <section className="bento accent" style={{ minHeight: 160 }}>
          <div className="bento-decor" />
          <div className="bento-label">
            <Calendar size={14} /> 오늘 매출
          </div>
          <div className="bento-value num" style={{ fontSize: 38 }}>
            {formatCurrency(todayRow?.total_amount ?? 0)}<span style={{ fontSize: 18, opacity: 0.85, marginLeft: 4 }}>원</span>
          </div>
          <div className="bento-sub" style={{ marginTop: 8 }}>
            {todayRow?.transaction_count != null ? `${todayRow.transaction_count}건` : '거래 없음'}
            {todayRow?.source && todayRow.source !== 'manual' && ' · POS 자동 집계'}
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setEditing({ sales_date: todayKey, ...(todayRow ?? {}) })}
              style={{ background: 'rgba(255,255,255,0.25)', color: '#fff', border: 'none' }}
            >
              <Plus size={12} /> {todayRow ? '수정' : '입력'}
            </button>
          </div>
        </section>

        {/* 7일 요약 */}
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="bento">
            <div className="bento-label text-secondary">
              <TrendingUp size={14} /> 최근 7일
            </div>
            <div className="bento-value sm num">
              {formatCurrency(total7)}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
            </div>
            <div className="bento-sub text-muted">합계</div>
          </div>
          <div className="bento">
            <div className="bento-label text-secondary">
              <Calendar size={14} /> 일평균
            </div>
            <div className="bento-value sm num">
              {formatCurrency(avg7)}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
            </div>
            <div className="bento-sub text-muted">{last7.length}일 기준</div>
          </div>
        </section>

        {/* 30일 차트 */}
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <h2 className="h3">30일 추이</h2>
            <span className="text-muted" style={{ fontSize: 11 }}>일별 매출</span>
          </div>
          <div style={{ height: 120, display: 'flex', alignItems: 'flex-end', gap: 2, padding: '0 2px' }}>
            {chartData.map((d, i) => {
              const h = maxBar > 0 ? (d.amount / maxBar) * 100 : 0;
              const isToday = ymd(d.date) === todayKey;
              return (
                <div
                  key={i}
                  title={`${ymd(d.date)} · ${formatCurrency(d.amount)}원`}
                  style={{
                    flex: 1,
                    height: `${Math.max(h, 2)}%`,
                    background: d.amount === 0
                      ? 'var(--surface-soft)'
                      : isToday ? 'var(--grad-warm)' : 'var(--grad-accent)',
                    borderRadius: 3,
                    minHeight: 3,
                    transition: 'all var(--t-md) var(--ease)',
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
            <span>{chartData[0]?.date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</span>
            <span>오늘</span>
          </div>
        </section>

        {/* 일별 리스트 */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 className="h3">일별 기록</h2>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setShowGuide(true)}
            >
              <Info size={12} /> POS 연동
            </button>
          </div>

          {loading ? (
            <div className="skeleton" style={{ height: 200 }} />
          ) : rows.length === 0 ? (
            <div className="card empty">
              <div className="empty-desc">아직 매출 기록이 없어요</div>
            </div>
          ) : (
            <div className="stack stack-2">
              {rows.map((r) => (
                <div key={r.id} className="card compact" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="h4">
                      {new Date(r.sales_date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' })}
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2, display: 'flex', gap: 8 }}>
                      <span><CreditCard size={10} style={{ display: 'inline' }} /> {formatCurrency(r.card_amount)}</span>
                      <span><Banknote size={10} style={{ display: 'inline' }} /> {formatCurrency(r.cash_amount)}</span>
                      {r.transaction_count ? <span>· {r.transaction_count}건</span> : null}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 17, fontWeight: 800 }}>
                      {formatCurrency(r.total_amount)}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
                    </div>
                    {r.source !== 'manual' && (
                      <span className="tag tag-mint" style={{ fontSize: 9, marginTop: 2 }}>POS</span>
                    )}
                  </div>
                  <button onClick={() => setEditing(r)} className="btn btn-ghost btn-icon">
                    <ChevronRight size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <button type="button" className="fab" onClick={() => setEditing({ sales_date: todayKey })} aria-label="매출 입력">
        <Plus size={26} />
      </button>

      {editing && (
        <SalesEditor
          row={editing}
          supabase={supabase}
          userId={user.id}
          workplaceId={currentWorkplaceId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {showGuide && <PosGuide onClose={() => setShowGuide(false)} />}
    </>
  );
}

function SalesEditor({ row, supabase, userId, workplaceId, onClose, onSaved }) {
  const isEdit = !!row?.id;
  const [date, setDate] = useState(row?.sales_date ?? new Date().toISOString().slice(0, 10));
  const [total, setTotal] = useState(row?.total_amount ?? '');
  const [card, setCard] = useState(row?.card_amount ?? '');
  const [cash, setCash] = useState(row?.cash_amount ?? '');
  const [other, setOther] = useState(row?.other_amount ?? '');
  const [count, setCount] = useState(row?.transaction_count ?? '');
  const [notes, setNotes] = useState(row?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const autoTotal = (Number(card) || 0) + (Number(cash) || 0) + (Number(other) || 0);
  const totalFinal = Number(total) || autoTotal;

  async function save() {
    setError(null);
    if (!date) return setError('날짜를 입력해주세요.');
    setSaving(true);
    const { error } = await supabase.from('sales_daily').upsert({
      workplace_id: workplaceId,
      sales_date: date,
      total_amount: totalFinal,
      transaction_count: Number(count) || 0,
      cash_amount: Number(cash) || 0,
      card_amount: Number(card) || 0,
      other_amount: Number(other) || 0,
      source: 'manual',
      notes: notes.trim() || null,
      recorded_by: userId,
      recorded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workplace_id,sales_date' });
    if (error) { setError(error.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">{isEdit ? '매출 수정' : '매출 입력'}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <label className="label">날짜</label>
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={isEdit} />

      <label className="label" style={{ marginTop: 16 }}>총 매출 (자동: {formatCurrency(autoTotal)}원)</label>
      <input className="input lg num" type="number" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} placeholder={String(autoTotal)} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
        <div>
          <label className="label">카드</label>
          <input className="input num" type="number" inputMode="numeric" value={card} onChange={(e) => setCard(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">현금</label>
          <input className="input num" type="number" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div>
          <label className="label">기타 (페이 등)</label>
          <input className="input num" type="number" inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} placeholder="0" />
        </div>
        <div>
          <label className="label">거래 건수</label>
          <input className="input num" type="number" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} placeholder="0" />
        </div>
      </div>

      <label className="label" style={{ marginTop: 12 }}>메모</label>
      <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ resize: 'vertical' }} />

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} style={{ flex: 1 }}>취소</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ flex: 2 }}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </BottomSheet>
  );
}

function PosGuide({ onClose }) {
  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 className="h3">POS 연동 안내</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon"><X size={18} /></button>
      </div>

      <div className="stack stack-3" style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <div className="card" style={{ background: 'var(--surface-soft)', boxShadow: 'none' }}>
          <div className="h4" style={{ marginBottom: 6 }}>🟦 토스 POS 실시간 연동 현황</div>
          <p style={{ fontSize: 13 }}>
            토스플레이스(토스 POS)는 현재 일반 가맹점이 외부 시스템으로 결제 이벤트를 실시간 받을 수 있는
            <strong> 공개 Webhook/API 가 없습니다</strong>. 토스 영업담당자에게 B2B 연동 가능 여부를 문의해보세요.
          </p>
        </div>

        <div>
          <div className="h4" style={{ marginBottom: 6, color: 'var(--text)' }}>현재 가능한 방식</div>
          <ol style={{ paddingLeft: 18, fontSize: 13 }}>
            <li><strong>수동 일 마감 입력</strong> — 매장 마감 시 매출 합계를 입력 (현재 사용 방식)</li>
            <li><strong>토스 비즈 대시보드 CSV 다운로드</strong> → 우리 시스템에 업로드 (요청 시 구현)</li>
            <li><strong>실시간 Webhook</strong> — 토스에서 권한을 받으면 즉시 동작 (코드 준비 완료)</li>
          </ol>
        </div>

        <div>
          <div className="h4" style={{ marginBottom: 6, color: 'var(--text)' }}>실시간 연동이 가능해지면</div>
          <p style={{ fontSize: 13 }}>
            관리자가 Supabase 의 <code style={{ background: 'var(--surface-strong)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>workplaces.pos_store_code</code> 에 토스 가맹점 코드를 입력하고,
            토스에 다음 URL 을 등록하면 자동 집계됩니다:
          </p>
          <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-strong)', borderRadius: 8, fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            POST https://your-domain.com/api/pos/toss/webhook
          </div>
        </div>
      </div>

      <button type="button" className="btn btn-primary btn-block" onClick={onClose} style={{ marginTop: 16 }}>
        확인
      </button>
    </BottomSheet>
  );
}
