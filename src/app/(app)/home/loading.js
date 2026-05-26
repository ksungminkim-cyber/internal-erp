export default function HomeLoading() {
  return (
    <main className="page-main" style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 20 }}>
      {/* 인사 + 날짜 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton" style={{ height: 36, width: 220, borderRadius: 10 }} />
        <div className="skeleton" style={{ height: 14, width: 140, borderRadius: 8 }} />
      </div>
      {/* 오늘 매출 큰 카드 */}
      <div className="skeleton" style={{ height: 120, borderRadius: 20 }} />
      {/* 2열 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="skeleton" style={{ height: 100, borderRadius: 16 }} />
        <div className="skeleton" style={{ height: 100, borderRadius: 16 }} />
      </div>
      {/* 날씨 */}
      <div className="skeleton" style={{ height: 170, borderRadius: 16 }} />
      {/* 바로가기 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton" style={{ height: 20, width: 60, borderRadius: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 90, borderRadius: 16 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
