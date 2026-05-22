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
  const { data: { user } } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const isAuthRoute = url.pathname.startsWith('/login') || url.pathname.startsWith('/auth');
  const isPublicRoute = url.pathname === '/' || url.pathname.startsWith('/_next') || url.pathname === '/manifest.json';

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
