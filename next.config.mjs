/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
  // 모듈 변환 최소화 + 압축
  compress: true,
  // SSR 응답에 캐시 힌트
  poweredByHeader: false,
  // 이미지 최적화
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
