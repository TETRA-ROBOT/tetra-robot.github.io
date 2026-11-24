/**
 * 브라우저 안 목업 백엔드.
 * - axios: 기본 어댑터를 바꿔 백엔드 경로(__DEMO_BACKEND_ROUTES__, 원본 vite.config.ts 의 backendRoutes)를
 *   mock/routes.ts 의 handleMockRequest 로 답한다. axios.create 는 만들 때 기본값을 복사하므로 앱 모듈보다 먼저 설치한다.
 * - fetch, <img>/<audio> 의 src, new Audio(): 같은 경로를 목업 응답(blob URL)으로 바꾼다.
 * - 소켓: mock/socket.ts 의 attachMockSocket 을 가짜 socket.io 서버(shims/socket-hub.ts)로 돌린다.
 */
import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { handleMockRequest, type MockResponse } from '@mock/routes';
import { attachMockSocket } from '@mock/socket';
import { installWorld, observeRequest, overrideRequest, pickRobot } from './world';

declare const __DEMO_BACKEND_ROUTES__: string[];
const BACKEND_ROUTES: string[] = __DEMO_BACKEND_ROUTES__;
const LATENCY_MS = 30;

export function isBackendPath(path: string): boolean {
  return BACKEND_ROUTES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** 앱이 쓰는 주소(/map/list, http://host/map/list)를 백엔드 경로로 본다. 다른 출처나 상대 경로는 null */
function backendUrl(raw: string): URL | null {
  if (typeof raw !== 'string' || raw.startsWith('blob:') || raw.startsWith('data:')) return null;
  let url: URL;
  try { url = new URL(raw, window.location.origin); } catch { return null; }
  if (url.origin !== window.location.origin) return null;
  // 절대 경로(/map/...)로 쓴 것만 대신 답한다. 데모 자체 파일(./assets/...)과 겹치지 않게 한다
  if (!raw.startsWith('/') && !raw.startsWith(window.location.origin + '/')) return null;
  return isBackendPath(url.pathname) ? url : null;
}

function parseBody(data: unknown, contentType: string): Record<string, any> {
  if (data == null || data === '') return {};
  if (typeof FormData !== 'undefined' && data instanceof FormData) {
    const out: Record<string, any> = {};
    data.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (data instanceof URLSearchParams) return Object.fromEntries(data);
  if (typeof data === 'string') {
    if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(data));
    try { return JSON.parse(data); } catch { return {}; }
  }
  if (typeof data === 'object') return JSON.parse(JSON.stringify(data));
  return {};
}

function call(method: string, url: URL, body: Record<string, any>): MockResponse {
  try {
    const request = { method: method.toUpperCase(), path: url.pathname, query: Object.fromEntries(url.searchParams), body };
    // 같은 현장(창고) 데모: 지도 격자는 원본보다 먼저 답하고, 이동·취소는 데모 로봇에도 알린다 (world/)
    observeRequest(request.method, request.path);
    return overrideRequest(request.method, request.path, () => handleMockRequest(request)) ?? handleMockRequest(request);
  } catch (error) {
    console.error('[demo mock] handler failed', method, url.pathname, error);
    return { status: 500, body: { success: false, message: String(error) } };
  }
}

const isBinary = (body: unknown): body is Uint8Array => body instanceof Uint8Array;
const contentTypeOf = (result: MockResponse): string => result.contentType ?? 'application/json; charset=utf-8';

/** 응답 본문을 Blob 으로 (blob URL·fetch 용) */
function toBlob(result: MockResponse): Blob {
  const type = contentTypeOf(result);
  if (isBinary(result.body)) return new Blob([result.body as Uint8Array<ArrayBuffer>], { type });
  if (typeof result.body === 'string') return new Blob([result.body], { type });
  return new Blob([JSON.stringify(result.body)], { type });
}

const mockAdapter = (fallback: AxiosAdapter): AxiosAdapter => async (config: InternalAxiosRequestConfig) => {
  const raw = config.baseURL && !/^[a-z]+:\/\//i.test(config.url ?? '')
    ? `${config.baseURL.replace(/\/+$/, '')}/${String(config.url ?? '').replace(/^\/+/, '')}`
    : String(config.url ?? '');
  const url = backendUrl(raw);
  if (!url) return fallback(config);
  if (config.params) {
    const params = config.params instanceof URLSearchParams ? config.params : Object.entries(config.params);
    for (const [key, value] of params as Iterable<[string, unknown]>) {
      if (value === undefined || value === null) continue;
      url.searchParams.append(key, Array.isArray(value) ? value.join(',') : typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
  }
  const headers = AxiosHeaders.from(config.headers as any);
  const method = (config.method ?? 'get').toUpperCase();
  const result = call(method, url, parseBody(config.data, String(headers.get('Content-Type') ?? '')));
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

  const status = result.status ?? 200;
  let data: unknown;
  if (config.responseType === 'blob') data = toBlob(result);
  else if (config.responseType === 'arraybuffer') data = await toBlob(result).arrayBuffer();
  else if (isBinary(result.body)) data = new TextDecoder().decode(result.body);
  else if (typeof result.body === 'string') data = result.body;
  else data = JSON.stringify(result.body); // 문자열로 넘겨 axios 가 파싱하게 한다 (목업 데이터가 앱에서 바뀌지 않게 복사도 된다)

  const response = {
    data,
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: new AxiosHeaders({ 'content-type': contentTypeOf(result) }),
    config,
    request: { responseURL: url.href, status },
  };
  const validate = config.validateStatus;
  if (!validate || validate(status)) return response;
  throw new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    response.request,
    response as any,
  );
};

/** 동기로 목업 응답을 blob URL 로 (img·audio src). 같은 주소는 다시 만들지 않는다 */
const blobUrls = new Map<string, string>();
function mockObjectUrl(raw: string): string | null {
  const url = backendUrl(raw);
  if (!url) return null;
  const key = url.pathname + url.search;
  const cached = blobUrls.get(key);
  if (cached) return cached;
  const result = call('GET', url, {});
  if ((result.status ?? 200) >= 400) return null;
  const objectUrl = URL.createObjectURL(toBlob(result));
  blobUrls.set(key, objectUrl);
  if (blobUrls.size > 50) {
    const [oldKey, oldUrl] = blobUrls.entries().next().value!;
    blobUrls.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
  return objectUrl;
}

function patchSrc(proto: any): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
  if (!descriptor?.set) return;
  Object.defineProperty(proto, 'src', {
    ...descriptor,
    set(value: string) { descriptor.set!.call(this, mockObjectUrl(value) ?? value); },
  });
}

function patchDom(): void {
  patchSrc(HTMLImageElement.prototype);
  patchSrc(HTMLMediaElement.prototype);
  patchSrc(HTMLSourceElement.prototype);
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (name.toLowerCase() === 'src' && /^(IMG|AUDIO|VIDEO|SOURCE)$/.test(this.tagName)) {
      return setAttribute.call(this, name, mockObjectUrl(String(value)) ?? value);
    }
    return setAttribute.call(this, name, value);
  };
  const NativeAudio = window.Audio;
  const DemoAudio = function (src?: string) {
    const audio = new NativeAudio();
    if (src !== undefined) audio.src = src;
    return audio;
  } as unknown as typeof Audio;
  DemoAudio.prototype = NativeAudio.prototype;
  window.Audio = DemoAudio;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = backendUrl(raw);
    if (!url) return nativeFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const result = call(method, url, parseBody(init?.body, headers.get('content-type') ?? ''));
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    return new Response(toBlob(result), { status: result.status ?? 200, headers: { 'content-type': contentTypeOf(result) } });
  };
}

export function installMockBackend(): void {
  const fallback = axios.getAdapter(axios.defaults.adapter ?? ['xhr', 'fetch']);
  axios.defaults.adapter = mockAdapter(fallback);
  patchDom();
  // 원본 목업 데이터를 멀티관제 데모와 같은 창고 현장으로 바꾼 뒤 소켓을 붙인다 (소켓이 붙을 때 상태 추적 기록을 채운다)
  const reseedLogs = installWorld(pickRobot());
  // mock/socket.ts 는 HTTP 서버를 받지만 가짜 서버는 쓰지 않는다
  attachMockSocket({} as never);
  reseedLogs();
  // PWA 서비스 워커(/sw.js)는 데모에서 등록하지 않는다 (사이트 루트에 걸리면 다른 페이지까지 영향)
  if ('serviceWorker' in navigator) {
    try {
      Object.defineProperty(navigator.serviceWorker, 'register', { value: () => Promise.resolve(undefined), configurable: true });
    } catch { /* 무시 */ }
  }
}
