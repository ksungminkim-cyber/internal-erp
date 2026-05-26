import PageHeader from '@/components/PageHeader';

export default function InventoryLoading() {
  return (
    <>
      <PageHeader title="재고·발주" subtitle="식자재 · 비품 재고 관리" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="skeleton" style={{ height: 44, borderRadius: 12 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 72, borderRadius: 14 }} />
        ))}
      </main>
    </>
  );
}
