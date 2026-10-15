// src/app/(app)/sales/SalesKpiCard.js
'use client';

import { useEffect, useState } from 'react';
import { Target, Pencil, Coffee, Wine, X } from 'lucide-react';
import BottomSheet from '@/components/BottomSheet';
import { formatCurrency } from '@/lib/format';
import { computeKpi, isBarCategory, unitsToTarget } from '@/lib/salesKpi';
import { getSalesKpi, updateSalesTarget } from './actions';

function fmtMan(n) {
  // 2,000만원 식 축약 — 카드 제목용
  const v = Math.round(Number(n) || 0);
  if (v >= 100_000_000) return `${Math.round(v / 1_000_000) / 100}억원`;
  if (v >= 10_000) return `${new Intl.NumberFormat('ko-KR').format(Math.round(v / 10_000))}만원`;
  return `${new Intl.NumberFormat('ko-KR').format(v)}원`;
}

function TopList({ title, icon: Icon, products, remaining }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
        <Icon size={13} /> {title}
      </div>
      {products.length === 0 ? (
        <div className="text-muted" style={{ fontSize: 12, padding: '6px 0' }}>이달 판매 없음</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {products.map((p, i) => {
            const need = unitsToTarget(remaining, p);
            return (
              <li key={p.item_title} style={{ padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num text-muted" style={{ fontSize: 11, fontWeight: 700, width: 12, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.item_title}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingLeft: 20, marginTop: 2 }}>
                  <span className="text-muted num" style={{ fontSize: 11, flex: 1 }}>이달 {formatCurrency(p.qty)}개 · {formatCurrency(p.amount)}원</span>
                  <span className="num" style={{ fontSize: 13, fontWeight: 800, color: need === 0 ? 'var(--success)' : 'var(--accent-strong)', whiteSpace: 'nowrap' }}>
                    {need == null ? '-' : need === 0 ? '달성' : `+${formatCurrency(need)}개`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default function SalesKpiCard({ workplaceId }) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!workplaceId) return undefined;
    let alive = true;
    getSalesKpi({ workplaceId })
      .then((data) => { if (alive) setState({ key: workplaceId, data, error: data ? null : '권한이 없어요' }); })
      .catch((e) => { if (!alive) return; console.error('getSalesKpi', e); setState({ key: workplaceId, data: null, error: '잠시 후 다시 시도해 주세요.' }); });
    return () => { alive = false; };
  }, [workplaceId, tick]);

  const loading = state.key !== workplaceId;
  const data = loading ? null : state.data;
  if (!loading && (state.error || !data)) return null;

  const kpi = data ? computeKpi(data) : null;
  const cafe = (data?.products ?? []).filter((p) => !isBarCategory(p.category)).slice(0, 3);
  const bar = (data?.products ?? []).filter((p) => isBarCategory(p.category)).slice(0, 3);
  const pct = kpi ? Math.round(kpi.progress * 100) : 0;
  const barWidth = kpi ? Math.min(100, Math.max(2, kpi.progress * 100)) : 0;
  const done = kpi && kpi.remaining === 0;

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Target size={18} color="var(--accent-strong)" />
        <h2 className="h3" style={{ flex: 1 }}>
          이달 목표 {kpi ? fmtMan(kpi.target) : ''}
        </h2>
        {data?.canEditTarget && (
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(true)} aria-label="목표 수정">
            <Pencil size={13} />
          </button>
        )}
      </div>

      <div style={{ padding: '10px 16px 14px', borderBottom: '1px solid var(--border)' }}>
        {loading || !kpi ? (
          <div className="skeleton" style={{ height: 64 }} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span className="num" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.15, color: done ? 'var(--success)' : 'var(--accent-strong)' }}>
                {pct}<span style={{ fontSize: 14, marginLeft: 1 }}>%</span>
              </span>
              <span className="text-secondary num" style={{ fontSize: 13 }}>
                {formatCurrency(kpi.monthTotal)}원 / {formatCurrency(kpi.target)}원
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-soft)', overflow: 'hidden', marginTop: 8 }} aria-hidden="true">
              <div style={{ width: `${barWidth}%`, height: '100%', borderRadius: 999, background: done ? 'var(--success)' : 'var(--grad-accent)', transition: 'width var(--t-md) var(--ease)' }} />
            </div>
            <div className="text-secondary" style={{ fontSize: 12.5, marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {done ? (
                <span>목표를 달성했어요. 남은 {kpi.daysLeft}일은 초과분입니다.</span>
              ) : (
                <>
                  <span>남은 금액 <strong className="num">{formatCurrency(kpi.remaining)}</strong>원</span>
                  <span>남은 {kpi.daysLeft}일 · 하루 <strong className="num">{formatCurrency(kpi.perDayNeeded)}</strong>원 필요</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 상위 상품별 — 이 상품만으로 남은 금액을 채운다면 몇 개 더 */}
      {!loading && kpi && (
        <div style={{ padding: '10px 16px 14px' }}>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>
            이달 매출 상위 상품 기준, 그 상품만으로 남은 금액을 채운다면
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <TopList title="카페" icon={Coffee} products={cafe} remaining={kpi.remaining} />
            {bar.length > 0 && <TopList title="바" icon={Wine} products={bar} remaining={kpi.remaining} />}
          </div>
        </div>
      )}

      {editing && (
        <TargetEditor
          workplaceId={workplaceId}
          current={kpi?.target ?? 0}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); setTick((t) => t + 1); }}
        />
      )}
    </section>
  );
}

function TargetEditor({ workplaceId, current, onClose, onSaved }) {
  const [value, setValue] = useState(String(Math.round(current / 10_000))); // 만원 단위 입력
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setError(null);
    const man = Number(value);
    if (!Number.isFinite(man) || man < 0) return setError('만원 단위 숫자로 입력해 주세요.');
    setSaving(true);
    try {
      const res = await updateSalesTarget({ workplaceId, target: man * 10_000 });
      if (res?.error) { setError(res.error); return; }
      onSaved();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 className="h3">월 매출 목표</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="닫기"><X size={18} /></button>
      </div>
      <label className="label">목표 금액 (만원)</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input className="input" type="number" inputMode="numeric" min="0" step="10" value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: 1 }} aria-label="목표 금액 (만원)" />
        <span className="text-muted">만원</span>
      </div>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>= {formatCurrency((Number(value) || 0) * 10_000)}원 · 이 매장에만 적용됩니다.</div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
      <button type="button" className="btn btn-primary btn-block" onClick={save} disabled={saving} style={{ marginTop: 14 }}>
        {saving ? '저장 중…' : '목표 저장'}
      </button>
    </BottomSheet>
  );
}
