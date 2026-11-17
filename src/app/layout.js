import localFont from 'next/font/local';
import './globals.css';
import SeasonalDecor from '@/components/SeasonalDecor';

// CDN @import(3단 직렬 로딩) 대신 self-host — 빌드 시 인라인 preload되어 첫 페인트가 빨라진다
const pretendard = localFont({
  src: './fonts/PretendardVariable.woff2',
  display: 'swap',
  weight: '45 920',
  variable: '--font-pretendard',
});

export const metadata = {
  title: 'Counter',
  description: '맥클린 사업장 운영 ERP',
  manifest: '/manifest.json',
  // 아이폰 "홈 화면에 추가" — 앱처럼 열려야 웹 푸시를 받을 수 있다
  appleWebApp: { capable: true, title: 'Counter', statusBarStyle: 'default' },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#3182f6',
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className={pretendard.variable} suppressHydrationWarning>
      <body><SeasonalDecor />{children}</body>
    </html>
  );
}
