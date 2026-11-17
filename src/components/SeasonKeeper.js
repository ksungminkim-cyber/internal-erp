'use client';

import { useLayoutEffect } from 'react';
import { pickSeason, XMAS_END, NEWYEAR_END } from '@/lib/season';

// 화면이 뜬 뒤 <html data-season> 을 한 번 더 건다.
// 서버가 보낸 화면과 브라우저가 그린 화면이 달라 React 가 문서를 처음부터 다시 그리면
// <html> 의 속성이 전부 지워져서(인라인 스크립트가 걸어 둔 것 포함) 테마가 꺼지기 때문.
export default function SeasonKeeper() {
  useLayoutEffect(() => {
    const s = pickSeason(window.location.search, Date.now(), XMAS_END, NEWYEAR_END);
    if (s !== 'off') document.documentElement.setAttribute('data-season', s);
  }, []);
  return null;
}
