import './globals.css';

export const metadata = {
  title: '사내 ERP',
  description: '나울·녹턴 통합 근태·전자결재 플랫폼',
  manifest: '/manifest.json',
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
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
