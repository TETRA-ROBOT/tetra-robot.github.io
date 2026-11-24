/** 데모 토큰(JWT 모양)의 만료 시각(초). 화면 stores/auth.ts 와 같은 읽기 */
export function tokenExpiry(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}
