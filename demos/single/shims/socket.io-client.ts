/** `import io from 'socket.io-client'` 대역. 같은 페이지의 가짜 서버(mock/socket.ts)에 붙는다 */
import { ClientSocket } from './socket-hub';

export function io(uri?: unknown, options?: Record<string, any>): ClientSocket {
  const opts = (typeof uri === 'object' && uri !== null ? uri : options) as Record<string, any> | undefined;
  return new ClientSocket(opts ?? {});
}
export const connect = io;
export { ClientSocket as Socket };
export class Manager {}
export default io;
