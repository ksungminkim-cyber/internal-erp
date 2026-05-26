import PageHeader from '@/components/PageHeader';

export default function ChecklistsLoading() {
  return (
    <>
      <PageHeader title="체크리스트" subtitle="오픈·마감 루틴을 매일 체크" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 96, borderRadius: 16 }} />
        ))}
      </main>
    </>
  );
}
