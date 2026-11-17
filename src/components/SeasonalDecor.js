// 시즌 한정 꾸미기 (크리스마스) — 기간이 지나면 저절로 꺼진다.
// 켜는 방식: <html data-season="xmas">. 색·장식은 전부 globals.css 의 [data-season="xmas"] 블록에 있다.
// 걷어낼 때: 이 파일, layout.js 의 <SeasonalDecor />, globals.css 의 "시즌 테마" 블록, brand-mark 클래스 두 곳.

const END = Date.UTC(2026, 11, 25, 15); // 2026-12-26 00:00 KST 부터 꺼짐

// 눈송이 배치 (왼쪽 %, 크기 px, 떨어지는 시간 s, 시작 지연 s, 옆으로 흐르는 정도 px) — 매번 같은 모양이 되도록 고정값
const FLAKES = [
  [3, 6, 15, 0, 18], [9, 4, 21, 7, -12], [16, 7, 17, 3, 22], [23, 5, 24, 12, -16], [31, 4, 19, 5, 10],
  [38, 8, 16, 9, -20], [46, 5, 22, 1, 14], [53, 6, 18, 14, -10], [61, 4, 25, 6, 20], [68, 7, 17, 11, -18],
  [75, 5, 20, 2, 12], [82, 8, 15, 8, -22], [88, 4, 23, 13, 16], [94, 6, 19, 4, -14], [98, 5, 21, 10, 8],
];

export default function SeasonalDecor() {
  return (
    <>
      {/* 첫 화면이 그려지기 전에 켜야 색이 깜빡이지 않는다 */}
      <script dangerouslySetInnerHTML={{ __html: `if(Date.now()<${END})document.documentElement.setAttribute('data-season','xmas')` }} />
      <div className="xmas-snow" aria-hidden="true">
        {FLAKES.map(([left, size, dur, delay, drift]) => (
          <i key={left} style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `-${delay}s`, '--drift': `${drift}px` }} />
        ))}
      </div>
    </>
  );
}
