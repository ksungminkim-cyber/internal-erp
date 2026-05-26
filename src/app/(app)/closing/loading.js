import PageHeader from '@/components/PageHeader';

export default function ClosingLoading() {
  return (
    <>
      <PageHeader title="월 마감" subtitle="매출 · 인건비 · 지출 통합 손익" />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="skeleton" style={{ height: 70, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 260, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 200, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 160, borderRadius: 16 }} />
      </main>
    </>
  );
}
