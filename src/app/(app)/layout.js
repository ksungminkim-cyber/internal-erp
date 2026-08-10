import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppProvider } from '@/context/AppContext';
import { FeedbackProvider } from '@/context/FeedbackContext';
import { getMyContext } from '@/app/_actions/context';
import BottomNav from '@/components/BottomNav';
import Sidebar from '@/components/Sidebar';
import WelcomeModal from '@/components/WelcomeModal';
import AttendanceReminderBanner from '@/components/AttendanceReminderBanner';

export default async function AppLayout({ children }) {
  // profile + memberships 를 서비스롤로 로드 (RLS로 본인 멤버십이 누락돼
  // 출근/배정이 막히던 문제 방지). 본사면 전 사업장 가상 멤버십까지 포함.
  // user도 함께 반환받아 layout 자체의 auth.getUser() 왕복 제거.
  const { user, profile, memberships } = await getMyContext();
  if (!user) redirect('/login');

  // 쿠키에서 마지막 선택 사업장 읽기 → AppContext에 전달하여 SSR/클라이언트 hydration 일치
  const cookieStore = await cookies();
  const cookieWpId = cookieStore.get('erp_wp')?.value ?? null;
  const validCookieWp = cookieWpId
    ? memberships.find((m) => m.workplace_id === cookieWpId)
    : null;
  const initialWorkplaceId = validCookieWp?.workplace_id ?? memberships[0]?.workplace_id ?? null;

  return (
    <AppProvider
      initialUser={user}
      initialProfile={profile ?? null}
      initialMemberships={memberships}
      initialWorkplaceId={initialWorkplaceId}
    >
      <FeedbackProvider>
        <Sidebar />
        <div className="app-shell">
          <AttendanceReminderBanner />
          {children}
        </div>
        <BottomNav />
        <WelcomeModal />
      </FeedbackProvider>
    </AppProvider>
  );
}
