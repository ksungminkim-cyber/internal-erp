// 전체(본사) 홈의 "매장별 현황" — 조회한 원자료를 매장별 한 줄 요약으로 묶는다.

/**
 * stores: [{ id, name }] (본사 제외), today·yesterday: 'YYYY-MM-DD' (한국 날짜)
 * sales: sales_daily 행, boards: attendance_current_status 행, pending: 진행 중 결재 문서 행,
 * orderCounts: { 매장 id: 발주 권장 품목 수 }, vsUsual: { 매장 id: 평소 대비 % 또는 null }
 */
export function buildStoreOverview({ stores, today, yesterday, sales = [], boards = [], pending = [], orderCounts = {}, vsUsual = {} }) {
  const rows = stores.map((st) => {
    const mine = (list) => list.filter((r) => r.workplace_id === st.id);
    const day = (key) => mine(sales).find((r) => r.sales_date === key);
    return {
      id: st.id,
      name: st.name,
      todaySales: Number(day(today)?.total_amount ?? 0),
      todayCount: Number(day(today)?.transaction_count ?? 0),
      yesterdaySales: Number(day(yesterday)?.total_amount ?? 0),
      vsUsualPct: vsUsual[st.id] ?? null,
      working: mine(boards).filter((b) => b.status === 'working' || b.status === 'on_break').map((b) => b.name).filter(Boolean),
      pendingApprovals: mine(pending).length,
      orderCount: orderCounts[st.id] ?? 0,
    };
  });
  return {
    stores: rows,
    totalSales: rows.reduce((s, r) => s + r.todaySales, 0),
    totalCount: rows.reduce((s, r) => s + r.todayCount, 0),
  };
}
