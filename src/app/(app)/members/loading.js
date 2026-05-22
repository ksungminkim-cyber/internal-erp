import PageHeader from '@/components/PageHeader';

/** 직원 관리 SSR 데이터 로딩 중 즉시 표시되는 Suspense 폴백 */
export default function MembersLoading() {
  return (
    <>
      <PageHeader title="직원 관리" subtitle="회원가입한 직원에게 사업장·역할·시급 배정" hideSwitcher />
      <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <section className="stack stack-3">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 8 }} />
            <div className="skeleton" style={{ height: 20, width: 36, borderRadius: 20 }} />
          </div>
          <div className="skeleton" style={{ height: 80, borderRadius: 14 }} />
        </section>
        <section className="stack stack-3">
          <div className="skeleton" style={{ height: 22, width: 90, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 96, borderRadius: 14 }} />
          <div className="skeleton" style={{ height: 96, borderRadius: 14 }} />
          <div className="skeleton" style={{ height: 96, borderRadius: 14 }} />
        </section>
      </main>
    </>
  );
}
