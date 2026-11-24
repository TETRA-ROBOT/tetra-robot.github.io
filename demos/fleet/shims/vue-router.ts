/**
 * vue-router 감싸기: 원본은 createWebHistory 를 쓰지만 GitHub Pages 는 아무 주소나 index.html 로 돌려주지 않으므로
 * 해시 주소(#/monitor/home)로 바꾼다. 나머지는 진짜 vue-router 그대로 (vite.config 의 'vue-router-real' 별칭).
 */
// @ts-expect-error 별칭(vite.config.ts)으로만 풀리는 이름
export * from 'vue-router-real';
// @ts-expect-error 별칭(vite.config.ts)으로만 풀리는 이름
import { createWebHashHistory } from 'vue-router-real';

/** 원본 router/index.ts 의 createWebHistory() → 해시 주소 */
export function createWebHistory(base?: string) {
  return createWebHashHistory(base);
}
