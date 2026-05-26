import PageHeader from '@/components/PageHeader';

export default function ApprovalsLoading() {
  return (
    <>
      <PageHeader title="전자결재" subtitle="지출결의서 · 시프트 · KPI 등 사내 결재" />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 탭 */}
        <div style={{ display: 'flex', gap: 8 }}>
          {['결재함', '내기안', '전체'].map((t) => (
            <div key={t} className="skeleton" style={{ height: 34, width: 60, borderRadius: 10 }} />
          ))}
        </div>
        {/* 카드 목록 */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 80, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
