/**
 * 싱글관제 데모를 멀티관제 데모와 같은 현장(demos/shared/world.ts)으로 바꿔 끼운다. 원본 목업(mock/)은 고치지 않는다.
 *
 * 바꾸는 방법은 두 가지다.
 * 1) 원본 목업이 내보내는 메모리 데이터(status·maps·locations, 그리고 GET 처리기가 돌려주는 가상벽·구간·경로 그래프·플랜 배열)를
 *    앱이 뜨기 전에 그 자리에서 바꾼다.
 * 2) 원본이 함수 안에서 만드는 응답(GET /map 격자)은 mock-backend.ts 가 원본보다 먼저 overrideRequest() 에 묻는다.
 *
 * 원본 목업의 모양이 바뀌어 바꿔 끼울 자리를 못 찾으면 조용히 원본 사무실 지도로 돌지 않고 바로 오류를 던진다
 * (확인 시험 scripts/smoke_test.cjs 가 페이지 오류와 로봇 위치로 잡는다).
 */
import OPTION from '@api/lib/option/index';
import { MAP_ID, locations, maps, status } from '@mock/data';
import { ZONE_ROUTES } from '@mock/zones';
import { ROUTE_GRAPH_ROUTES } from '@mock/route-graph';
import { TASK_ROUTES } from '@mock/tasks';
import type { MockResponse } from '@mock/routes';
import { HEIGHT, ORIGIN, PLACES, RESOLUTION, WIDTH, ZONES, buildFloorPixels, insidePolygon, modelKey, type Place, type RosterRobot } from '../../shared/world';
import { AISLE_EDGES, AISLE_NODES } from '../../shared/aisles';

type Row = Record<string, any>;
type Handler = (request: { body: Row; params: Record<string, string>; query: Record<string, string> }) => unknown;

/** 지도 이름 (멀티관제 데모의 지도 이름과 같다) */
export const WAREHOUSE_MAP_NAME = '1층 창고 지도';

function fail(what: string): never {
  throw new Error(`[demo world] 원본 목업이 바뀌어 현장을 바꿔 끼우지 못했습니다: ${what}`);
}

/** 원본 처리기 표에서 GET 처리기가 돌려주는 배열(원본 메모리 데이터 자체)을 꺼낸다 */
function liveArray(routes: Array<[string, string, Handler]>, path: string, pick?: (result: any) => unknown): Row[] {
  const route = routes.find(([method, pattern]) => method === 'GET' && pattern === path) ?? fail(`GET ${path} 처리기 없음`);
  const result = route[2]({ body: {}, params: {}, query: {} });
  const list = pick ? pick(result) : result;
  if (!Array.isArray(list)) fail(`GET ${path} 응답이 배열이 아님`);
  return list;
}

const yawQuat = (yaw: number) => ({ location_position_qx: 0, location_position_qy: 0, location_position_qz: Math.sin(yaw / 2), location_position_qw: Math.cos(yaw / 2) });

/** 멀티관제 장소 종류 → 싱글관제 위치 종류. 싣기·내리기 위치는 적재 장치(리프트·컨베이어)가 있는 모델만 쓸 수 있다 */
function locationType(place: Place): string {
  const loader = Number(status.use_lift) === 1 || Number(status.use_conveyor) === 1;
  if (place.type === 'CHARGER') return 'DOCKING';
  if (place.type === 'PICKUP' && loader) return 'LOAD';
  if (place.type === 'DROPOFF' && loader) return 'UNLOAD';
  return 'LOCATION';
}

/** 모델 옵션: 실제 로봇처럼 모델 기본값(tetra_<모델>_option.ts)을 얹는다. 목업이 일부러 켜 둔 값은 그대로 둔다 */
function applyModel(robot: RosterRobot): void {
  const key = modelKey(robot.model);
  const base = OPTION.getFlatDefaultOption() as unknown as Row;
  const model = OPTION.getFlatDefaultOption(key) as unknown as Row;
  const keep = new Set(['map_id', 'dock_keepout', 'status_tracking_enabled', 'status_tracking_interval', 'status_tracking_fields']);
  for (const [name, value] of Object.entries(model)) {
    if (!keep.has(name) && JSON.stringify(value) !== JSON.stringify(base[name])) status[name] = value;
  }
  status.model = key;
  status.options = OPTION.getDefaultOption(key);
  if (status.model !== key) fail('status.model');
}

function applyLocations(): Map<string, number> {
  const template = locations.find((row) => row.location_environment === 'indoor') ?? fail('실내 위치 행');
  const ids = new Map<string, number>();
  const indoor = PLACES.map((place, index) => {
    ids.set(place.name, index + 1);
    return {
      ...template,
      location_id: index + 1,
      location_name: place.name,
      location_type: locationType(place),
      location_position_x: place.x,
      location_position_y: place.y,
      location_position_z: 0,
      ...yawQuat(place.yaw),
      map_id: MAP_ID,
      autodocking: place.type === 'CHARGER' ? 'Y' : 'N',
      docking_id: place.markerId,
      route_node_id: null,
    };
  });
  // 원본 목업의 실외(GPS) 위치(정문·주차장)는 뺀다: 이 현장에는 실외 지도가 없고, 원본 화면은 실내 지도에도 (0, 0)에 겹쳐 그린다
  locations.splice(0, locations.length, ...indoor);
  return ids;
}

function applyZones(): void {
  const obstacles = liveArray(ZONE_ROUTES, '/obstacle');
  const areas = liveArray(ZONE_ROUTES, '/area');
  const walls = ZONES.filter((z) => z.kind === 'NO_ENTRY');
  const speeds = ZONES.filter((z) => z.kind === 'SPEED_LIMIT');
  obstacles.splice(0, obstacles.length, ...walls.map((zone, index) => ({
    obstacle_id: index + 1, map_id: MAP_ID, obstacle_name: zone.name,
    ObstaclePoints: zone.polygon.map((p, order) => ({ obstacle_point_x: p.x, obstacle_point_y: p.y, obstacle_point_z: 0, obstacle_point_order: order })),
  })));
  areas.splice(0, areas.length, ...speeds.map((zone, index) => ({
    area_id: index + 1, map_id: MAP_ID, area_name: zone.name, area_type: 'SPEED_LIMIT', area_params: {}, area_speed: zone.speed, area_alert: 'N',
    Area_points: zone.polygon.map((p, order) => ({ area_point_x: p.x, area_point_y: p.y, area_point_z: 0, area_point_order: order })),
  })));
}

/** 경로 지정 주행 그래프 = 창고 통로 그래프. 번호는 원본 목업이 새로 매기는 번호(6, 7 …)와 겹치지 않게 1001 부터 */
function applyRouteGraph(): void {
  const graph = ROUTE_GRAPH_ROUTES.find(([method, pattern]) => method === 'GET' && pattern === '/route/graph') ?? fail('GET /route/graph 처리기 없음');
  const result = graph[2]({ body: {}, params: {}, query: {} }) as Row;
  if (!Array.isArray(result?.nodes) || !Array.isArray(result?.edges)) fail('GET /route/graph 응답 모양');
  const nodeId = new Map(AISLE_NODES.map((node, index) => [node.key, 1001 + index]));
  result.nodes.splice(0, result.nodes.length, ...AISLE_NODES.map((node) => ({
    route_node_id: nodeId.get(node.key), map_id: MAP_ID, node_x: node.x, node_y: node.y, rotate_in_place: false, latitude: null, longitude: null,
  })));
  const nodeAt = new Map(AISLE_NODES.map((node) => [node.key, node]));
  result.edges.splice(0, result.edges.length, ...AISLE_EDGES.map(([a, b], index) => {
    const p = nodeAt.get(a)!;
    const q = nodeAt.get(b)!;
    // 서행 구간 안을 지나는 통로는 경로 그래프에도 같은 속도를 건다
    const middle = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const slow = ZONES.find((zone) => zone.kind === 'SPEED_LIMIT' && insidePolygon(middle, zone.polygon));
    return {
      route_edge_id: 2001 + index, map_id: MAP_ID, start_node_id: nodeId.get(a), end_node_id: nodeId.get(b), bidirectional: true, edge_closed: false,
      speed_limit: slow?.speed ?? null, trajectory: null, rotate_on_entry: false,
    };
  }));
  // 일반 위치만 노드에 묶을 수 있다 (원본 bindLocation 과 같은 규칙)
  for (const row of locations) {
    if (row.location_environment === 'indoor' && row.location_type === 'LOCATION') row.route_node_id = nodeId.get(row.location_name) ?? null;
  }
}

/** 원본 목업 플랜이 가리키던 위치(입구·회의실)를 창고 장소로 바꾼다 */
function applyTasks(ids: Map<string, number>): void {
  const rename: Record<string, string> = { 입구: '입고장 A' };
  for (const work of liveArray(TASK_ROUTES, '/work')) {
    for (const task of work.Tasks ?? []) {
      if (task.location_name) {
        task.location_name = rename[task.location_name] ?? task.location_name;
        task.location_id = ids.get(task.location_name) ?? fail(`플랜 위치 ${task.location_name}`);
      }
      if (typeof task.task_data === 'string') task.task_data = task.task_data.replace('입구', '입고장 A');
    }
  }
}

/** 앱이 뜨기 전에 한 번 부른다 */
export function applyWorldOverride(robot: RosterRobot): void {
  if (Number(maps[0]?.map_id) !== MAP_ID) fail('maps[0] 이 첫 지도가 아님');
  maps[0].map_name = WAREHOUSE_MAP_NAME;
  maps[0].map_filepath = 'warehouse-1f';
  applyModel(robot);
  const ids = applyLocations();
  applyZones();
  applyRouteGraph();
  applyTasks(ids);
}

// ------------------------------------------------------------------ 지도 격자 (원본은 함수 안에서 만들어 바로 바꿀 수 없다)

let grid: Row | null = null;

/** 창고 지도를 nav_msgs/OccupancyGrid 모양으로 (data[0] = 왼쪽 아래 칸, 0 빈 곳·100 벽·-1 모름) */
function warehouseGrid(): Row {
  if (grid) return grid;
  const pixels = buildFloorPixels(); // 위쪽 행부터, 254 빈 곳·0 벽·205 모름
  const data = new Array<number>(WIDTH * HEIGHT);
  for (let row = 0; row < HEIGHT; row++) {
    const source = (HEIGHT - 1 - row) * WIDTH;
    for (let col = 0; col < WIDTH; col++) {
      const value = pixels[source + col];
      data[row * WIDTH + col] = value === 0 ? 100 : value === 205 ? -1 : 0;
    }
  }
  grid = {
    header: { frame_id: 'map' },
    info: { resolution: RESOLUTION, width: WIDTH, height: HEIGHT, origin: { position: { x: ORIGIN.x, y: ORIGIN.y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
    data,
  };
  return grid;
}

/**
 * 원본 목업보다 먼저 답할 요청. 창고 지도를 쓰는 중이면 GET /map, 지도 편집의 GET /map/1 을 창고 격자로 바꾼다.
 * @param upstream 원본 목업에 같은 요청을 보내는 함수 (지도 행 정보는 원본 것을 쓴다)
 */
export function overrideRequest(method: string, path: string, upstream: () => MockResponse): MockResponse | null {
  if (method !== 'GET') return null;
  if (path === '/map' && Number(status.map_id) === MAP_ID) return { body: warehouseGrid() };
  if (path === `/map/${MAP_ID}`) {
    const result = upstream();
    const g = warehouseGrid();
    return { ...result, body: { ...(result.body as Row), width: g.info.width, height: g.info.height, data: g.data, origin: [ORIGIN.x, ORIGIN.y, 0], resolution: RESOLUTION } };
  }
  return null;
}
