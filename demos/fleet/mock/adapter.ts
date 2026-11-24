/**
 * axios 어댑터: 화면의 모든 axios 요청(/api/...)을 네트워크 대신 브라우저 안의 가짜 서버(router.ts)로 보낸다.
 * 진짜 서버처럼 조금 늦게 답하고, 4xx·5xx 는 axios 오류(AxiosError)로 던진다.
 */
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { handle } from './router';

function parseUrl(config: InternalAxiosRequestConfig): { path: string; query: Record<string, string> } {
  const u = new URL(config.url ?? '/', 'http://demo.local');
  const query: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (query[k] = v));
  const params = config.params as Record<string, unknown> | undefined;
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) query[k] = String(v);
  return { path: u.pathname, query };
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data ?? null;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockAdapter: AxiosAdapter = async (config) => {
  const { path, query } = parseUrl(config);
  const method = (config.method ?? 'get').toUpperCase();
  await delay(20 + Math.random() * 60);
  const { status, data } = await handle(method, path, query, parseBody(config.data));
  const isBlob = data instanceof Blob;
  let out: unknown = data;
  if (config.responseType === 'blob' && !isBlob) out = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const headers = new AxiosHeaders({ 'content-type': isBlob ? (data as Blob).type : 'application/json' });
  const response = { data: out, status, statusText: status < 400 ? 'OK' : 'Error', headers, config, request: { demo: true } };
  if (status >= 400) {
    throw new AxiosError(`Request failed with status code ${status}`, status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, response.request, response);
  }
  return response;
};

/** 전역 axios 와 앞으로 만들 axios 인스턴스 모두 가짜 서버로 */
export function installAxiosMock() {
  axios.defaults.adapter = mockAdapter;
  const create = axios.create.bind(axios);
  axios.create = ((cfg?: Parameters<typeof axios.create>[0]) => create({ ...(cfg ?? {}), adapter: mockAdapter })) as typeof axios.create;
}
