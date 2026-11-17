'use client';

import { usePathname } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import PageHeader from './PageHeader';
import { needsStore, splitWorkplaces } from '@/lib/hqView';

// 전체(본사) 보기에서 매장 하나의 자료를 보는 화면을 열면, 빈 화면 대신 매장을 먼저 고르게 한다.
// 어떤 화면이 여기에 해당하는지는 src/lib/hqView.js 의 needsStore.
export default function StoreRequired({ children }) {
  const pathname = usePathname();
  const { isHQView, memberships, switchWorkplace } = useApp();

  if (!isHQView || !needsStore(pathname)) return children;

  const { stores } = splitWorkplaces(memberships);
  return (
    <>
      <PageHeader title="매장을 골라 주세요" subtitle="이 화면은 매장별로 봅니다" />
      <main className="fade-in page-main">
        <div className="card">
          <p className="text-secondary" style={{ fontSize: 14, marginBottom: 14 }}>
            지금은 전체(본사) 보기입니다. 어느 매장을 볼까요?
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {stores.map((m) => (
              <button key={m.workplace_id} type="button" className="btn btn-primary" onClick={() => switchWorkplace(m.workplace_id)}>
                <Building2 size={16} /> {m.workplaces?.name}
              </button>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
