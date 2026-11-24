/**
 * 싱글관제 데모 로봇의 위치·배터리를 원본 목업 대신 정한다.
 * - 혼자 열었을 때: route-sim.ts 가 창고 통로를 따라 일한다.
 * - 멀티관제 데모에서 "로봇 화면 열기"로 열었을 때: 그 탭이 BroadcastChannel 로 보내는 같은 로봇의 상태를 그대로 따라 한다.
 *   3초 넘게 소식이 없으면(멀티관제 탭을 닫음) 마지막 자리에서 혼자 일하기로 돌아간다.
 *
 * 원본 목업(mock/socket.ts)은 1초마다 status.robot_x 등을 원 위 자리로 덮어쓰고 robot:tf 를 보낸다.
 * 그래서 status 의 위치·배터리 칸을 읽기 전용 접근자로 바꾸고(원본이 쓰는 값은 버림), 나가는 소켓 이벤트도 지금 값으로 바꿔 끼운다.
 */
import { status, statusLogs } from '@mock/data';
import { mockActivity } from '@mock/route-graph';
import { hub } from '../shims/socket-hub';
import { FLEET_SYNC_CHANNEL, FLEET_SYNC_STALE_MS, PLACES, type FleetSyncMessage, type FleetSyncRobot, type RosterRobot } from '../../shared/world';
import { RouteSim } from './route-sim';

type Row = Record<string, any>;

const SIM_MS = 100;
const EMIT_MS = 200;

let sim: RouteSim;
let mirror: { robot: FleetSyncRobot; at: number } | null = null;
let lastLed = '';
let lastPlanKey = '';
let planTicks = 0;
const mirrorListeners: Array<(robot: FleetSyncRobot | null) => void> = [];

const mirroring = (): FleetSyncRobot | null => (mirror && Date.now() - mirror.at < FLEET_SYNC_STALE_MS ? mirror.robot : null);

interface View {
  x: number;
  y: number;
  yaw: number;
  battery: number;
  speed: number;
  charging: boolean;
  moving: boolean;
  path: Array<[number, number]>;
}

function view(): View {
  const m = mirroring();
  if (m) {
    return { x: m.x, y: m.y, yaw: m.yaw, battery: m.battery, speed: m.speed, charging: m.state === 'charging', moving: m.state === 'going' || m.speed > 0.02, path: m.path };
  }
  return {
    x: sim.x, y: sim.y, yaw: sim.yaw, battery: Math.round(sim.battery), speed: sim.speed, charging: sim.charging,
    moving: sim.mode === 'drive', path: sim.mode === 'drive' ? sim.path.map((p) => [p.x, p.y] as [number, number]) : [],
  };
}

const tf = (v: View): Row => ({ translation: { x: v.x, y: v.y, z: 0 }, rotation: { x: 0, y: 0, z: Math.sin(v.yaw / 2), w: Math.cos(v.yaw / 2) }, load: 0 });

// 실제 API led-manager.ts 와 같은 이름·색 (충전 > 자율 이동 > 대기)
function led(v: View): Row {
  if (v.charging) return { color: 'PURPLE', pattern: 'BLINK', category: 'CRITICAL', name: '배터리 충전 중', description: '충전 중 상태 (점멸)' };
  if (v.moving) return { color: 'GREEN', pattern: 'SOLID', category: 'INTENT', name: '자율 이동', description: '목적지로 자율 이동 중 (점등)' };
  return { color: 'CYAN', pattern: 'BLINK', category: 'IDLE', name: '대기 상태', description: '대기 상태 (점멸)' };
}

/** robot:globalPlan 모양 (nav_msgs/Path 의 poses). 빈 배열이면 화면이 선을 지운다 */
function plan(v: View): Row {
  const points = v.path.length ? [[v.x, v.y], ...v.path] : [];
  return { globalPlan: points.map(([x, y]) => ({ pose: { position: { x, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } })) };
}

/** 원본이 status 에 쓰는 위치·배터리는 버리고 지금 값을 읽게 한다 */
function installStatusAccessors(): void {
  const fields: Record<string, () => number> = {
    robot_x: () => view().x,
    robot_y: () => view().y,
    robot_qz: () => Math.sin(view().yaw / 2),
    robot_qw: () => Math.cos(view().yaw / 2),
    battery: () => view().battery,
    total_distance_m: () => Math.round(sim.odometer * 100) / 100,
    charge_current: () => (view().charging ? 2.4 : 0),
  };
  for (const [name, read] of Object.entries(fields)) {
    if (!(name in status)) throw new Error(`[demo world] 원본 목업 status 에 ${name} 이 없습니다`);
    Object.defineProperty(status, name, { get: read, set: () => undefined, enumerable: true, configurable: true });
  }
}

/** 나가는 소켓 이벤트 중 위치·배터리·LED·충전기 보호 구역을 이 현장 값으로 바꾼다 */
function outgoing(event: string, args: any[]): any[] | null {
  const v = view();
  switch (event) {
    case 'robot:tf': return [tf(v)];
    case 'robot:battery': return [{ battery: v.battery }];
    case 'robot:speed': return [{ speed: v.speed }];
    case 'robot:odometer': return [{ total_distance_m: status.total_distance_m }];
    case 'robot:led': return [led(v)];
    case 'robot:dockKeepout': {
      // 원본 목업은 사무실 지도 밖(태그 7)에 구역 하나를 더 그린다. 등록된 충전소 구역만 남기고, 일부러 넣은 어긋남 경고도 뺀다
      const data = args[0] as Row | undefined;
      if (!data || !Array.isArray(data.boxes)) return args;
      return [{ ...data, boxes: data.boxes.filter((b: Row) => b.source === 'registered').map((b: Row) => ({ ...b, mismatch_m: null })) }];
    }
    default: return args;
  }
}

function emitNow(): void {
  const server = hub.server;
  if (!server) return;
  const v = view();
  server.emit('robot:tf', tf(v));
  const ledState = led(v);
  if (ledState.name !== lastLed) {
    lastLed = ledState.name;
    server.emit('robot:led', ledState);
  }
  // 경로: 바뀌면 바로, 아니면 1초마다 (선의 시작이 로봇을 따라오게. 실제 API 는 /plan 을 0.5초마다 보낸다)
  const planKey = v.path.length ? `${v.path.length}:${v.path[v.path.length - 1].join(',')}` : '';
  planTicks += 1;
  if (planKey !== lastPlanKey || (planKey && planTicks >= 1000 / EMIT_MS)) {
    lastPlanKey = planKey;
    planTicks = 0;
    server.emit('robot:globalPlan', plan(v));
  }
}

function listenFleet(robotId: number): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(FLEET_SYNC_CHANNEL);
  channel.onmessage = (event: MessageEvent<FleetSyncMessage>) => {
    const robot = event.data?.kind === 'fleet-robots' ? event.data.robots.find((r) => r.id === robotId) : undefined;
    if (!robot) return;
    const wasMirroring = !!mirroring();
    mirror = { robot, at: Date.now() };
    if (!wasMirroring) mirrorListeners.forEach((fn) => fn(robot));
  };
}

/** 혼자 일하던 지난 한 시간쯤의 자리로 원본이 채운 상태 추적 기록의 위치를 바꾼다 (원 위 한 점이 아니라 통로 위 자취가 보이게) */
function reseedStatusLogs(robot: RosterRobot, modelKey: string): void {
  const past = new RouteSim(robot, modelKey);
  for (let i = statusLogs.length - 1; i >= 0; i--) {
    for (let t = 0; t < 17; t += 0.5) past.step(0.5);
    const row = statusLogs[i];
    row.robot_x = past.x;
    row.robot_y = past.y;
    row.robot_theta = Math.round((past.yaw * 180) / Math.PI * 10) / 10;
    row.battery = Math.round(past.battery);
  }
}

/** 화면에서 보낸 이동·취소를 혼자 도는 로봇에도 반영한다 (멀티관제를 따라 하는 동안은 따라 하기가 우선) */
export function observeRequest(method: string, path: string): void {
  if (mirroring()) return;
  const to = /^\/nav\/to\/(\d+)$/.exec(path);
  if (method === 'PUT' && to) {
    const place = PLACES[Number(to[1]) - 1];
    if (place) sim.goTo(place.name);
  } else if (method === 'PUT' && path === '/nav/cancel') {
    sim.hold(15);
  }
}

/** 따라 하기를 시작·끝낼 때 (데모 띠 문구) */
export function onMirrorChange(listener: (robot: FleetSyncRobot | null) => void): void {
  mirrorListeners.push(listener);
}

/** 원본 목업 소켓을 붙이기 전에 부른다 (상태 추적 기록을 채울 때부터 이 현장 위치를 쓰게) */
export function installDrive(robot: RosterRobot, modelKey: string): () => void {
  sim = new RouteSim(robot, modelKey);
  installStatusAccessors();
  hub.outgoing = outgoing;
  listenFleet(robot.id);
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    const m = mirroring();
    if (m) {
      sim.resumeFrom(m);
    } else {
      if (mirror) {
        // 멀티관제 탭이 사라졌다: 마지막 자리에서 혼자 일하기로
        mirror = null;
        mirrorListeners.forEach((fn) => fn(null));
      }
      const wasDriving = sim.mode === 'drive';
      sim.step(dt);
      // 화면에서 보낸 이동이 끝나면 원본 목업의 "이동 중" 표시(배너)를 내린다
      if (wasDriving && sim.mode !== 'drive' && mockActivity.current?.type === 'move') mockActivity.current = null;
    }
  }, SIM_MS);
  setInterval(emitNow, EMIT_MS);
  // 원본이 기록을 채운 뒤 위치만 바꾼다
  return () => reseedStatusLogs(robot, modelKey);
}
