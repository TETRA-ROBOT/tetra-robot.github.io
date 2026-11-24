/**
 * 미션·알림을 바꾸고 화면에 실시간으로 알리는 곳 (서버 services/mission-store.ts·alerts.ts 흉내).
 */
import { buildMissionPlan, PlanError, type Poi } from '@fleet-api/lib/mission-plan';
import { hub } from './hub';
import { alerts, iso, missions, nextId, pois, robots, SITE_ID, MAP_ID, type AlertRow, type MissionRow } from './state';
import { allRobotViews, alertView, missionView } from './views';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ 로봇 스냅샷

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
/** 상태가 바뀌었으니 곧 전체 로봇 상태를 보낸다 (서버 RobotSnapshotBroadcaster 의 debounce 200ms) */
export function requestSnapshot() {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    hub.broadcast('fleet:robots:snapshot', allRobotViews());
  }, 150);
}

// ------------------------------------------------------------------ 미션

export function broadcastMission(m: MissionRow) {
  m.updatedAt = iso();
  hub.broadcast('fleet:mission:update', missionView(m));
  requestSnapshot();
}

export function setMissionStatus(m: MissionRow, status: MissionRow['status'], fields: Partial<MissionRow> = {}) {
  Object.assign(m, fields);
  m.status = status;
  const done = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELED';
  if (done) {
    m.completed_at = iso();
    m.waiting_reason = null;
  }
  if (status === 'RUNNING' && !m.started_at) m.started_at = iso();
  broadcastMission(m);
  if (status === 'FAILED') {
    raiseAlert({ type: 'MISSION_FAILED', severity: 'WARNING', message: `미션 [${m.name}] 실패: ${m.error_message ?? '알 수 없는 이유'}`, robot_id: m.assigned_robot_id, mission_id: m.id, is_simulation: m.is_simulation });
  }
}

const poiMap = (mapId: number) => new Map<number, Poi>(pois.filter((p) => p.map_id === mapId).map((p) => [p.id, p]));

export interface MissionCreateInput {
  type?: string;
  name?: string;
  priority?: number;
  robot_id?: number | null;
  group_id?: number | null;
  map_id?: number | null;
  target?: unknown;
  pickup?: unknown;
  dropoff?: unknown;
  waypoints?: unknown;
  wait_sec?: unknown;
  charger_location_id?: unknown;
}

/** 미션 만들기 (서버 mission-service.create): 장소 번호 → 단계, PENDING 으로 넣고 배차는 엔진이 한다 */
export function createMission(input: MissionCreateInput, source: string, opts: { simulation?: boolean; createdBy?: string | null; mapId?: number; copyOf?: MissionRow } = {}): MissionRow {
  const firstLoc = [input.target, input.pickup, ...(Array.isArray(input.waypoints) ? input.waypoints : []), { location_id: input.charger_location_id }]
    .map((t) => Number((t as { location_id?: unknown } | undefined)?.location_id))
    .find((n) => Number.isInteger(n) && n > 0);
  const mapId = opts.mapId ?? pois.find((p) => p.id === firstLoc)?.map_id ?? input.map_id ?? MAP_ID;
  let plan;
  try {
    const c = opts.copyOf;
    plan = c ? { name: c.name, type: c.type, priority: c.priority, steps: c.steps } : buildMissionPlan(input, poiMap(mapId));
  } catch (err) {
    if (err instanceof PlanError) throw new HttpError(400, err.message);
    throw err;
  }
  const robotId = input.robot_id ? Number(input.robot_id) : null;
  if (robotId && !robots.some((r) => r.id === robotId)) throw new HttpError(400, `로봇 #${robotId}을(를) 찾을 수 없습니다.`);
  const now = iso();
  const m: MissionRow = {
    id: nextId('mission', 1000),
    is_simulation: !!opts.simulation,
    site_id: SITE_ID,
    map_id: mapId,
    name: plan.name,
    type: plan.type,
    priority: plan.priority,
    status: 'PENDING',
    status_reason: null,
    error_message: null,
    waiting_reason: null,
    requested_robot_id: robotId,
    requested_group_id: !robotId && input.group_id ? Number(input.group_id) : null,
    assigned_robot_id: null,
    current_step: 0,
    steps: plan.steps,
    source,
    created_by: opts.createdBy === undefined ? 'demo' : opts.createdBy,
    started_at: null,
    completed_at: null,
    assigned_at: null,
    createdAt: now,
    updatedAt: now,
    step_until: 0,
    step_started: false,
    eta_seconds: null,
  };
  missions.unshift(m);
  if (missions.length > 600) missions.splice(600);
  broadcastMission(m);
  return m;
}

// ------------------------------------------------------------------ 알림

export function raiseAlert(a: { type: string; severity: AlertRow['severity']; message: string; robot_id?: number | null; mission_id?: number | null; dedupKey?: string; is_simulation?: boolean }): AlertRow | null {
  if (a.dedupKey && alerts.some((x) => x.dedup_key === a.dedupKey && x.status === 'ACTIVE')) return null;
  const now = iso();
  const row: AlertRow = {
    id: nextId('alert', 100),
    is_simulation: !!a.is_simulation,
    type: a.type,
    severity: a.severity,
    message: a.message,
    robot_id: a.robot_id ?? null,
    mission_id: a.mission_id ?? null,
    site_id: SITE_ID,
    // 미션 실패 같은 한 번 일어난 일은 알림만 남기고 바로 해결로 본다 (서버도 상태형이 아니면 확인만 받는다)
    status: 'ACTIVE',
    acknowledged_at: null,
    acknowledged_by: null,
    resolved_at: null,
    createdAt: now,
    updatedAt: now,
    dedup_key: a.dedupKey ?? null,
  };
  alerts.unshift(row);
  if (alerts.length > 500) alerts.splice(500);
  hub.broadcast('fleet:alert', { action: 'created', alert: alertView(row) });
  return row;
}

export function resolveAlert(dedupKey: string) {
  for (const a of alerts) {
    if (a.dedup_key !== dedupKey || a.status !== 'ACTIVE') continue;
    a.status = 'RESOLVED';
    a.resolved_at = a.updatedAt = iso();
    hub.broadcast('fleet:alert', { action: 'updated', alert: alertView(a) });
  }
}

export function acknowledgeAlert(a: AlertRow, by: string) {
  a.acknowledged_at = a.updatedAt = iso();
  a.acknowledged_by = by;
  hub.broadcast('fleet:alert', { action: 'updated', alert: alertView(a) });
}
