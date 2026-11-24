/**
 * 배차·자동 충전·비상정지·미션 조작 (서버 dispatch-engine / auto-charge / emergency-stop / mission-service 흉내)
 * + 데모가 심심하지 않도록 외부 시스템 주문을 가끔 넣는 '데모 일거리'.
 */
import { ACTIVE_STATUSES } from '@fleet-api/lib/mission-model';
import { firstMoveTarget } from '@fleet-api/lib/mission-plan';
import { audit, groups, iso, missions, pois, robots, settings, MAP_ID, type MissionRow, type RobotState } from './state';
import { activeMissionOf } from './views';
import { canMove, haltRobot } from './engine';
import { broadcastMission, createMission, HttpError, raiseAlert, requestSnapshot, resolveAlert, setMissionStatus } from './events';

const isActive = (m: MissionRow) => (ACTIVE_STATUSES as readonly string[]).includes(m.status);

/** 이 로봇이 이 미션을 받을 수 있는지. 안 되면 이유 (서버 lib/dispatch-policy.ts 의 문장) */
function ineligible(r: RobotState, m: MissionRow): string | null {
  if (m.requested_robot_id && m.requested_robot_id !== r.id) return '지정 로봇 아님';
  if (m.requested_group_id && !groups.find((g) => g.id === m.requested_group_id)?.robot_ids.includes(r.id)) return '다른 그룹';
  if (r.map_id !== m.map_id || r.is_virtual !== m.is_simulation) return '다른 구역에 있음';
  if (activeMissionOf(r.id)) return '다른 미션 하는 중';
  if (r.out_of_service) return '운행 중지 (점검 중)';
  if (r.dispatch_hold) return '비상정지 후 운행 재개 대기';
  if (!r.online) return '연결 끊김';
  if (r.estop_latched) return '로봇 비상정지가 걸려 있음 (운행 재개 필요)';
  if (r.bumper) return '범퍼에 부딪힘 감지';
  if (!r.servo) return '바퀴 모터 꺼짐';
  if (r.jog) return '수동 조종 중';
  const charging = r.docking === 1;
  if (m.type === 'CHARGE' || m.source === 'AUTO_CHARGE') return charging ? '이미 충전 중' : null;
  const { threshold, resume } = settings.value.autoCharge;
  if (r.battery < threshold) return `배터리 부족 ${Math.round(r.battery)}%`;
  if (charging && r.battery < resume) return `충전 중 ${Math.round(r.battery)}% (${resume}%가 되면 다시 일함)`;
  return null;
}

/** 대기 중인 미션을 우선순위·만든 순서대로 가장 알맞은 로봇에 맡긴다 */
export function dispatch() {
  const pending = missions.filter((m) => m.status === 'PENDING').sort((a, b) => a.priority - b.priority || a.id - b.id);
  for (const m of pending) {
    const target = firstMoveTarget(m.steps);
    const reasons: string[] = [];
    let best: RobotState | null = null;
    let bestScore = Infinity;
    for (const r of robots) {
      const why = ineligible(r, m);
      if (why) {
        if (!['지정 로봇 아님', '다른 그룹', '다른 구역에 있음'].includes(why)) reasons.push(`${r.name}: ${why}`);
        continue;
      }
      const d = target ? Math.hypot(target.x - r.pose.x, target.y - r.pose.y) : 0;
      const score = d / r.max_speed + (100 - r.battery) * 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) {
      const reason = reasons.length ? reasons.join(', ') : m.requested_group_id ? '이 그룹에 일할 수 있는 로봇이 없습니다.' : '이 사이트에 일할 수 있는 로봇이 없습니다.';
      if (m.waiting_reason !== reason) {
        m.waiting_reason = reason;
        broadcastMission(m);
      }
      continue;
    }
    m.assigned_robot_id = best.id;
    m.assigned_at = iso();
    m.step_until = 1; // 로봇이 명령을 받는 시간
    m.step_started = false;
    m.waiting_reason = null;
    setMissionStatus(m, 'ASSIGNED');
  }
}

/** 배터리가 기준보다 낮고 쉬는 로봇을 가까운 빈 충전소로 보낸다 */
export function autoCharge() {
  const { enabled, threshold } = settings.value.autoCharge;
  for (const r of robots) {
    const low = r.battery < settings.value.alerts.lowBattery;
    if (low) raiseAlert({ type: 'LOW_BATTERY', severity: 'WARNING', robot_id: r.id, message: `${r.name}: 배터리가 ${Math.round(r.battery)}%로 낮습니다 (기준 ${settings.value.alerts.lowBattery}%).`, dedupKey: `LOW_BATTERY:${r.id}`, is_simulation: r.is_virtual });
    else if (r.battery > settings.value.alerts.lowBattery + 5) resolveAlert(`LOW_BATTERY:${r.id}`);
    if (!enabled || r.battery >= threshold || r.docking !== 0 || activeMissionOf(r.id) || !canMove(r) || r.dispatch_hold || r.out_of_service) continue;
    if (missions.some((m) => m.status === 'PENDING' && m.requested_robot_id === r.id && m.type === 'CHARGE')) continue;
    const taken = new Set<number>();
    robots.forEach((o) => o.charger_id && taken.add(o.charger_id));
    missions.filter((m) => m.type === 'CHARGE' && (isActive(m) || m.status === 'PENDING')).forEach((m) => {
      const dock = m.steps.find((s) => s.kind === 'DOCK');
      if (dock && dock.kind === 'DOCK' && dock.location_id) taken.add(dock.location_id);
    });
    const chargers = pois.filter((p) => p.type === 'CHARGER' && p.map_id === r.map_id && !taken.has(p.id)).sort((a, b) => Math.hypot(a.x - r.pose.x, a.y - r.pose.y) - Math.hypot(b.x - r.pose.x, b.y - r.pose.y));
    if (!chargers.length) {
      raiseAlert({ type: 'NO_CHARGER', severity: 'WARNING', robot_id: r.id, message: `${r.name}: 배터리가 ${Math.round(r.battery)}%인데 비어 있는 충전소가 없습니다.`, dedupKey: `NO_CHARGER:${r.id}`, is_simulation: r.is_virtual });
      continue;
    }
    resolveAlert(`NO_CHARGER:${r.id}`);
    createMission({ type: 'CHARGE', charger_location_id: chargers[0].id, robot_id: r.id, priority: 1 }, 'AUTO_CHARGE', { simulation: r.is_virtual, createdBy: null, mapId: r.map_id });
  }
}

// ------------------------------------------------------------------ 비상정지·운행 재개

function pauseMissionOf(r: RobotState, reason: string) {
  const m = activeMissionOf(r.id);
  if (!m || m.status === 'PAUSED') return;
  m.step_started = false;
  setMissionStatus(m, 'PAUSED', { status_reason: reason, waiting_reason: null });
}

export function emergencyStop(list: RobotState[], groupName: string | null = null) {
  const results = list.map((r) => {
    r.estop_latched = true;
    r.servo = false;
    r.dispatch_hold = true;
    r.jog = null;
    haltRobot(r, 'stop');
    pauseMissionOf(r, '비상정지로 일시정지됨 (demo)');
    audit(groupName === null && list.length === 1 ? 'ESTOP_ROBOT' : 'ESTOP_ALL', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id), detail: { connection: 'ONLINE', attempts: 1, method: 'ESTOP', servo_off: true, ...(groupName ? { group: groupName } : {}) } });
    return { robot_id: r.id, name: r.name, status: 'STOPPED' as const, connection: 'ONLINE' as const, attempts: 1 };
  });
  requestSnapshot();
  return { success: true, group_name: groupName, total: results.length, stopped: results.length, failed: 0, results };
}

export function releaseHold(list: RobotState[]) {
  const released: number[] = [];
  for (const r of list) {
    if (!r.dispatch_hold && !r.estop_latched) continue;
    r.dispatch_hold = false;
    r.estop_latched = false;
    r.servo = true;
    if (r.nav_state === 'stop') r.nav_state = 'normal';
    released.push(r.id);
    audit('ESTOP_RELEASE', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  }
  requestSnapshot();
  return { released, failed: [] };
}

// ------------------------------------------------------------------ 미션 조작

export function cancelMission(m: MissionRow) {
  if (!['PENDING', ...ACTIVE_STATUSES].includes(m.status)) throw new HttpError(409, '이미 끝난 미션은 취소할 수 없습니다.');
  const r = robots.find((x) => x.id === m.assigned_robot_id);
  const moving = !!r && isActive(m);
  if (r && moving) haltRobot(r, 'stop');
  setMissionStatus(m, 'CANCELED', { status_reason: '사용자 취소 (demo)' });
  audit('MISSION_CANCEL', { target_type: 'MISSION', target_id: String(m.id), robot_id: m.assigned_robot_id });
  return { robot_stop: moving ? 'STOPPED' : 'NOT_NEEDED', message: moving ? `${r!.name}을(를) 멈췄습니다.` : '미션을 취소했습니다.' };
}

export function pauseMission(m: MissionRow) {
  if (m.status !== 'RUNNING' && m.status !== 'ASSIGNED') throw new HttpError(409, '수행 중인 미션만 일시정지할 수 있습니다.');
  const r = robots.find((x) => x.id === m.assigned_robot_id);
  if (r) haltRobot(r, 'stop');
  m.step_started = false;
  setMissionStatus(m, 'PAUSED', { status_reason: '사용자 일시정지 (demo)' });
  audit('MISSION_PAUSE', { target_type: 'MISSION', target_id: String(m.id), robot_id: m.assigned_robot_id });
}

export function resumeMission(m: MissionRow) {
  if (m.status !== 'PAUSED') throw new HttpError(409, '일시정지된 미션만 재개할 수 있습니다.');
  const r = robots.find((x) => x.id === m.assigned_robot_id);
  if (r) releaseHold([r]);
  m.step_started = false;
  setMissionStatus(m, 'RUNNING', { status_reason: null });
  audit('MISSION_RESUME', { target_type: 'MISSION', target_id: String(m.id), robot_id: m.assigned_robot_id });
}

export function retryMission(m: MissionRow): MissionRow {
  if (!['FAILED', 'CANCELED', 'COMPLETED'].includes(m.status)) throw new HttpError(409, '끝난 미션만 다시 실행할 수 있습니다.');
  return createMission({ robot_id: m.requested_robot_id, group_id: m.requested_group_id }, 'RETRY', { simulation: m.is_simulation, mapId: m.map_id ?? MAP_ID, copyOf: m });
}

// ------------------------------------------------------------------ 데모 일거리 (외부 시스템 주문·가끔 생기는 일)

let orderNo = 10420 + Math.floor(Math.random() * 60);
let nextOrderAt = Date.now() + 4000;
let nextEventAt = Date.now() + 70_000;
export const demoTraffic = { enabled: true };

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function demoWork() {
  const now = Date.now();
  if (demoTraffic.enabled && now >= nextOrderAt) {
    nextOrderAt = now + 15_000 + Math.random() * 15_000;
    const open = missions.filter((m) => !m.is_simulation && (m.source === 'API' || m.source === 'SCHEDULE') && (m.status === 'PENDING' || isActive(m))).length;
    if (open < 2) {
      const real = pois.filter((p) => p.map_id === MAP_ID);
      if (Math.random() < 0.75) {
        const from = pick(real.filter((p) => p.type === 'PICKUP' || p.type === 'WAYPOINT'));
        const to = pick(real.filter((p) => p.type === 'DROPOFF'));
        const m = createMission({ type: 'DELIVERY', pickup: { location_id: from.id }, dropoff: { location_id: to.id }, wait_sec: 4 + Math.floor(Math.random() * 4), name: `주문 #${++orderNo} 배송`, priority: 3 }, 'API', { createdBy: 'WMS 연동' });
        void m;
      } else {
        const stops = real.filter((p) => p.type === 'WAYPOINT').sort(() => Math.random() - 0.5).slice(0, 3);
        createMission({ type: 'PATROL', waypoints: stops.map((p) => ({ location_id: p.id })), name: '선반 재고 순찰', priority: 4 }, 'SCHEDULE', { createdBy: null });
      }
    }
  }
  // 가끔: 움직이던 로봇의 범퍼가 눌렸다가 풀린다 (알림 예시)
  if (now >= nextEventAt) {
    nextEventAt = now + 180_000 + Math.random() * 120_000;
    const moving = robots.filter((r) => !r.is_virtual && r.speed > 0.2 && !r.bumper);
    const r = moving.length ? pick(moving) : null;
    if (r) {
      r.bumper = true;
      r.halt_until = now + 12000;
      r.speed = 0;
      requestSnapshot();
      raiseAlert({ type: 'BUMPER', severity: 'CRITICAL', robot_id: r.id, message: `${r.name}: 범퍼가 눌렸습니다 (충돌 가능성). 현장을 확인하세요.`, dedupKey: `BUMPER:${r.id}` });
      setTimeout(() => {
        r.bumper = false;
        resolveAlert(`BUMPER:${r.id}`);
        requestSnapshot();
      }, 12000);
    }
  }
}
