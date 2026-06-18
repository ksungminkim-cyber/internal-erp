'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import PageHeader from '@/components/PageHeader';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import { downloadCsv } from '@/lib/csvExport';
import { ymd } from '@/lib/date';
import { saveSales, getSalesSummary } from './actions';
import { ChevronLeft, ChevronRight, TrendingUp, Plus, X, Info, Calendar, CreditCard, Banknote, Download, Lightbulb, Sparkles } from 'lucide-react';

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

// 직원에게 보여줄 매출 향상 팁 (현장 실행 가능한 것 위주)
const SALES_TIPS = [
  { icon: '➕', title: '한 끗 추가 제안', desc: '"샷 추가/사이즈업 어떠세요?", "오늘 디저트랑 같이 드시면 잘 어울려요" — 객단가를 올리는 가장 쉬운 한마디.' },
  { icon: '🎁', title: '세트·페어링 추천', desc: '커피+디저트, 음료+베이커리 묶음을 먼저 권해보세요. 고민하는 손님께 선택을 좁혀주면 구매로 이어집니다.' },
  { icon: '🔁', title: '단골 만들기', desc: '얼굴 기억하고 인사 한마디, 쿠폰/적립 안내. 재방문 한 번이 신규 손님 다섯보다 큽니다.' },
  { icon: '🍰', title: '시즌·신메뉴 한 줄 안내', desc: '계산 전 "이번 시즌 메뉴 나왔어요" 한마디. 카운터 POP·샘플 노출도 효과 큼.' },
  { icon: '⏰', title: '한가한 시간대 공략', desc: '브레이크 타임 한정 할인·세트로 비는 시간을 채우면 일 매출이 올라갑니다.' },
  { icon: '⭐', title: '리뷰·SNS 유도', desc: '"사진 예쁘게 나와요, 태그해주시면 다음에 작은 서비스 드려요" — 자연스러운 노출 유도.' },
  { icon: '⚡', title: '피크타임 회전', desc: '대기 줄엔 빠른 응대 + 미리 주문받기. 회전이 곧 매출입니다.' },
];

export default function SalesPage() {
  const router = useRouter();
  const { user, currentWorkplaceId, supabase, isManager } = useApp();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null); // 누적/이번 달 합계
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showTips, setShowTips] = useState(false);

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
    // 누적/이번 달 합계는 서버액션으로 별도 집계 (30일 조회와 무관하게 전체)
    getSalesSummary(currentWorkplaceId).then(setSummary).catch(() => {});
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

        {/* 누적 합계 — 이번 달 + 전체(지금까지 기입된 모든 매출) */}
        {summary && (
          <section className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 700 }}>이번 달 합계</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>
                {formatCurrency(summary.monthTotal)}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>{summary.monthCount}일 입력</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="text-muted" style={{ fontSize: 11, fontWeight: 700 }}>누적 합계 (전체)</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>
                {formatCurrency(summary.allTotal)}<span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>원</span>
              </div>
              <div className="text-muted" style={{ fontSize: 11 }}>총 {summary.allCount}일</div>
            </div>
          </section>
        )}

        {/* 매출 올리기 팁 — 직원 공통 노출 */}
        <section className="card" style={{ background: 'var(--accent-soft)' }}>
          <button
            type="button"
            onClick={() => setShowTips((v) => !v)}
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: 0, textAlign: 'left' }}
          >
            <Lightbulb size={18} color="var(--accent-strong)" />
            <span className="h4" style={{ flex: 1, color: 'var(--accent-strong)' }}>매출 올리는 작은 팁</span>
            <ChevronRight size={18} style={{ transform: showTips ? 'rotate(90deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)', color: 'var(--accent-strong)' }} />
          </button>
          {!showTips && (
            <p className="text-secondary" style={{ fontSize: 12.5, marginTop: 8 }}>
              {SALES_TIPS[0].icon} <strong>{SALES_TIPS[0].title}</strong> — {SALES_TIPS[0].desc}
            </p>
          )}
          {showTips && (
            <div className="stack stack-2" style={{ marginTop: 12 }}>
              {SALES_TIPS.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'var(--surface)', borderRadius: 10 }}>
                  <span style={{ fontSize: 16, lineHeight: 1.3 }}>{t.icon}</span>
                  <div>
                    <div className="h4" style={{ fontSize: 13 }}>{t.title}</div>
                    <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{t.desc}</div>
                  </div>
                </div>
              ))}
              <p className="text-muted" style={{ fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Sparkles size={11} /> 작은 한마디·추천 하나가 객단가를 바꿉니다.
              </p>
            </div>
          )}
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
  const [date, setDate] = useState(row?.sales_date ?? ymd());
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
    try {
      const res = await saveSales({
        workplaceId,
        salesDate: date,
        totalAmount: totalFinal,
        transactionCount: count,
        cashAmount: cash,
        cardAmount: card,
        otherAmount: other,
        notes,
      });
      if (res?.error) { setError(res.error); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
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
