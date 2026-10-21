// src/components/TodayTodoCard.js
'use client';

import Link from 'next/link';
import { ListChecks, ChevronRight } from 'lucide-react';

/**
 * 홈 "오늘 할 일" — 흩어진 할 일을 한 카드에 한 줄씩. 0 건인 줄은 숨기고, 전부 0 이면 카드도 숨김.
 * props: inbox(내 결재 대기), handoverUnresolved, checklists [{ name, done, total, href }], inboundPending, stockAlerts
 */
export default function TodayTodoCard({ inbox = 0, handoverUnresolved = 0, checklists = [], inboundPending = 0, stockAlerts = 0 }) {
  const rows = [];
  for (const c of checklists) {
    if (c.total > 0 && c.done < c.total) rows.push({ href: c.href ?? '/checklists', label: /체크리스트/.test(c.name) ? c.name : `${c.name} 체크리스트`, meta: `${c.done}/${c.total}`, tone: 'neutral' });
  }
  if (inbox > 0) rows.push({ href: '/approvals', label: '내가 결재할 기안', meta: `${inbox}건`, tone: 'warn' });
  if (handoverUnresolved > 0) rows.push({ href: '/handover', label: '미확인 인수인계', meta: `${handoverUnresolved}건`, tone: 'warn' });
  if (inboundPending > 0) rows.push({ href: '/inventory', label: '입고 확인할 발주', meta: `${inboundPending}건`, tone: 'neutral' });
  if (stockAlerts > 0) rows.push({ href: '/inventory', label: '챙길 재고', meta: `${stockAlerts}품목`, tone: 'neutral' });
  if (rows.length === 0) return null;

  return (
    <section className="card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ListChecks size={16} color="var(--accent-strong)" />
        <div className="h3">오늘 할 일</div>
        <span className="num text-muted" style={{ fontSize: 12, fontWeight: 700 }}>{rows.length}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r, i) => (
          <li key={`${r.href}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
            <Link href={r.href} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', textDecoration: 'none', color: 'inherit' }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{r.label}</span>
              <span className="num" style={{ fontSize: 13, fontWeight: 800, color: r.tone === 'warn' ? '#c2410c' : 'var(--text-secondary)' }}>{r.meta}</span>
              <ChevronRight size={16} className="text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
