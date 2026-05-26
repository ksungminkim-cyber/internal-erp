import PageHeader from '@/components/PageHeader';

export default function SalesLoading() {
  return (
    <>
      <PageHeader title="매출" subtitle="일별 매출 현황" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 오늘 매출 bento */}
        <div className="skeleton" style={{ height: 160, borderRadius: 20 }} />
        {/* 7일 요약 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="skeleton" style={{ height: 90, borderRadius: 16 }} />
          <div className="skeleton" style={{ height: 90, borderRadius: 16 }} />
        </div>
        {/* 차트 */}
        <div className="skeleton" style={{ height: 160, borderRadius: 16 }} />
        {/* 리스트 */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 66, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
