/**
 * 브라우저용 아주 작은 메모리 파일 시스템 (node:fs 대신).
 * mock/ 과 API 소스(SoundLibrary 등)가 쓰는 동기 함수만 흉내 낸다. 새로고침하면 처음 상태로 돌아간다.
 * 기본 소리 파일(api src/views/sound/*.mpeg)은 빌드 때 base64 로 넣어 두고 /api/src/views/sound 에 있는 것처럼 보인다
 * (vite.config.ts 가 API 소스의 import.meta.url 을 file:///api/... 로 바꾼다).
 */
import { Buffer } from 'buffer';
import builtinSounds from 'virtual:demo-builtin-sounds';

const files = new Map<string, Uint8Array | string>();
const dirs = new Set<string>(['/']);

function norm(p: string): string {
  const out: string[] = [];
  for (const part of String(p).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return '/' + out.join('/');
}
function parent(p: string): string { return norm(p + '/..'); }
function enoent(p: string): Error {
  const error = new Error(`ENOENT: no such file or directory, '${p}'`) as Error & { code: string };
  error.code = 'ENOENT';
  return error;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// 기본 소리 (vite.config.ts 의 가상 모듈이 파일 이름 → base64 로 넣어 준다)
for (const [name, base64] of Object.entries(builtinSounds)) {
  mkdirSync('/api/src/views/sound', { recursive: true });
  files.set(`/api/src/views/sound/${name}`, decodeBase64(base64));
}

export function existsSync(p: string): boolean {
  const n = norm(p);
  return files.has(n) || dirs.has(n);
}
export function mkdirSync(p: string, _options?: unknown): void {
  let n = norm(p);
  while (!dirs.has(n)) { dirs.add(n); n = parent(n); }
}
export function mkdtempSync(prefix: string): string {
  const p = norm(prefix + Math.random().toString(36).slice(2, 8));
  mkdirSync(p);
  return p;
}
export function readFileSync(p: string, options?: string | { encoding?: string }): any {
  const n = norm(p);
  if (!files.has(n)) throw enoent(p);
  const data = files.get(n)!;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (encoding) return typeof data === 'string' ? data : new TextDecoder().decode(data);
  return typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
}
export function writeFileSync(p: string, content: Uint8Array | string, _options?: unknown): void {
  const n = norm(p);
  mkdirSync(parent(n));
  files.set(n, typeof content === 'string' ? content : new Uint8Array(content));
}
export function rmSync(p: string, options?: { force?: boolean }): void {
  const n = norm(p);
  if (!files.delete(n) && !dirs.delete(n) && !options?.force) throw enoent(p);
}
export const unlinkSync = (p: string): void => rmSync(p);
export function renameSync(from: string, to: string): void {
  const a = norm(from);
  if (!files.has(a)) throw enoent(from);
  writeFileSync(to, files.get(a)!);
  files.delete(a);
}
export function statSync(p: string): { size: number; mtimeMs: number; isFile(): boolean; isDirectory(): boolean } {
  const n = norm(p);
  if (!existsSync(n)) throw enoent(p);
  const data = files.get(n);
  const size = data === undefined ? 0 : typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  return { size, mtimeMs: Date.now(), isFile: () => data !== undefined, isDirectory: () => data === undefined };
}
export function readdirSync(p: string): string[] {
  const n = norm(p);
  const prefix = n === '/' ? '/' : n + '/';
  const names = new Set<string>();
  for (const key of [...files.keys(), ...dirs]) {
    if (key.startsWith(prefix) && key !== n) names.add(key.slice(prefix.length).split('/')[0]);
  }
  return [...names];
}

const fs = { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync, renameSync, statSync, readdirSync };
export const promises = {};
export default fs;
