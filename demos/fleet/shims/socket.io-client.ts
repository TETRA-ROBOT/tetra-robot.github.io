/**
 * socket.io-client 대신 쓰는 가짜 클라이언트: 네트워크 없이 브라우저 안의 가짜 서버(mock/hub.ts)에 붙는다.
 * 화면(services/realtime.ts)이 쓰는 만큼만: io(), on/off/emit/removeAllListeners, connect/disconnect, connected,
 * 이벤트 'connect'·'disconnect'·'connect_error'.
 */
import { hub, type HubClient } from '../mock/hub';

type Listener = (...args: any[]) => void;

interface IoOptions {
  auth?: { token?: string } | ((cb: (data: unknown) => void) => void);
  autoConnect?: boolean;
  [key: string]: unknown;
}

let nextId = 1;

export class Socket implements HubClient {
  id: string | undefined = undefined;
  connected = false;
  disconnected = true;
  active = false;
  readonly io = { engine: { transport: { name: 'websocket' } }, on: () => undefined, off: () => undefined };
  private listeners = new Map<string, Set<Listener>>();
  private manualClose = false;

  constructor(private readonly opts: IoOptions = {}) {
    if (opts.autoConnect !== false) this.connect();
  }

  get auth() {
    return typeof this.opts.auth === 'object' ? this.opts.auth : {};
  }

  connect(): this {
    if (this.connected) return this;
    this.manualClose = false;
    this.active = true;
    // 진짜처럼 조금 뒤에 붙는다 (리스너 등록이 먼저 끝나게)
    setTimeout(() => {
      if (this.manualClose || this.connected) return;
      const problem = hub.attach(this, this.auth.token);
      if (problem) {
        this.active = false;
        this.fire('connect_error', new Error(problem));
        return;
      }
      this.id = `demo-${nextId++}`;
      this.connected = true;
      this.disconnected = false;
      this.fire('connect');
    }, 30);
    return this;
  }

  open(): this {
    return this.connect();
  }

  disconnect(): this {
    this.manualClose = true;
    this.active = false;
    if (this.connected) {
      hub.detach(this);
      this.connected = false;
      this.disconnected = true;
      this.fire('disconnect', 'io client disconnect');
    }
    return this;
  }

  close(): this {
    return this.disconnect();
  }

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  once(event: string, fn: Listener): this {
    const wrap: Listener = (...args) => {
      this.off(event, wrap);
      fn(...args);
    };
    return this.on(event, wrap);
  }

  off(event?: string, fn?: Listener): this {
    if (!event) this.listeners.clear();
    else if (!fn) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(fn);
    return this;
  }

  removeListener(event?: string, fn?: Listener): this {
    return this.off(event, fn);
  }

  removeAllListeners(event?: string): this {
    return this.off(event);
  }

  listenersAny() {
    return [];
  }

  hasListeners(event: string): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  emit(event: string, ...args: unknown[]): this {
    if (!this.connected) return this;
    const ack = typeof args[args.length - 1] === 'function' ? (args.pop() as Listener) : null;
    setTimeout(() => {
      hub.fromClient(this, event, args[0]);
      ack?.({ ok: true });
    }, 0);
    return this;
  }

  /** HubClient: 서버가 보낸 이벤트 */
  deliver(event: string, data: unknown) {
    setTimeout(() => {
      if (this.connected) this.fire(event, data);
    }, 0);
  }

  private fire(event: string, ...args: unknown[]) {
    [...(this.listeners.get(event) ?? [])].forEach((fn) => {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[demo socket] ${event} handler failed`, err);
      }
    });
  }
}

export function io(uriOrOpts?: string | IoOptions, maybeOpts?: IoOptions): Socket {
  const opts = (typeof uriOrOpts === 'object' ? uriOrOpts : maybeOpts) ?? {};
  return new Socket(opts);
}

export const connect = io;
export default io;
export type { Socket as SocketType };
