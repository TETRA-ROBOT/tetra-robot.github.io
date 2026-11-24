/**
 * 가짜 서버의 메모리 DB: 사이트 하나, 구역(1층) 하나, 지도 하나, 장소, 로봇 4대, 미션·알림·조작 이력.
 * 새로 고치면 처음 상태로 돌아간다 (브라우저 저장소에 남기지 않는다).
 */
import { DEFAULT_SETTINGS, type FleetSettings } from '@fleet-api/lib/settings-schema';
import type { MissionStep } from '@fleet-api/lib/mission-model';
import { buildGrid, type Point, type SimGrid } from '@fleet-api/lib/virtual-robot';
import { buildFloorPixels, HEIGHT, ORIGIN, RESOLUTION, WIDTH, pixelsToPng } from './floorplan';

export const iso = (t: number = Date.now()) => new Date(t).toISOString();
const ids: Record<string, number> = {};
export const nextId = (table: string, start = 1) => (ids[table] = (ids[table] ?? start - 1) + 1);

export const DEMO_USER = {
  id: 1,
  username: 'demo',
  name: '데모 관리자',
  role: 'SUPER_ADMIN' as const,
  partner_id: null as number | null,
  must_change_password: false,
};

export const SITE_ID = 1;
export const SPACE_ID = 1;
export const MAP_ID = 1;
const BOOT = Date.now();

export const site = {
  id: SITE_ID,
  partner_id: 1,
  name: '데모 물류센터',
  address: '브라우저 시뮬레이션',
  building: 'A동',
  floor: '1층',
  geo: null,
};

export const spaces = [
  {
    id: SPACE_ID,
    site_id: SITE_ID,
    name: '1층',
    kind: 'FLOOR',
    sort_order: 1,
    description: '창고·출고장·사무 구역',
    is_simulation: false,
    createdAt: iso(BOOT - 30 * 86_400_000),
    updatedAt: iso(BOOT - 30 * 86_400_000),
  },
] as Array<Record<string, any> & { id: number; site_id: number; name: string; is_simulation: boolean }>;

export interface MapRow {
  id: number;
  site_id: number;
  space_id: number;
  name: string;
  is_simulation: boolean;
  is_active: boolean;
  version: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export const maps: MapRow[] = [
  { id: MAP_ID, site_id: SITE_ID, space_id: SPACE_ID, name: '1층 창고 지도', is_simulation: false, is_active: true, version: 1, note: '데모용 지도', createdAt: iso(BOOT - 30 * 86_400_000), updatedAt: iso(BOOT - 30 * 86_400_000) },
];

/** 지도 그림 (모든 지도가 같은 그림을 쓴다: 시뮬레이션 지도는 이 지도를 복사한 것) */
export const floorPixels = buildFloorPixels();
let pngPromise: Promise<Blob> | null = null;
export const floorPng = () => (pngPromise ??= pixelsToPng(floorPixels));
/** 가상 로봇 길 찾기용 (몸통만큼 부풀린 벽) */
export const grid: SimGrid = buildGrid(floorPixels, WIDTH, HEIGHT, RESOLUTION, ORIGIN.x, ORIGIN.y);

export function mapView(m: MapRow) {
  return {
    id: m.id,
    is_simulation: m.is_simulation,
    site_id: m.site_id,
    name: m.name,
    resolution: RESOLUTION,
    origin_x: ORIGIN.x,
    origin_y: ORIGIN.y,
    origin_yaw: 0,
    width: WIDTH,
    height: HEIGHT,
    source_robot_id: 1,
    space_id: m.space_id,
    version: m.version,
    note: m.note,
    is_active: m.is_active,
    has_image: true,
    source: 'ROBOT' as const,
    image_type: 'image/png',
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export interface PoiRow {
  id: number;
  site_id: number;
  map_id: number;
  name: string;
  type: 'WAYPOINT' | 'CHARGER' | 'PICKUP' | 'DROPOFF' | 'WAIT_ZONE';
  x: number;
  y: number;
  yaw: number | null;
  marker_id: number | null;
  robot_models: string[] | null;
}

const H = Math.PI / 2;
const BASE_POIS: Array<Omit<PoiRow, 'id' | 'site_id' | 'map_id'>> = [
  { name: '입고장 A', type: 'PICKUP', x: 2.6, y: 19.9, yaw: Math.PI, marker_id: null, robot_models: null },
  { name: '입고장 B', type: 'PICKUP', x: 2.6, y: 3.1, yaw: Math.PI, marker_id: null, robot_models: null },
  { name: '선반 A-1', type: 'WAYPOINT', x: 9, y: 7.25, yaw: H, marker_id: null, robot_models: null },
  { name: '선반 A-2', type: 'WAYPOINT', x: 19.2, y: 7.25, yaw: H, marker_id: null, robot_models: null },
  { name: '선반 B-1', type: 'WAYPOINT', x: 9, y: 11.25, yaw: H, marker_id: null, robot_models: null },
  { name: '선반 B-2', type: 'WAYPOINT', x: 19.2, y: 15.25, yaw: H, marker_id: null, robot_models: null },
  { name: '출고장 1', type: 'DROPOFF', x: 31.5, y: 7.7, yaw: H, marker_id: null, robot_models: null },
  { name: '출고장 2', type: 'DROPOFF', x: 31.5, y: 10.4, yaw: -H, marker_id: null, robot_models: null },
  { name: '사무실', type: 'DROPOFF', x: 36, y: 17, yaw: 0, marker_id: null, robot_models: null },
  { name: '회의실', type: 'WAYPOINT', x: 30, y: 18.7, yaw: H, marker_id: null, robot_models: null },
  { name: '충전소 1', type: 'CHARGER', x: 36.6, y: 2.0, yaw: -H, marker_id: 1, robot_models: null },
  { name: '충전소 2', type: 'CHARGER', x: 38.2, y: 2.0, yaw: -H, marker_id: 2, robot_models: null },
  { name: '충전소 3', type: 'CHARGER', x: 33.6, y: 2.0, yaw: -H, marker_id: 3, robot_models: null },
  { name: '대기 장소 1', type: 'WAIT_ZONE', x: 25.6, y: 21.3, yaw: -H, marker_id: null, robot_models: null },
  { name: '대기 장소 2', type: 'WAIT_ZONE', x: 25.6, y: 10.6, yaw: Math.PI, marker_id: null, robot_models: null },
];

export const pois: PoiRow[] = BASE_POIS.map((p) => ({ ...p, id: nextId('poi'), site_id: SITE_ID, map_id: MAP_ID }));
export const poiByName = (name: string) => pois.find((p) => p.name === name && p.map_id === MAP_ID)!;

export type NavState = 'normal' | 'going' | 'stop' | 'fail' | 'docking' | 'charging' | 'error';

export interface RobotState {
  id: number;
  name: string;
  serial_no: string | null;
  model_type: string;
  ip_address: string;
  site_id: number;
  space_id: number;
  /** 지금 있는 지도 (시뮬레이션 로봇은 시뮬레이션 지도) */
  map_id: number;
  is_virtual: boolean;
  out_of_service: boolean;
  service_note: string | null;
  dispatch_hold: boolean;
  online: boolean;
  battery: number;
  voltage: number;
  speed: number;
  pose: { x: number; y: number; yaw: number };
  emg: boolean;
  bumper: boolean;
  servo: boolean;
  docking: 0 | 1 | 2;
  nav_state: NavState;
  estop_latched: boolean;
  last_seen_at: number;
  /** 주행 최고 속도 (m/s) */
  max_speed: number;
  // ---- 엔진 상태
  path: Point[] | null;
  goal: Point | null;
  goal_yaw: number | null;
  /** 앞이 막힌 뒤 지난 시간 (s) */
  blocked_s: number;
  /** 지금 서 있는 충전소 (도킹 중·충전 중) */
  charger_id: number | null;
  /** 범퍼 같은 일로 잠깐 멈춤 (이 시각까지) */
  halt_until: number;
  jog: { lin: number; ang: number; until: number } | null;
  /** 시뮬레이션 거리·시간 통계 */
  odo_m: number;
  /** 이 로봇의 시작 배터리 (시뮬레이션 보고서) */
  battery_start: number;
  battery_min: number;
}

const MODEL_SPEED: Record<string, number> = { 'TETRA-M': 0.8, 'TETRA-H': 0.6, 'TETRA-S': 1.0, 'TETRA-MH': 0.7, 'TETRA-EDU': 0.5, 'TETRA-SM': 0.7 };
export const speedOfModel = (model: string) => MODEL_SPEED[model] ?? 0.7;

export function newRobot(init: { id?: number; name: string; model: string; x: number; y: number; yaw: number; battery: number; virtual?: boolean; map_id?: number; space_id?: number; serial?: string | null; speed?: number | null }): RobotState {
  const id = init.id ?? nextId('robot');
  return {
    id,
    name: init.name,
    serial_no: init.serial === undefined ? `TR${init.model.replace('TETRA-', '')}-2026${String(id).padStart(4, '0')}` : init.serial,
    model_type: init.model,
    ip_address: init.virtual ? `sim-${id}` : `192.168.10.${100 + id}`,
    site_id: SITE_ID,
    space_id: init.space_id ?? SPACE_ID,
    map_id: init.map_id ?? MAP_ID,
    is_virtual: !!init.virtual,
    out_of_service: false,
    service_note: null,
    dispatch_hold: false,
    online: true,
    battery: init.battery,
    voltage: 0,
    speed: 0,
    pose: { x: init.x, y: init.y, yaw: init.yaw },
    emg: false,
    bumper: false,
    servo: true,
    docking: 0,
    nav_state: 'normal',
    estop_latched: false,
    last_seen_at: Date.now(),
    max_speed: init.speed ?? speedOfModel(init.model),
    path: null,
    goal: null,
    goal_yaw: null,
    blocked_s: 0,
    charger_id: null,
    halt_until: 0,
    jog: null,
    odo_m: 0,
    battery_start: init.battery,
    battery_min: init.battery,
  };
}

export const robots: RobotState[] = [];

export interface MissionRow {
  id: number;
  is_simulation: boolean;
  site_id: number;
  map_id: number | null;
  name: string;
  type: 'MOVE' | 'DELIVERY' | 'PATROL' | 'CHARGE';
  priority: number;
  status: 'PENDING' | 'ASSIGNED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  status_reason: string | null;
  error_message: string | null;
  waiting_reason: string | null;
  requested_robot_id: number | null;
  requested_group_id: number | null;
  assigned_robot_id: number | null;
  current_step: number;
  steps: MissionStep[];
  source: string;
  created_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  assigned_at: string | null;
  createdAt: string;
  updatedAt: string;
  /** 엔진: 지금 단계가 끝나는 시각 (대기·도킹) */
  step_until: number;
  /** 엔진: 지금 단계의 이동을 시작했는지 */
  step_started: boolean;
  eta_seconds: number | null;
  /** 시뮬레이션 보고서용 시각 (시뮬레이션 시간 ms) */
  sim_created_ms?: number;
  sim_assigned_ms?: number | null;
  sim_started_ms?: number | null;
  sim_ended_ms?: number | null;
}

export const missions: MissionRow[] = [];

export interface AlertRow {
  id: number;
  is_simulation: boolean;
  type: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  robot_id: number | null;
  mission_id: number | null;
  site_id: number | null;
  status: 'ACTIVE' | 'RESOLVED';
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  createdAt: string;
  updatedAt: string;
  dedup_key: string | null;
}
export const alerts: AlertRow[] = [];

export interface AuditRow {
  id: number;
  createdAt: string;
  user_id: number | null;
  username: string | null;
  role: string | null;
  action: string;
  robot_id: number | null;
  target_type: string | null;
  target_id: string | null;
  result: 'SUCCESS' | 'FAILED';
  detail: unknown;
  ip: string | null;
}
export const auditLogs: AuditRow[] = [];

export function audit(action: string, fields: Partial<Omit<AuditRow, 'id' | 'createdAt' | 'action'>> = {}, at = Date.now()) {
  auditLogs.unshift({
    id: nextId('audit'),
    createdAt: iso(at),
    user_id: DEMO_USER.id,
    username: DEMO_USER.username,
    role: DEMO_USER.role,
    action,
    robot_id: null,
    target_type: null,
    target_id: null,
    result: 'SUCCESS',
    detail: null,
    ip: '127.0.0.1',
    ...fields,
  });
  if (auditLogs.length > 2000) auditLogs.length = 2000;
}

export const settings: { value: FleetSettings } = { value: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) };

export interface GroupRow {
  id: number;
  name: string;
  color: string | null;
  charge_threshold: number | null;
  charge_resume: number | null;
  created_by: string | null;
  robot_ids: number[];
}
export const groups: GroupRow[] = [];

export interface PresetRow {
  id: number;
  site_id: number;
  name: string;
  request: Record<string, unknown>;
  problem: string | null;
  created_by: string | null;
}
export const presets: PresetRow[] = [];
export const schedules: Array<Record<string, any> & { id: number }> = [];

export const users = [
  { id: 1, username: 'demo', name: '데모 관리자', role: 'SUPER_ADMIN', partner_id: null, is_active: true, must_change_password: false, last_login_at: iso(), createdAt: iso(BOOT - 30 * 86_400_000), updatedAt: iso() },
  { id: 2, username: 'operator', name: '현장 운영자', role: 'OPERATOR', partner_id: 1, is_active: true, must_change_password: false, last_login_at: iso(BOOT - 3_600_000), createdAt: iso(BOOT - 20 * 86_400_000), updatedAt: iso(BOOT - 86_400_000) },
  { id: 3, username: 'viewer', name: '모니터링', role: 'VIEWER', partner_id: 1, is_active: true, must_change_password: false, last_login_at: null, createdAt: iso(BOOT - 10 * 86_400_000), updatedAt: iso(BOOT - 10 * 86_400_000) },
];
