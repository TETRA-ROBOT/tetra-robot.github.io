/**
 * 가짜 서버의 Socket.IO 허브 (서버 lib/socket-hub.ts 흉내).
 * - 연결할 때 auth.token 을 확인한다 (틀리면 connect_error 'UNAUTHORIZED')
 * - broadcast 는 연결된 모든 화면 소켓에 보낸다. 값은 복사해서 보낸다 (화면이 받은 객체를 고쳐도 서버 상태가 바뀌지 않게)
 */

export interface HubClient {
  /** 서버 → 화면 이벤트 전달 */
  deliver(event: string, data: unknown): void;
}

type ClientHandler = (data: unknown, client: HubClient) => void;
type ConnectHandler = (client: HubClient) => void;

const clients = new Set<HubClient>();
const clientHandlers = new Map<string, ClientHandler>();
const connectHandlers: ConnectHandler[] = [];
let tokenCheck: (token: string | undefined) => string | null = () => null;

const copy = <T>(v: T): T => (v === undefined || v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as T));

export const hub = {
  /** 토큰 확인 함수: 문제가 있으면 오류 이름('UNAUTHORIZED' 등), 괜찮으면 null */
  setAuthenticator(fn: (token: string | undefined) => string | null) {
    tokenCheck = fn;
  },
  /** 화면 → 서버 이벤트 처리 (예: fleet:robot:jog) */
  onClientEvent(event: string, handler: ClientHandler) {
    clientHandlers.set(event, handler);
  },
  onConnection(handler: ConnectHandler) {
    connectHandlers.push(handler);
  },
  /** 화면 소켓이 붙을 때: 실패하면 오류 이름 */
  attach(client: HubClient, token: string | undefined): string | null {
    const problem = tokenCheck(token);
    if (problem) return problem;
    clients.add(client);
    connectHandlers.forEach((h) => h(client));
    return null;
  },
  detach(client: HubClient) {
    clients.delete(client);
  },
  fromClient(client: HubClient, event: string, data: unknown) {
    const h = clientHandlers.get(event);
    if (h) h(copy(data), client);
    else console.debug('[demo] socket event ignored:', event);
  },
  broadcast(event: string, data: unknown) {
    if (!clients.size) return;
    const json = JSON.stringify(data ?? null);
    clients.forEach((c) => c.deliver(event, JSON.parse(json)));
  },
  send(client: HubClient, event: string, data: unknown) {
    client.deliver(event, copy(data));
  },
  get clientCount() {
    return clients.size;
  },
};
