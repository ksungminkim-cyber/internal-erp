// src/app/api/read/route.js
import { NextResponse } from 'next/server';
import * as inventory from '@/app/(app)/inventory/actions';
import * as home from '@/app/(app)/home/actions';
import * as attendance from '@/app/(app)/attendance/actions';
import * as sales from '@/app/(app)/sales/actions';
import * as schedule from '@/app/(app)/schedule/actions';
import * as approvals from '@/app/(app)/approvals/actions';
import * as handover from '@/app/(app)/handover/actions';
import * as closing from '@/app/(app)/closing/actions';
import * as ads from '@/app/(app)/ads/actions';
import * as staffing from '@/app/(app)/staffing/actions';
import * as push from '@/app/_actions/push';
import * as names from '@/app/_actions/names';

// ─────────────────────────────────────────────────────────────────────────
// 화면 조회 전용 경로. 클라이언트의 src/lib/reads.js 가 부른다.
// 서버 액션은 브라우저가 하나씩 순서대로만 보내서 카드가 많은 화면이 느려졌다 → 조회는 fetch 로 동시에.
// 아래 목록에 있는 "읽기" 함수만 실행한다. 각 함수가 기존대로 로그인·권한을 직접 검사한다.
// 저장·수정·삭제 함수는 넣지 말 것 (그건 서버 액션으로).
//   POST { fn: string, args: any[] }  → { data } | { error }
// 세션 쿠키 필요 (proxy 가 비로그인 요청을 /login 으로 돌려보냄).
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const READS = {
  getOrderSuggestions: inventory.getOrderSuggestions,
  getIdleItems: inventory.getIdleItems,
  getPendingInbound: inventory.getPendingInbound,
  getInventoryItemHistory: inventory.getInventoryItemHistory,
  getProductUsage: inventory.getProductUsage,
  getTrendPicks: home.getTrendPicks,
  getPushConfig: push.getPushConfig,
  getProfileNames: names.getProfileNames,
  getMyShiftReminders: attendance.getMyShiftReminders,
  getTodayAttendance: attendance.getTodayAttendance,
  getMissingAttendance: attendance.getMissingAttendance,
  getSalesSummary: sales.getSalesSummary,
  getProductSales: sales.getProductSales,
  getSalesKpi: sales.getSalesKpi,
  getDaySalesDetail: sales.getDaySalesDetail,
  getSalesTips: sales.getSalesTips,
  getScheduleData: schedule.getScheduleData,
  getApprovals: approvals.getApprovals,
  getApproverCandidates: approvals.getApproverCandidates,
  getApprovalDetail: approvals.getApprovalDetail,
  getHandoverNotes: handover.getHandoverNotes,
  getClosingSourceData: closing.getClosingSourceData,
  getAdDashboard: ads.getAdDashboard,
  getAdLive: ads.getAdLive,
  getAdActions: ads.getAdActions,
  getAdSales: ads.getAdSales,
  getStaffingData: staffing.getStaffingData,
};

export async function POST(request) {
  // 다른 사이트에서 보낸 요청은 거절 (서버 액션이 하던 출처 검사와 같은 취지)
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const fn = body?.fn;
  const impl = typeof fn === 'string' && Object.prototype.hasOwnProperty.call(READS, fn) ? READS[fn] : null;
  if (typeof impl !== 'function') return NextResponse.json({ error: '알 수 없는 조회입니다.' }, { status: 400 });
  const args = Array.isArray(body.args) ? body.args : [];
  try {
    const data = await impl(...args);
    return NextResponse.json({ data });
  } catch (e) {
    console.error(`read ${fn}`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
