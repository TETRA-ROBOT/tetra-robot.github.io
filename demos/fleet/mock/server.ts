/**
 * 브라우저 안의 가짜 관제 서버를 띄운다: 처음 상태 → 주소 표 → 실시간 허브 인증 → 엔진(200ms).
 */
import { hub } from './hub';
import { seed } from './seed';
import { startEngine, engineHooks } from './engine';
import { autoCharge, demoWork, dispatch } from './dispatch';
import { requestSnapshot } from './events';
import { tokenExpiry } from './token';
import { installAxiosMock } from './adapter';
import { seedSimulation } from './simulation';
import './routes-core';
import './routes-missions';
import './routes-maps';
import './routes-admin';
import { allRobotViews } from './views';
import { startFleetSync } from './sync';

let started = false;

export function startMockServer() {
  if (started) return;
  started = true;
  seed();
  seedSimulation();
  installAxiosMock();
  hub.setAuthenticator((token) => {
    const exp = token ? tokenExpiry(token) : null;
    return exp && exp * 1000 > Date.now() ? null : 'UNAUTHORIZED';
  });
  hub.onConnection((c) => hub.send(c, 'fleet:robots:snapshot', allRobotViews()));
  engineHooks.onSecond = () => {
    dispatch();
    autoCharge();
    demoWork();
  };
  startEngine();
  startFleetSync();
  requestSnapshot();
}
