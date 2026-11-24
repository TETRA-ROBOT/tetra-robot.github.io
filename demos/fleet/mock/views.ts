/**
 * 메모리 행 → API 응답 모양 (서버 lib/robot-view.ts toRobotView, services/mission-store.ts toView 와 같은 필드).
 */
import { ACTIVE_STATUSES } from '@fleet-api/lib/mission-model';
import { alerts, groups, iso, maps, missions, pois, robots, site, spaces, type AlertRow, type MissionRow, type RobotState } from './state';

const FOOTPRINT: Record<string, Array<[number, number]>> = {
  'TETRA-H': [[0.42, 0.33], [-0.42, 0.33], [-0.42, -0.33], [0.42, -0.33]],
  'TETRA-S': [[0.27, 0.22], [-0.27, 0.22], [-0.27, -0.22], [0.27, -0.22]],
};
const DEFAULT_FOOTPRINT: Array<[number, number]> = [[0.33, 0.27], [-0.33, 0.27], [-0.33, -0.27], [0.33, -0.27]];

export function activeMissionOf(robotId: number): MissionRow | null {
  return missions.find((m) => m.assigned_robot_id === robotId && (ACTIVE_STATUSES as readonly string[]).includes(m.status)) ?? null;
}

export function fleetStateOf(r: RobotState): string {
  if (!r.online) return 'OFFLINE';
  const m = activeMissionOf(r.id);
  if (m?.status === 'PAUSED') return 'PAUSED';
  if (m) return 'WORKING';
  if (r.jog && r.jog.until > Date.now()) return 'MANUAL';
  if (r.emg || r.nav_state === 'error') return 'ERROR';
  if (r.nav_state === 'charging' || r.docking === 1) return 'CHARGING';
  return 'IDLE';
}

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

export function robotView(r: RobotState) {
  const m = activeMissionOf(r.id);
  const loaded = m?.type === 'DELIVERY' && m.current_step > 0 && m.status !== 'PAUSED';
  return {
    id: r.id,
    site_id: r.site_id,
    partner_id: 1,
    name: r.name,
    serial_no: r.serial_no,
    model_type: r.model_type,
    footprint: FOOTPRINT[r.model_type] ?? DEFAULT_FOOTPRINT,
    ip_address: r.ip_address,
    port: 80,
    status: r.online ? 'ONLINE' : 'OFFLINE',
    fleet_state: fleetStateOf(r),
    battery: Math.round(r.battery),
    speed: round(r.speed, 2),
    pose: { x: round(r.pose.x), y: round(r.pose.y), yaw: round(r.pose.yaw) },
    localized: true,
    localization: { confidence: 94, level: 'GOOD' },
    voltage: round(r.voltage, 1),
    emg: r.emg,
    bumper: r.bumper,
    servo: r.servo,
    docking: r.docking,
    nav_state: r.nav_state,
    nav_detail: null,
    own_task: null,
    gps: null,
    load: r.model_type === 'TETRA-S' ? null : loaded ? 'LOADED' : 'EMPTY',
    last_seen_at: iso(r.last_seen_at),
    telemetry_stale: !r.online,
    active_mission_id: m?.id ?? null,
    estop_unconfirmed: false,
    estop_latched: r.estop_latched,
    software_problems: [],
    software_version: '26.11.1',
    api_level: 3,
    dispatch_hold: r.dispatch_hold,
    is_virtual: r.is_virtual,
    out_of_service: r.out_of_service,
    service_note: r.service_note,
    robot_username: null,
    protocol: 'TETRA',
    control_mode: 'FULL',
    vda_manufacturer: null,
    vda_serial: null,
    space_id: r.space_id,
    current_space_id: r.space_id,
    current_map_id: r.map_id,
  };
}

export const allRobotViews = () => robots.map(robotView);

export function missionView(m: MissionRow) {
  const { step_until: _u, step_started: _s, eta_seconds, assigned_at: _a, sim_created_ms: _c, sim_assigned_ms: _sa, sim_started_ms: _ss, sim_ended_ms: _se, ...rest } = m;
  const running = m.status === 'RUNNING' || m.status === 'ASSIGNED';
  return {
    ...rest,
    step_count: m.steps.length,
    waiting_reason: m.status === 'PENDING' || running ? m.waiting_reason : null,
    eta_seconds: running ? eta_seconds : null,
    eta_at: running && eta_seconds !== null ? iso(Date.now() + eta_seconds * 1000) : null,
  };
}

export function alertView(a: AlertRow) {
  const { dedup_key: _k, ...rest } = a;
  return rest;
}

export function spaceView(s: (typeof spaces)[number]) {
  const active = maps.find((m) => m.space_id === s.id && m.is_active);
  return {
    ...s,
    active_map_id: active?.id ?? null,
    map_count: maps.filter((m) => m.space_id === s.id).length,
    robot_ids: robots.filter((r) => r.space_id === s.id).map((r) => r.id),
  };
}

export function siteView() {
  return {
    ...site,
    robot_count: robots.filter((r) => !r.is_virtual).length,
    map_count: maps.filter((m) => !m.is_simulation).length,
  };
}

export const groupsView = () => groups.map((g) => ({ ...g, robot_ids: g.robot_ids.filter((id) => robots.some((r) => r.id === id)) }));

export const poiView = (p: (typeof pois)[number]) => ({ ...p });
