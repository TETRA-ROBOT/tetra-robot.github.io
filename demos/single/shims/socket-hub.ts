/**
 * 브라우저 안에서 socket.io 서버와 클라이언트를 잇는 메모리 연결.
 * socket.io (서버) 는 mock/socket.ts 가 쓰는 만큼만, socket.io-client 는 app.vue 가 쓰는 만큼만 흉내 낸다.
 */
type Listener = (...args: any[]) => void;

class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, fn: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  once(event: string, fn: Listener): this {
    const wrapper: Listener = (...args) => { this.off(event, wrapper); fn(...args); };
    return this.on(event, wrapper);
  }
  off(event?: string, fn?: Listener): this {
    if (!event) this.listeners.clear();
    else if (!fn) this.listeners.delete(event);
    else this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== fn));
    return this;
  }
  removeListener(event: string, fn?: Listener): this { return this.off(event, fn); }
  removeAllListeners(event?: string): this { return this.off(event); }
  listenerCount(event: string): number { return this.listeners.get(event)?.length ?? 0; }
  hasListeners(event: string): boolean { return this.listenerCount(event) > 0; }
  protected fire(event: string, ...args: any[]): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try { fn(...args); } catch (error) { console.error(`[demo socket] listener for "${event}" failed`, error); }
    }
  }
}

// 네트워크를 거친 것처럼 내용을 복사하고 다음 차례에 전달한다
const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const later = (fn: () => void): void => { setTimeout(fn, 0); };

let nextId = 1;

/** 서버 쪽 소켓 (io.on('connection', socket => ...)) */
export class ServerSocket extends Emitter {
  readonly id = `demo-${nextId++}`;
  readonly handshake: { auth: Record<string, unknown>; query: Record<string, string>; headers: Record<string, string>; address: string };
  readonly data: Record<string, unknown> = {};
  connected = true;
  constructor(readonly server: FakeServer, readonly client: ClientSocket, auth: Record<string, unknown>) {
    super();
    this.handshake = { auth, query: {}, headers: {}, address: '127.0.0.1' };
  }
  emit(event: string, ...args: any[]): boolean {
    if (!this.connected) return false;
    const payload = clone(args);
    later(() => this.client.receive(event, payload));
    return true;
  }
  join(): void {}
  leave(): void {}
  to(): this { return this; }
  disconnect(): this {
    if (this.connected) this.client.serverDisconnect('io server disconnect');
    return this;
  }
  /** 클라이언트가 보낸 이벤트 */
  receive(event: string, args: any[]): void { this.fire(event, ...args); }
  closed(reason: string): void {
    this.connected = false;
    this.server.sockets.delete(this);
    this.fire('disconnect', reason);
  }
}

/** socket.io 의 Server 대역. 하나만 만들어진다고 본다 */
export class FakeServer extends Emitter {
  readonly sockets = new Set<ServerSocket>();
  readonly engine = { close: (): void => {} };
  constructor(..._args: unknown[]) {
    super();
    hub.server = this;
    for (const client of hub.waiting.splice(0)) client.tryConnect();
  }
  emit(event: string, ...args: any[]): boolean {
    for (const socket of this.sockets) socket.emit(event, ...args);
    return true;
  }
  to(): this { return this; }
  in(): this { return this; }
  disconnectSockets(_close?: boolean): void { for (const socket of [...this.sockets]) socket.disconnect(); }
  close(): void { this.disconnectSockets(); }
  attach(socket: ServerSocket): void {
    this.sockets.add(socket);
    this.fire('connection', socket);
  }
}

/** socket.io-client 의 Socket 대역 */
export class ClientSocket extends Emitter {
  id: string | undefined;
  connected = false;
  disconnected = true;
  readonly io = new Emitter();
  private serverSide: ServerSocket | null = null;
  constructor(readonly options: Record<string, any> = {}) {
    super();
    if (options.autoConnect !== false) this.connect();
  }
  get active(): boolean { return this.connected; }
  connect(): this {
    if (this.connected) return this;
    if (hub.server) later(() => this.tryConnect());
    else hub.waiting.push(this);
    return this;
  }
  open(): this { return this.connect(); }
  tryConnect(): void {
    if (this.connected || !hub.server) return;
    const finish = (auth: Record<string, unknown>) => {
      const server = hub.server!;
      this.serverSide = new ServerSocket(server, this, auth ?? {});
      this.id = this.serverSide.id;
      this.connected = true;
      this.disconnected = false;
      server.attach(this.serverSide);
      this.fire('connect');
    };
    const auth = this.options.auth;
    if (typeof auth === 'function') auth(finish);
    else finish(auth ?? {});
  }
  emit(event: string, ...args: any[]): this {
    // 마지막 인자가 함수면 ack 콜백이다. 서버 쪽 처리기가 부르면 클라이언트로 돌려준다
    const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const payload = clone(args);
    if (ack) payload.push((...reply: any[]) => later(() => ack(...clone(reply))));
    const target = this.serverSide;
    if (this.connected && target) later(() => target.receive(event, payload));
    return this;
  }
  send(...args: any[]): this { return this.emit('message', ...args); }
  receive(event: string, args: any[]): void { this.fire(event, ...args); }
  serverDisconnect(reason: string): void { this.close(reason); }
  disconnect(): this { this.close('io client disconnect'); return this; }
  close(reason = 'io client disconnect'): this {
    if (!this.connected) return this;
    const target = this.serverSide;
    this.connected = false;
    this.disconnected = true;
    this.serverSide = null;
    target?.closed(reason);
    this.fire('disconnect', reason);
    return this;
  }
  compress(): this { return this; }
  timeout(): this { return this; }
  onAny(): this { return this; }
  offAny(): this { return this; }
}

export const hub: { server: FakeServer | null; waiting: ClientSocket[] } = { server: null, waiting: [] };
