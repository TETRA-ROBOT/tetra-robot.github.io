/**
 * 데모 진입점: 브라우저 안의 가짜 관제 서버를 먼저 띄운 뒤(axios 어댑터·가짜 Socket.IO·가상 로봇 엔진)
 * 원본 화면(tetra-fleet-ui/src/main.ts)을 그대로 불러온다. 화면 코드는 고치지 않는다.
 */
import { startMockServer } from './mock/server';
import { mountDemoRibbon } from './ribbon';

startMockServer();
mountDemoRibbon();

void import('@fleet-ui/src/main.ts');
