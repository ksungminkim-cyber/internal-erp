// 페이지 재방문 시 이전 데이터를 즉시 보여주기 위한 메모리 캐시 (stale-while-revalidate).
// 모듈 레벨 Map — 클라이언트 네비게이션 간에는 유지되고, 새로고침하면 비워진다.
// 사용 패턴: useState 초기값으로 getPageCache(key) 사용 → load() 완료 후 setPageCache(key, data)
const cache = new Map();

export function getPageCache(key) {
  return cache.get(key) ?? null;
}

export function setPageCache(key, data) {
  cache.set(key, data);
}

// 로그아웃 등 컨텍스트가 바뀔 때 전체 무효화
export function clearPageCache() {
  cache.clear();
}
