import PageHeader from '@/components/PageHeader';

export default function ScheduleLoading() {
  return (
    <>
      <PageHeader title="시프트" subtitle="근무 일정" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 주/월 네비 */}
        <div className="skeleton" style={{ height: 60, borderRadius: 14 }} />
        {/* 탭 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="skeleton" style={{ height: 32, width: 56, borderRadius: 10 }} />
          <div className="skeleton" style={{ height: 32, width: 56, borderRadius: 10 }} />
        </div>
        {/* 주간 카드 7개 */}
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 52, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
