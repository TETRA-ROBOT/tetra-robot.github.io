/** 브라우저에서 쓸 일 없는 node 모듈 (os, child_process, url, crypto, http) 의 최소 대역 */
export function tmpdir(): string { return '/tmp'; }
export function hostname(): string { return 'demo'; }
export function networkInterfaces(): Record<string, unknown> { return {}; }
export function execFileSync(): never { throw new Error('child_process is not available in the browser demo'); }
export function execSync(): never { throw new Error('child_process is not available in the browser demo'); }
export function spawn(): never { throw new Error('child_process is not available in the browser demo'); }
export function fileURLToPath(url: string | URL): string { return decodeURIComponent(new URL(String(url)).pathname); }
export function pathToFileURL(p: string): URL { return new URL(`file://${p}`); }
export function randomUUID(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export function randomBytes(size: number): Uint8Array { return globalThis.crypto.getRandomValues(new Uint8Array(size)); }
const misc = { tmpdir, hostname, networkInterfaces, execFileSync, execSync, spawn, fileURLToPath, pathToFileURL, randomUUID, randomBytes };
export default misc;
