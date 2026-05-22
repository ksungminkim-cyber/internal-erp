'use client';

import Link from 'next/link';
import { HelpCircle, X, ArrowRight, Lightbulb } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { getPageHelp } from '@/lib/pageHelp';

export default function HelpModal({ pathname, onClose }) {
  const help = getPageHelp(pathname);
  if (!help) return null;

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <HelpCircle size={18} />
        </div>
        <h2 className="h3" style={{ flex: 1 }}>{help.title}</h2>
        <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="닫기">
          <X size={18} />
        </button>
      </div>

      <p className="text-secondary" style={{ fontSize: 13.5, marginBottom: 14, lineHeight: 1.55 }}>
        {help.intro}
      </p>

      <div className="stack stack-2">
        {help.steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: 12,
              padding: 12,
              borderRadius: 12,
              background: 'var(--surface-soft)',
            }}
          >
            <span style={{
              flexShrink: 0,
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--accent)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800,
            }}>
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{s.title}</div>
              <div className="text-secondary" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {help.tip && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: '#fef3c7',
            borderLeft: '3px solid #f59e0b',
            color: '#78350f',
            fontSize: 12.5,
            lineHeight: 1.5,
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}
        >
          <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{help.tip}</span>
        </div>
      )}

      <Link
        href="/guide"
        onClick={onClose}
        className="btn btn-soft btn-block"
        style={{ marginTop: 16, justifyContent: 'center' }}
      >
        전체 사용 가이드 보기 <ArrowRight size={14} />
      </Link>
    </BottomSheet>
  );
}
