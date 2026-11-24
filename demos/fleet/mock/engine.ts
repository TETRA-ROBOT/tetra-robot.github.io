/**
 * 가상 로봇 엔진: 200ms 마다 로봇을 길 따라 움직이고 미션 단계를 진행한다 (서버 services/virtual-robots.ts + mission-executor 흉내).
 * 길 찾기·이동·막힘 판단은 서버의 순수 로직(lib/virtual-robot.ts)을 그대로 쓴다.
 */
import { advance, blockedBy, pathLength, planPath, stampRobots, type Point } from '@fleet-api/lib/virtual-robot';
import { hub } from './hub';
import { grid, iso, robots, type MissionRow, type RobotState } from './state';
import { activeMissionOf } from './views';
import { broadcastMission, raiseAlert, requestSnapshot, resolveAlert, setMissionStatus } from './events';

export const TICK_MS = 200;
const ACCEL = 0.8; // m/s²
const TURN_RATE = 2.4; // rad/s
const BATTERY = { perMeter: 0.12, idlePerSec: 0.004, chargePerSec: 0.5 };
const DOCK_SECONDS = 4;

/** 시뮬레이션이 정하는 것: 로봇마다 시간 배속, 멈춤(일시정지), 미션이 끝났을 때 */
export const engineHooks = {
  timeScale: (_r: RobotState): number => 1,
  frozen: (_r: RobotState): boolean => false,
  onMissionStart: (_m: MissionRow): void => undefined,
  onMissionEnd: (_m: MissionRow): void => undefined,
  onTick: (_dtReal: number): void => undefined,
  /** 1초마다 (배차·자동 충전·데모 일거리) */
  onSecond: (): void => undefined,
};

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const toPoints = (path: Point[] | null): Array<[number, number]> => (path ?? []).map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);

export function sendPath(r: RobotState) {
  hub.broadcast('fleet:robot:path', { robot_id: r.id, points: toPoints(r.path) });
}

function sendPose(r: RobotState) {
  hub.broadcast('fleet:robot:pose', { robot_id: r.id, x: r.pose.x, y: r.pose.y, yaw: r.pose.yaw });
}

export function sendTelemetry(r: RobotState) {
  hub.broadcast('fleet:robot:telemetry', {
    robot_id: r.id,
    battery: Math.round(r.battery),
    speed: Math.round(r.speed * 100) / 100,
    voltage: Math.round(r.voltage * 10) / 10,
    emg: r.emg,
    bumper: r.bumper,
    servo: r.servo,
    docking: r.docking,
    nav_state: r.nav_state,
    estop_latched: r.estop_latched,
  });
}

/** 로봇을 그 자리에 세운다 (비상정지·일시정지·취소). 하던 단계는 다시 시작할 때 새로 길을 찾는다 */
export function haltRobot(r: RobotState, navState: RobotState['nav_state'] = 'stop') {
  r.path = null;
  r.goal = null;
  r.speed = 0;
  r.blocked_s = 0;
  if (r.docking === 2) r.docking = 0;
  if (r.nav_state !== 'charging') r.nav_state = navState;
  sendPath(r);
  sendTelemetry(r);
  requestSnapshot();
}

/** 로봇이 지금 움직일 수 있는지 (모터·비상정지·범퍼) */
export const canMove = (r: RobotState) => r.online && r.servo && !r.estop_latched && !r.emg && !r.bumper && Date.now() >= r.halt_until;

function nextStep(r: RobotState, m: MissionRow) {
  m.current_step += 1;
  m.step_started = false;
  m.step_until = 0;
  m.waiting_reason = null;
  if (m.current_step >= m.steps.length) {
    m.current_step = m.steps.length;
    r.nav_state = r.docking === 1 ? 'charging' : 'normal';
    setMissionStatus(m, 'COMPLETED', { eta_seconds: 0 });
    resolveAlert(`TRAFFIC_WAIT:${r.id}`);
    engineHooks.onMissionEnd(m);
  } else broadcastMission(m);
}

/** 남은 시간 견적 (초): 지금 길 + 뒤 단계들의 직선 거리 × 1.3 */
function estimate(r: RobotState, m: MissionRow): number {
  let s = 0;
  let from: Point = r.pose;
  for (let i = m.current_step; i < m.steps.length; i++) {
    const st = m.steps[i];
    if (st.kind === 'MOVE') {
      const d = i === m.current_step && r.path ? pathLength(r.path) : Math.hypot(st.x - from.x, st.y - from.y) * 1.3;
      s += d / r.max_speed + 2;
      from = st;
    } else if (st.kind === 'WAIT') s += i === m.current_step && m.step_started ? Math.max(0, m.step_until) : st.seconds;
    else if (st.kind === 'DOCK') s += DOCK_SECONDS;
  }
  return Math.round(s);
}

/** 길을 따라 한 번 움직인다. 앞이 막히면 서서 기다리다가 돌아가는 길을 찾는다. 움직인 거리(m) */
function drive(r: RobotState, m: MissionRow, dt: number): number {
  const path = r.path!;
  const others = robots.filter((o) => o !== r && o.online && o.map_id === r.map_id).map((o) => o.pose);
  if (blockedBy(path, others)) {
    r.speed = 0;
    r.blocked_s += dt;
    if (r.blocked_s > 1.5 && !m.waiting_reason) {
      m.waiting_reason = '앞에 다른 로봇이 있어 지나가기를 기다리는 중입니다.';
      broadcastMission(m);
    }
    if (r.blocked_s > 2.5 && Math.floor((r.blocked_s - dt) / 2.5) !== Math.floor(r.blocked_s / 2.5)) {
      const near = others.filter((o) => Math.hypot(o.x - r.pose.x, o.y - r.pose.y) < 4);
      const detour = planPath(grid, r.pose, r.goal!, stampRobots(grid, near));
      if (detour) {
        r.path = detour;
        sendPath(r);
      }
    }
    if (r.blocked_s > 40) raiseAlert({ type: 'TRAFFIC_WAIT', severity: 'WARNING', robot_id: r.id, mission_id: m.id, message: `${r.name}: 앞이 막혀 ${Math.round(r.blocked_s)}초째 기다리는 중입니다. 길을 막은 로봇이나 물건이 없는지 확인하세요.`, dedupKey: `TRAFFIC_WAIT:${r.id}`, is_simulation: m.is_simulation });
    return 0;
  }
  if (r.blocked_s > 0) {
    r.blocked_s = 0;
    resolveAlert(`TRAFFIC_WAIT:${r.id}`);
    if (m.waiting_reason) {
      m.waiting_reason = null;
      broadcastMission(m);
    }
  }
  // 방향 먼저: 많이 틀어져 있으면 제자리에서 돈다
  const a = path[0];
  const b = path[1] ?? path[0];
  const heading = Math.hypot(b.x - a.x, b.y - a.y) > 1e-6 ? Math.atan2(b.y - a.y, b.x - a.x) : r.pose.yaw;
  const err = wrap(heading - r.pose.yaw);
  r.pose.yaw = wrap(r.pose.yaw + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, err)));
  const remaining = pathLength(path);
  const turnFactor = Math.abs(err) > 1.0 ? 0 : Math.cos(err);
  const brake = Math.sqrt(2 * ACCEL * remaining) + 0.05;
  r.speed = Math.max(0, Math.min(r.max_speed * turnFactor, r.speed + ACCEL * dt, brake));
  const dist = r.speed * dt;
  if (dist <= 0) return 0;
  const res = advance(path, dist);
  r.path = res.path;
  r.pose.x = res.path[0].x;
  r.pose.y = res.path[0].y;
  if (res.arrived) r.path = [res.path[0]];
  return dist;
}

/** 미션 한 단계 진행. 움직인 거리(m) */
function runMission(r: RobotState, m: MissionRow, dt: number): number {
  if (m.status === 'ASSIGNED') {
    m.step_until -= dt;
    if (m.step_until > 0) return 0;
    setMissionStatus(m, 'RUNNING', { started_at: iso() });
    engineHooks.onMissionStart(m);
  }
  const step = m.steps[m.current_step];
  if (!step) {
    nextStep(r, m);
    return 0;
  }
  if (step.kind === 'MOVE') {
    if (!m.step_started) {
      if (r.docking !== 0) {
        r.docking = 0;
        r.charger_id = null;
      }
      const path = planPath(grid, r.pose, step);
      if (!path) {
        haltRobot(r, 'fail');
        setMissionStatus(m, 'FAILED', { error_message: `[${step.label}]까지 가는 길을 찾지 못했습니다.` });
        engineHooks.onMissionEnd(m);
        return 0;
      }
      r.path = path;
      r.goal = { x: step.x, y: step.y };
      r.goal_yaw = step.yaw;
      r.nav_state = 'going';
      m.step_started = true;
      sendPath(r);
      sendTelemetry(r);
    }
    if (!r.path) return 0;
    const moved = drive(r, m, dt);
    if (r.path.length <= 1) {
      // 도착: 장소 방향으로 돈 뒤 다음 단계
      const err = wrap((r.goal_yaw ?? r.pose.yaw) - r.pose.yaw);
      r.speed = 0;
      if (Math.abs(err) > 0.05) {
        r.pose.yaw = wrap(r.pose.yaw + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, err)));
        return moved;
      }
      r.path = null;
      r.goal = null;
      r.nav_state = 'normal';
      sendPath(r);
      nextStep(r, m);
    }
    return moved;
  }
  if (step.kind === 'WAIT') {
    r.speed = 0;
    if (!m.step_started) {
      m.step_started = true;
      m.step_until = step.seconds;
      r.nav_state = 'normal';
    }
    m.step_until -= dt;
    if (m.step_until <= 0) nextStep(r, m);
    return 0;
  }
  if (step.kind === 'DOCK') {
    r.speed = 0;
    if (!m.step_started) {
      m.step_started = true;
      m.step_until = DOCK_SECONDS;
      r.docking = 2;
      r.nav_state = 'docking';
      sendTelemetry(r);
      requestSnapshot();
    }
    m.step_until -= dt;
    if (m.step_until <= 0) {
      r.docking = 1;
      r.nav_state = 'charging';
      r.charger_id = step.location_id;
      sendTelemetry(r);
      nextStep(r, m);
    }
    return 0;
  }
  nextStep(r, m);
  return 0;
}

/** 수동 조종 (조그): 받은 속도로 잠깐 움직인다 */
function jog(r: RobotState, dt: number): number {
  const j = r.jog!;
  if (Date.now() > j.until || !canMove(r)) {
    r.jog = null;
    r.speed = 0;
    requestSnapshot();
    return 0;
  }
  if (r.docking === 1) {
    r.docking = 0;
    r.charger_id = null;
    r.nav_state = 'normal';
  }
  r.pose.yaw = wrap(r.pose.yaw + j.ang * dt);
  const nx = r.pose.x + Math.cos(r.pose.yaw) * j.lin * dt;
  const ny = r.pose.y + Math.sin(r.pose.yaw) * j.lin * dt;
  const u = Math.floor((nx - grid.originX) / grid.resolution);
  const v = grid.height - 1 - Math.floor((ny - grid.originY) / grid.resolution);
  if (u < 0 || v < 0 || u >= grid.width || v >= grid.height || grid.blocked[v * grid.width + u]) {
    r.speed = 0;
    return 0;
  }
  r.pose.x = nx;
  r.pose.y = ny;
  r.speed = Math.abs(j.lin);
  return Math.abs(j.lin * dt);
}

function stepRobot(r: RobotState, dt: number) {
  r.last_seen_at = Date.now();
  if (!r.online) return;
  const before = { x: r.pose.x, y: r.pose.y, yaw: r.pose.yaw };
  let moved = 0;
  const m = activeMissionOf(r.id);
  if (r.jog) moved = jog(r, dt);
  else if (m && (m.status === 'ASSIGNED' || m.status === 'RUNNING') && canMove(r)) moved = runMission(r, m, dt);
  else if (r.speed > 0) r.speed = 0;

  if (r.docking === 1) r.battery = Math.min(100, r.battery + BATTERY.chargePerSec * dt);
  else r.battery = Math.max(0, r.battery - moved * BATTERY.perMeter - dt * BATTERY.idlePerSec);
  r.battery_min = Math.min(r.battery_min, r.battery);
  r.voltage = 23 + (r.battery / 100) * 4.2 + (r.docking === 1 ? 0.6 : 0);
  r.odo_m += moved;
  if (r.pose.x !== before.x || r.pose.y !== before.y || r.pose.yaw !== before.yaw) sendPose(r);
}

let last = Date.now();
let secondAcc = 0;
let snapAcc = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  const now = Date.now();
  const dtReal = Math.min(1, Math.max(0, (now - last) / 1000));
  last = now;
  engineHooks.onTick(dtReal);
  for (const r of robots) {
    if (engineHooks.frozen(r)) continue;
    stepRobot(r, dtReal * engineHooks.timeScale(r));
  }
  secondAcc += dtReal;
  snapAcc += dtReal;
  if (secondAcc >= 1) {
    secondAcc = 0;
    engineHooks.onSecond();
    for (const r of robots) {
      sendTelemetry(r);
      const m = activeMissionOf(r.id);
      if (m && m.status === 'RUNNING') {
        m.eta_seconds = estimate(r, m);
        if (r.path && r.path.length > 1) sendPath(r);
      }
    }
  }
  if (snapAcc >= 2) {
    snapAcc = 0;
    requestSnapshot();
  }
}

export function startEngine() {
  if (timer) return;
  last = Date.now();
  timer = setInterval(tick, TICK_MS);
}
