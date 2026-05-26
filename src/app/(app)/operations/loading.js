import PageHeader from '@/components/PageHeader';

export default function OperationsLoading() {
  return (
    <>
      <PageHeader title="운영" subtitle="매장 운영의 모든 기능" />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 긴급 알림 */}
        <div className="skeleton" style={{ height: 90, borderRadius: 18 }} />
        {/* 섹션 1 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="skeleton" style={{ height: 20, width: 70, borderRadius: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 130, borderRadius: 16 }} />
            ))}
          </div>
        </div>
        {/* 섹션 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="skeleton" style={{ height: 20, width: 90, borderRadius: 8 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 130, borderRadius: 16 }} />
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
