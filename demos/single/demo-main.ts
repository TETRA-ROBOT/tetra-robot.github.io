/**
 * 정적 데모 진입점: 목업 백엔드를 먼저 설치한 다음 원본 앱(src/main.ts)을 불러온다.
 * proxy_handler.ts 의 axios.create 가 기본 어댑터를 복사하기 전에 설치해야 하므로 main 은 동적 import 로 부른다.
 */
import './shims/process-global';
import { installMockBackend } from './mock-backend';
import { mountDemoBanner } from './banner';

installMockBackend();
mountDemoBanner();
import('@/main');
