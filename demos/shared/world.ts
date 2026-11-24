/**
 * 두 데모(멀티관제·싱글관제)가 함께 쓰는 "한 현장": 창고 지도, 이름 붙은 장소, 구역, 로봇 명단, 탭 사이 동기화 규격.
 *
 * 멀티관제 화면에서 로봇을 눌러 "로봇 화면 열기"로 싱글관제 데모를 열면 같은 지도·같은 장소 위에서 그 로봇을 보여 준다.
 * 그래서 장소·구역·로봇은 여기 한 곳에만 적고, 각 데모의 가짜 서버가 자기 응답 모양으로 바꿔 쓴다.
 * 좌표는 지도 좌표(m, 원점 = 지도 왼쪽 아래, floorplan.ts), 방향(yaw)은 +x 기준 반시계 rad.
 *
 * 장소 자리는 두 화면의 기본 배율에서 이름표가 서로·로봇 이름표와 겹치지 않게 골랐다 (scripts/label_overlap_check.cjs 가 검사).
 * 멀티관제 장소 이름표는 아이콘 오른쪽으로 약 5 m, 로봇 이름표는 로봇 아래로 약 8 m 폭을 차지한다.
 */
export * from './floorplan';

/** 멀티관제 장소 종류 (서버 lib/poi-model.ts). 싱글관제 종류로는 single/world/override.ts 가 바꾼다 */
export type PlaceType = 'PICKUP' | 'DROPOFF' | 'WAYPOINT' | 'CHARGER' | 'WAIT_ZONE';

export interface Place {
  name: string;
  type: PlaceType;
  x: number;
  y: number;
  /** 로봇이 그 자리에서 바라볼 방향. 충전소는 충전기 쪽 */
  yaw: number;
  /** 충전기 마커(태그) 번호 */
  markerId: number | null;
}

const H = Math.PI / 2;

export const PLACES: readonly Place[] = [
  // 왼쪽 벽 입고 문 두 곳 (문 쪽을 바라본다)
  { name: '입고장 A', type: 'PICKUP', x: 2.0, y: 19.9, yaw: Math.PI, markerId: null },
  { name: '입고장 B', type: 'PICKUP', x: 2.0, y: 3.1, yaw: Math.PI, markerId: null },
  // 선반 앞 집기 자리 (통로 가운데, 위 선반을 바라본다). 기둥(x 14.2·24.8)을 피하려고 통로 위쪽 줄을 쓴다
  { name: '선반 A-1', type: 'WAYPOINT', x: 9, y: 7.6, yaw: H, markerId: null },
  { name: '선반 A-2', type: 'WAYPOINT', x: 19.2, y: 7.6, yaw: H, markerId: null },
  { name: '선반 B-1', type: 'WAYPOINT', x: 9, y: 11.25, yaw: H, markerId: null },
  { name: '선반 B-2', type: 'WAYPOINT', x: 19.2, y: 15.6, yaw: H, markerId: null },
  // 출고장: 컨베이어(y 8.6~9.4) 아래·위
  { name: '출고장 1', type: 'DROPOFF', x: 31.5, y: 7.5, yaw: H, markerId: null },
  { name: '출고장 2', type: 'DROPOFF', x: 31.5, y: 10.6, yaw: -H, markerId: null },
  // 사무 구역: 사무실 안쪽은 진입 금지라 서류는 문 앞에 둔다
  { name: '사무실', type: 'DROPOFF', x: 34.2, y: 16.8, yaw: H, markerId: null },
  { name: '회의실', type: 'WAYPOINT', x: 31.25, y: 18.6, yaw: H, markerId: null },
  // 충전 구역: x 33 칸막이에 세로로 붙은 충전기 3대 (로봇은 칸막이 쪽을 보고 붙는다)
  { name: '충전소 1', type: 'CHARGER', x: 33.75, y: 1.9, yaw: Math.PI, markerId: 1 },
  { name: '충전소 2', type: 'CHARGER', x: 33.75, y: 3.5, yaw: Math.PI, markerId: 2 },
  { name: '충전소 3', type: 'CHARGER', x: 33.75, y: 5.1, yaw: Math.PI, markerId: 3 },
  // 일 없는 로봇이 서 있는 곳 (오른쪽 세로 통로)
  { name: '대기 장소 1', type: 'WAIT_ZONE', x: 25.9, y: 21.6, yaw: -H, markerId: null },
  { name: '대기 장소 2', type: 'WAIT_ZONE', x: 25.9, y: 10.3, yaw: Math.PI, markerId: null },
];

export const placeByName = (name: string): Place => {
  const place = PLACES.find((p) => p.name === name);
  if (!place) throw new Error(`[demo world] 장소가 없습니다: ${name}`);
  return place;
};

export interface Point {
  x: number;
  y: number;
}

/**
 * 현장 구역. 싱글관제에서는 SPEED_LIMIT = 속도지정구간, NO_ENTRY = 가상벽(다각형),
 * 멀티관제에서는 교통 구역 SPEED_LIMIT·RESTRICTED 로 보인다 (데모 로봇 움직임에는 반영하지 않는다)
 */
export interface Zone {
  name: string;
  kind: 'SPEED_LIMIT' | 'NO_ENTRY';
  polygon: readonly Point[];
  /** SPEED_LIMIT 의 최고 속도 (m/s) */
  speed: number | null;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

export const ZONES: readonly Zone[] = [
  // 출고장은 사람이 짐을 내리고 컨베이어에 올리는 곳이라 천천히 지나간다
  { name: '출고장 서행', kind: 'SPEED_LIMIT', polygon: rect(28.0, 6.6, 35.0, 11.4), speed: 0.3 },
  // 사무 구역 출입문: 사람이 문에서 갑자기 나올 수 있다
  { name: '출입문 서행', kind: 'SPEED_LIMIT', polygon: rect(30.9, 11.8, 34.6, 13.4), speed: 0.3 },
  // 사무실 안쪽 책상 사이는 좁고 사람이 많아 로봇이 들어가지 않는다
  { name: '사무실 진입 금지', kind: 'NO_ENTRY', polygon: rect(33.3, 17.8, 38.8, 22.8), speed: null },
];

/** 점이 다각형 안에 있는지 (짝수-홀수 규칙) */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface RosterRobot {
  id: number;
  name: string;
  /** 멀티관제 모델 이름 (TETRA-M …). 싱글관제 모델 옵션은 modelKey 로 바꾼다 */
  model: string;
  start: { x: number; y: number; yaw: number };
  battery: number;
  /** 처음에 충전기에 붙어 있으면 그 충전소 이름 */
  dockedAt: string | null;
  /** 싱글관제 데모가 혼자 돌 때 충전하러 가는 곳 */
  homeCharger: string;
}

// 처음 자리: 장소 이름표·다른 로봇 이름표와 겹치지 않는 통로 위. 로봇 이름표는 로봇 아래로 약 8 m 폭이라 위쪽 넓은 통로에 띄엄띄엄 둔다.
// 충전기 위에서 시작하지 않는다: 멀티관제 지도에서 로봇 몸통이 충전소 이름표를 가린다 (원본 화면 배치)
export const ROBOTS: readonly RosterRobot[] = [
  { id: 1, name: 'TETRA-M 01', model: 'TETRA-M', start: { x: 15.0, y: 2.8, yaw: 0 }, battery: 71, dockedAt: null, homeCharger: '충전소 1' },
  { id: 2, name: 'TETRA-H 02', model: 'TETRA-H', start: { x: 22.5, y: 21.8, yaw: 0 }, battery: 88, dockedAt: null, homeCharger: '충전소 2' },
  { id: 3, name: 'TETRA-S 03', model: 'TETRA-S', start: { x: 3.0, y: 13.4, yaw: -H }, battery: 64, dockedAt: null, homeCharger: '충전소 3' },
  { id: 4, name: 'TETRA-MH 04', model: 'TETRA-MH', start: { x: 12.5, y: 21.8, yaw: Math.PI }, battery: 34, dockedAt: null, homeCharger: '충전소 2' },
];

/** 'TETRA-MH' → 'mh' (싱글관제 옵션 model) */
export const modelKey = (model: string): string => model.replace(/^TETRA-/i, '').toLowerCase();

// ------------------------------------------------------------------ 탭 사이 동기화 (BroadcastChannel)

/** 멀티관제 데모가 로봇 상태를 내보내고 싱글관제 데모가 듣는 채널 이름 (같은 출처의 탭끼리만 닿는다) */
export const FLEET_SYNC_CHANNEL = 'tetra-demo-fleet';
/** 이보다 오래 소식이 없으면 싱글관제 데모는 따라 하기를 멈추고 자기 길로 돌아간다 */
export const FLEET_SYNC_STALE_MS = 3000;

export interface FleetSyncRobot {
  id: number;
  name: string;
  model: string;
  x: number;
  y: number;
  yaw: number;
  battery: number;
  speed: number;
  /** 'going' | 'charging' | 'docking' | 'normal' | 'stop' … (멀티관제 nav_state) */
  state: string;
  /** 지금 가는 길 (지도 좌표). 없으면 빈 배열 */
  path: Array<[number, number]>;
}

export interface FleetSyncMessage {
  kind: 'fleet-robots';
  sentAt: number;
  robots: FleetSyncRobot[];
}
