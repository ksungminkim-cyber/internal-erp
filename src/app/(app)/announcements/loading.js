import PageHeader from '@/components/PageHeader';

export default function AnnouncementsLoading() {
  return (
    <>
      <PageHeader title="공지사항" subtitle="전직원 공지" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 88, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
