'use client';

import { useApp } from '@/context/AppContext';
import { Building2 } from 'lucide-react';

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

  return (
    <div className="segment">
      {memberships.map((m) => (
        <button
          key={m.workplace_id}
          type="button"
          className={`segment-item ${m.workplace_id === currentWorkplaceId ? 'is-active' : ''}`}
          onClick={() => switchWorkplace(m.workplace_id)}
        >
          {m.workplaces?.name}
        </button>
      ))}
    </div>
  );
}
