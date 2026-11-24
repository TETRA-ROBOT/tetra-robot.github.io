/** mock/ 과 API 소스가 모듈을 읽을 때 쓰는 process·Buffer 전역. 다른 모듈보다 먼저 불러야 한다 */
import { Buffer } from 'buffer';

const g = globalThis as any;
if (!g.process) g.process = { env: {}, pid: 1, platform: 'browser', cwd: () => '/', nextTick: (fn: () => void) => queueMicrotask(fn) };
else if (!g.process.env) g.process.env = {};
if (!g.Buffer) g.Buffer = Buffer;
