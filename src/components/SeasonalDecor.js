// 시즌 한정 꾸미기 — 날짜에 맞춰 저절로 켜지고 꺼진다.
// 켜는 방식: <html data-season="xmas | newyear">. 색·장식은 전부 globals.css 의 "시즌 테마" 블록들에 있다.
// 미리 보기: 주소 끝에 ?season=newyear (또는 xmas, off) 를 붙이면 날짜와 상관없이 그 화면으로 열린다.
// 걷어낼 때: 이 파일, layout.js 의 <SeasonalDecor />, globals.css 의 "시즌 테마" 블록들, brand-mark 클래스 두 곳.

const XMAS_END = Date.UTC(2026, 11, 31, 15);   // 크리스마스: 2026-12-31 까지 (KST)
const NEWYEAR_END = Date.UTC(2027, 0, 10, 15); // 새해: 2027-01-01 ~ 01-10 (KST)

const PICK = `(function(){var m=location.search.match(/[?&]season=(xmas|newyear|off)/),t=Date.now(),s=m?m[1]:t<${XMAS_END}?'xmas':t<${NEWYEAR_END}?'newyear':'off';if(s!=='off')document.documentElement.setAttribute('data-season',s)})()`;

// 떠다니는 장식 배치 (왼쪽 %, 크기 px, 움직이는 시간 s, 시작 지연 s, 옆으로 흐르는 정도 px) — 매번 같은 모양이 되도록 고정값.
// 크리스마스: 눈 (10px 이상은 눈꽃 모양, 그보다 작으면 흰 점). 새해: 제자리에서 반짝이는 금빛
const BITS = [
  [4, 14, 19, 0, 24], [10, 5, 23, 7, -12], [17, 6, 17, 3, 18], [24, 12, 26, 12, -20], [32, 4, 20, 5, 10],
  [39, 16, 22, 9, -26], [47, 5, 24, 1, 14], [54, 6, 18, 14, -10], [62, 13, 27, 6, 22], [69, 4, 19, 11, -16],
  [76, 5, 21, 2, 12], [83, 15, 20, 8, -24], [89, 6, 25, 13, 16], [95, 11, 23, 4, -14],
];

export default function SeasonalDecor() {
  return (
    <>
      {/* 첫 화면이 그려지기 전에 켜야 색이 깜빡이지 않는다 */}
      <script dangerouslySetInnerHTML={{ __html: PICK }} />
      <div className="season-fx" aria-hidden="true">
        {BITS.map(([left, size, dur, delay, drift], i) => (
          <i key={left} className={size >= 10 ? 'is-flake' : undefined}
            style={{ left: `${left}%`, '--top': `${(i * 37 + 11) % 82 + 8}%`, '--size': `${size}px`, '--dur': `${dur}s`, '--delay': `-${delay}s`, '--drift': `${drift}px` }} />
        ))}
      </div>
    </>
  );
}
