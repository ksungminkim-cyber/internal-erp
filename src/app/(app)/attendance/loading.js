import PageHeader from '@/components/PageHeader';

export default function AttendanceLoading() {
  return (
    <>
      <PageHeader title="근태" subtitle="버튼을 눌러 출/퇴근을 기록해요" />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* 상태 카드 */}
        <div className="skeleton" style={{ height: 220, borderRadius: 20 }} />
        {/* 매장 현황 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="skeleton" style={{ height: 20, width: 80, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 100, borderRadius: 14 }} />
        </div>
        {/* 오늘 기록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="skeleton" style={{ height: 20, width: 70, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
        </div>
      </main>
    </>
  );
}
