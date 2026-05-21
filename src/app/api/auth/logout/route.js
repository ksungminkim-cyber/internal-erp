import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// 서버 측에서 signOut + cookie 제거 후 /login 으로 redirect.
// 클라이언트 JavaScript로는 HttpOnly cookie를 제거할 수 없어 server route 필요.
export async function POST(request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('server signOut error', e);
  }
  const url = new URL('/login', request.url);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request) {
  return POST(request);
}
