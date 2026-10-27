import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // 새 토큰을 요청·응답 양쪽에 모두 반영
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // access_token 만료 시 내부적으로 자동 refresh → setAll 콜백으로 새 쿠키 반영됨
  // getClaims: JWT를 로컬 검증 (비대칭 키) — 매 요청 auth 서버 왕복 제거.
  // 라우트 보호 용도로만 사용하고, 실제 데이터 접근 권한은 layout/서버액션의 getUser가 재검증.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const url = request.nextUrl;
  const isAuthRoute = url.pathname.startsWith('/login') || url.pathname.startsWith('/auth');
  // /api/pos/toss/sync, /api/trends/refresh 는 pg_cron 서버 간 호출, /api/ads/publish 는 광고 모니터링 팀의 로컬 호출 —
  // 세션 대신 각 라우트의 비밀키 헤더(x-sync-secret / x-ads-secret)로 인증.
  // 다른 /api/pos/* (웹훅 등)는 자체 검증이 선택적이라 세션 보호를 유지한다.
  const isPublicRoute = url.pathname === '/' || url.pathname.startsWith('/_next') || url.pathname === '/manifest.json' || url.pathname === '/api/pos/toss/sync' || url.pathname === '/api/trends/refresh' || url.pathname === '/api/ads/publish';

  // 리다이렉트 시에도 갱신된 쿠키를 반드시 전달해야 무한 로그아웃 루프 방지
  const carryCookies = (redirect) => {
    response.cookies.getAll().forEach((c) => {
      redirect.cookies.set(c);
    });
    return redirect;
  };

  if (!user && !isAuthRoute && !isPublicRoute) {
    const redirectUrl = url.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', url.pathname);
    return carryCookies(NextResponse.redirect(redirectUrl));
  }

  if (user && isAuthRoute) {
    const redirectUrl = url.clone();
    redirectUrl.pathname = '/home';
    return carryCookies(NextResponse.redirect(redirectUrl));
  }

  return response;
}
