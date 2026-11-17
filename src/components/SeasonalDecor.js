// 시즌 한정 꾸미기 (크리스마스) — 기간이 지나면 저절로 꺼진다.
// 켜는 방식: <html data-season="xmas">. 색·장식은 전부 globals.css 의 [data-season="xmas"] 블록에 있다.
// 걷어낼 때: 이 파일, layout.js 의 <SeasonalDecor />, globals.css 의 "시즌 테마" 블록, brand-mark 클래스 두 곳.

const END = Date.UTC(2026, 11, 25, 15); // 2026-12-26 00:00 KST 부터 꺼짐

// 눈 배치 (왼쪽 %, 크기 px, 떨어지는 시간 s, 시작 지연 s, 옆으로 흐르는 정도 px) — 매번 같은 모양이 되도록 고정값.
// 10px 이상은 눈꽃 모양, 그보다 작으면 흰 점
const FLAKES = [
  [4, 14, 19, 0, 24], [10, 5, 23, 7, -12], [17, 6, 17, 3, 18], [24, 12, 26, 12, -20], [32, 4, 20, 5, 10],
  [39, 16, 22, 9, -26], [47, 5, 24, 1, 14], [54, 6, 18, 14, -10], [62, 13, 27, 6, 22], [69, 4, 19, 11, -16],
  [76, 5, 21, 2, 12], [83, 15, 20, 8, -24], [89, 6, 25, 13, 16], [95, 11, 23, 4, -14],
];

export default function SeasonalDecor() {
  return (
    <>
      {/* 첫 화면이 그려지기 전에 켜야 색이 깜빡이지 않는다 */}
      <script dangerouslySetInnerHTML={{ __html: `if(Date.now()<${END})document.documentElement.setAttribute('data-season','xmas')` }} />
      <div className="xmas-snow" aria-hidden="true">
        {FLAKES.map(([left, size, dur, delay, drift]) => (
          <i key={left} className={size >= 10 ? 'is-flake' : undefined} style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `-${delay}s`, '--drift': `${drift}px` }} />
        ))}
      </div>
    </>
  );
}
