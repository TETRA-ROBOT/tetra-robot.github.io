/** `import { Server } from 'socket.io'` 대역 (mock/socket.ts 용) */
import { FakeServer, ServerSocket } from './socket-hub';
export { FakeServer as Server, ServerSocket as Socket };
export default FakeServer;
