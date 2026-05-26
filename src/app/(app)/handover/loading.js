import PageHeader from '@/components/PageHeader';

export default function HandoverLoading() {
  return (
    <>
      <PageHeader title="인수인계" subtitle="교대 메모" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 80, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
