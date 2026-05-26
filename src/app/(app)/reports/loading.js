import PageHeader from '@/components/PageHeader';

export default function ReportsLoading() {
  return (
    <>
      <PageHeader title="월별 리포트" subtitle="통합 대시보드" />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 100, borderRadius: 14 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 180, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
      </main>
    </>
  );
}
