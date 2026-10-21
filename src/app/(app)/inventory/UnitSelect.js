'use client';

import { useState } from 'react';

// 세는 단위(입고·재고) / 소진 단위(판매 시 빠지는 단위)
export const COUNT_UNITS = ['개', '박스', '봉', '병', '캔', '팩', '통', '잔', 'kg', 'g', 'L', 'ml'];
export const USAGE_UNITS = ['개', 'g', 'ml', '잔', '샷', '스쿱', 'kg', 'L'];
const CUSTOM = '__custom__';

// 드롭박스 + 직접 입력
export default function UnitSelect({ value, onChange, options, allowNone = false, noneLabel = '없음', ariaLabel, compact = false }) {
  const listed = options.includes(value) || (allowNone && value === '');
  const [custom, setCustom] = useState(!listed && value !== '');
  const cls = compact ? 'input sm' : 'input';
  if (custom) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} placeholder="단위 입력" aria-label={ariaLabel} autoFocus style={{ flex: 1, minWidth: 0 }} />
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => { setCustom(false); onChange(options[0]); }}>목록</button>
      </div>
    );
  }
  return (
    <select
      className={cls}
      value={listed ? value : CUSTOM}
      aria-label={ariaLabel}
      onChange={(e) => { if (e.target.value === CUSTOM) { setCustom(true); onChange(''); } else onChange(e.target.value); }}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {options.map((u) => <option key={u} value={u}>{u}</option>)}
      <option value={CUSTOM}>직접 입력…</option>
    </select>
  );
}
