'use client';

import { useApp } from '@/context/AppContext';
import { Building2 } from 'lucide-react';
import { splitWorkplaces } from '@/lib/hqView';

export default function WorkplaceSwitcher() {
  const { memberships, currentWorkplaceId, switchWorkplace, currentWorkplace } = useApp();

  if (!memberships?.length) {
    return (
      <span className="tag tag-warning lg">
        <Building2 size={12} /> 사업장 미배정
      </span>
    );
  }

  if (memberships.length === 1) {
    return (
      <span className="tag tag-accent lg dot">
        {currentWorkplace?.name}
      </span>
    );
  }

  const { hq, stores } = splitWorkplaces(memberships);

  return (
    <div className="segment">
      {[...(hq ? [hq] : []), ...stores].map((m) => (
        <button
          key={m.workplace_id}
          type="button"
          className={`segment-item ${m.workplace_id === currentWorkplaceId ? 'is-active' : ''}`}
          onClick={() => switchWorkplace(m.workplace_id)}
        >
          {m === hq ? '전체' : m.workplaces?.name}
        </button>
      ))}
    </div>
  );
}
