/**
 * 클라이언트 supabase mutation 래퍼.
 * - 10초 timeout으로 hang 방지
 * - Promise 에러를 throw 대신 { error } 형태로 일관 처리
 */
export async function safeMutate(promise, timeoutMs = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('요청 시간 초과 — 새로고침 후 다시 시도해주세요.')), timeoutMs)
    ),
  ]);
}
