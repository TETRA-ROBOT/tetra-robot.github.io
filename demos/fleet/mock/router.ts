/**
 * 가짜 서버의 주소 → 처리 함수 표. 모르는 주소는 GET 이면 비어 있는 값, 쓰기면 성공으로 답한다 (console.debug 로 남김).
 */
import { HttpError } from './events';

export interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  method: string;
  path: string;
}

/** 처리 결과: 값 그대로(200) 또는 { status, data } */
export type Reply = unknown;
type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(
    '^' +
      pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:([a-zA-Z_]+)/g, (_m, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ method: method.toUpperCase(), re, keys, handler });
}

export const get = (p: string, h: Handler) => route('GET', p, h);
export const post = (p: string, h: Handler) => route('POST', p, h);
export const put = (p: string, h: Handler) => route('PUT', p, h);
export const del = (p: string, h: Handler) => route('DELETE', p, h);

export const num = (v: string | undefined) => Number(v);
export function notFound(what = '대상'): never {
  throw new HttpError(404, `${what}을(를) 찾을 수 없습니다.`);
}

/** 데모에서 하지 않는 일 (실제 로봇·외부 시스템이 필요한 기능) */
export function demoOnly(feature: string): never {
  throw new HttpError(400, `데모 모드에서는 ${feature} 기능을 쓸 수 없습니다 (실제 로봇·서버가 필요합니다).`);
}

/** 모르는 GET 에 돌려줄 값: 목록 같은 이름이면 [], 아니면 {} */
function emptyFor(path: string): unknown {
  const last = path.split('/').filter(Boolean).pop() ?? '';
  if (/^\d+$/.test(last)) return {};
  if (/s$|logs$|history$|deliveries$|actions$|proposals$|backups$|doors$|lifts$/.test(last)) return [];
  return {};
}

export async function handle(method: string, path: string, query: Record<string, string>, body: unknown): Promise<{ status: number; data: unknown }> {
  const m = method.toUpperCase();
  for (const r of routes) {
    if (r.method !== m) continue;
    const match = r.re.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1])));
    try {
      const out = await r.handler({ params, query, body, method: m, path });
      if (out && typeof out === 'object' && '__status' in (out as object)) {
        const o = out as { __status: number; data: unknown };
        return { status: o.__status, data: o.data };
      }
      return { status: 200, data: out === undefined ? { ok: true } : out };
    } catch (err) {
      if (err instanceof HttpError) return { status: err.status, data: { error: err.message, ...(err.code ? { code: err.code } : {}) } };
      console.error('[demo] handler failed', m, path, err);
      return { status: 500, data: { error: (err as Error).message || '데모 서버 오류' } };
    }
  }
  if (m === 'GET') {
    console.debug('[demo] unknown GET → empty', path);
    return { status: 200, data: emptyFor(path) };
  }
  console.debug('[demo] unknown', m, path, '→ ok');
  return { status: 200, data: { ok: true } };
}

export const withStatus = (status: number, data: unknown) => ({ __status: status, data });
