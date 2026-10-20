'use client';

import { useEffect, useState } from 'react';
import { PackageCheck, ChevronDown } from 'lucide-react';
import { useFeedback } from '@/context/FeedbackContext';
import { formatDate } from '@/lib/format';
import { getPendingInbound, confirmInbound, dismissInbound } from './actions';

/**
 * 입고 대기 — 최종 승인된 지출결의서 중 아직 입고 확인하지 않은 것.
 * 라인마다 재고 품목(자동 매칭은 점선)과 받은 수량을 확인하고 한 번에 입고 거래로 기록한다.
 * props: workplaceId, refreshKey(바뀌면 재조회), onChanged(입고 반영 후 부모 재조회), onCount(대기 건수)
 */
export default function InboundCard({ workplaceId, refreshKey = '', onChanged, onCount }) {
  const { toast, confirmDialog } = useFeedback();
  const [result, setResult] = useState({ key: null, docs: [], items: [] });
  const [open, setOpen] = useState(null); // 펼친 기안 id

  useEffect(() => {
    if (!workplaceId) return undefined;
    let alive = true;
    getPendingInbound({ workplaceId })
      .then((r) => { if (!alive) return; setResult({ key: workplaceId, docs: r?.docs ?? [], items: r?.items ?? [] }); onCount?.(r?.docs?.length ?? 0); })
      .catch(() => { if (alive) setResult({ key: workplaceId, docs: [], items: [] }); });
    return () => { alive = false; };
    // onCount 는 부모 setState 래퍼 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workplaceId, refreshKey]);

  if (result.key !== workplaceId || result.docs.length === 0) return null;

  async function reload() {
    const r = await getPendingInbound({ workplaceId }).catch(() => null);
    setResult({ key: workplaceId, docs: r?.docs ?? [], items: r?.items ?? [] });
    onCount?.(r?.docs?.length ?? 0);
    onChanged?.();
  }

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px' }}>
        <PackageCheck size={18} color="var(--accent-strong)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="h3">입고 대기 <span className="num text-muted" style={{ fontSize: 13, fontWeight: 700, marginLeft: 4 }}>{result.docs.length}건</span></div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>승인된 발주가 도착하면 수량을 확인하고 입고로 기록하세요</div>
        </div>
      </div>
      <div style={{ padding: '0 16px 12px', display: 'grid', gap: 8 }}>
        {result.docs.map((d) => (
          <InboundDoc
            key={d.id}
            doc={d}
            items={result.items}
            open={open === d.id}
            onToggle={() => setOpen((o) => (o === d.id ? null : d.id))}
            onConfirm={async (lines) => {
              const res = await confirmInbound({ workplaceId, requestId: d.id, lines });
              if (res?.error) return toast(res.error, 'error');
              toast(`입고 ${res.restocked}건 기록`, 'success');
              await reload();
            }}
            onDismiss={async () => {
              if (!(await confirmDialog({ message: '이 기안은 재고 입고가 아닌 것으로 처리할까요? (거래는 기록되지 않습니다)', confirmLabel: '재고 아님' }))) return;
              const res = await dismissInbound({ workplaceId, requestId: d.id });
              if (res?.error) return toast(res.error, 'error');
              await reload();
            }}
          />
        ))}
      </div>
    </section>
  );
}

function InboundDoc({ doc, items, open, onToggle, onConfirm, onDismiss }) {
  const [lines, setLines] = useState(() => doc.lines.map((l) => ({ ...l, qty: l.qty == null ? '' : String(l.qty) })));
  const [busy, setBusy] = useState(false);
  const ready = lines.filter((l) => l.itemId && Number(l.qty) > 0).length;

  function setLine(idx, patch) { setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))); }

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ expenseItemId: l.expenseItemId, itemId: l.itemId, qty: Number(l.qty), amount: l.amount })));
    } finally { setBusy(false); }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface-soft)', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit', font: 'inherit' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>승인 {formatDate(doc.decided_at)} · {doc.lines.length}항목{ready ? ` · 입고 가능 ${ready}` : ''}</div>
        </div>
        <ChevronDown size={16} className="text-muted" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-sm) var(--ease)' }} />
      </button>

      {open && (
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {lines.map((l, idx) => (
            <div key={l.expenseItemId} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 6, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div className="text-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.description}</div>
                <select
                  className="input sm" value={l.itemId ?? ''} aria-label={`${l.description} 재고 품목`}
                  onChange={(e) => setLine(idx, { itemId: e.target.value || null, auto: false })}
                  style={{ borderStyle: l.auto ? 'dashed' : 'solid', marginTop: 2 }}
                >
                  <option value="">재고 아님 / 선택 안 함</option>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
                </select>
              </div>
              <input className="input sm num" type="number" inputMode="decimal" min="0" step="any" placeholder="수량" aria-label={`${l.description} 받은 수량`}
                value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} disabled={!l.itemId} />
            </div>
          ))}
          <div className="text-muted" style={{ fontSize: 11 }}>점선 테두리는 이름으로 추정한 품목이에요. 틀리면 바꿔 주세요. 수량이 비어 있으면 그 줄은 건너뜁니다.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onDismiss} disabled={busy}>재고 아님</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={busy || ready === 0} style={{ flex: 1 }}>
              {busy ? '기록 중...' : `입고 확인 · ${ready}품목`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
