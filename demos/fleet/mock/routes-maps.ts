/**
 * 사이트·구역·지도(그림)·장소·교통 구역·설비 (서버 controllers/site·space·map·location·traffic·facility).
 * 데모에서 할 수 없는 일(로봇에서 지도 가져오기·보내기 등)은 이유를 알려 주는 오류로 답한다.
 */
import { del, demoOnly, get, notFound, num, post, put } from './router';
import { HttpError } from './events';
import { hub } from './hub';
import { audit, DEMO_USER, floorPng, iso, maps, mapView, nextId, pois, robots, spaces, SITE_ID, MAP_ID, type PoiRow } from './state';
import { poiView, siteView, spaceView } from './views';
import { POI_TYPES } from '@fleet-api/lib/poi-model';
import { ZONES } from '../../shared/world';

// ------------------------------------------------------------------ 사이트·구역

get('/api/fleet/sites', () => [siteView()]);
put('/api/fleet/sites/:id', ({ body }) => ({ ...siteView(), ...(body ?? {}) }));
get('/api/fleet/sites/arrivals', () => []);
post('/api/fleet/sites/:id/switch-map', () => demoOnly('사이트 지도 바꾸기'));

get('/api/fleet/spaces', () => spaces.map(spaceView));
post('/api/fleet/spaces', ({ body }) => {
  const s = { id: nextId('space', 2), site_id: SITE_ID, name: String(body?.name || '새 구역'), kind: body?.kind ?? 'AREA', sort_order: spaces.length + 1, description: body?.description ?? null, is_simulation: false, createdAt: iso(), updatedAt: iso() };
  spaces.push(s);
  return spaceView(s);
});
put('/api/fleet/spaces/:id', ({ params, body }) => {
  const s = spaces.find((x) => x.id === num(params.id)) ?? notFound('구역');
  Object.assign(s, body ?? {}, { updatedAt: iso() });
  return spaceView(s);
});
del('/api/fleet/spaces/:id', ({ params }) => {
  if (num(params.id) === 1) throw new HttpError(409, '로봇이 있는 구역은 지울 수 없습니다.');
  const i = spaces.findIndex((x) => x.id === num(params.id));
  if (i >= 0) spaces.splice(i, 1);
  return { ok: true };
});

// ------------------------------------------------------------------ 지도

const mapOf = (id: string) => maps.find((m) => m.id === num(id)) ?? notFound('지도');

get('/api/fleet/maps', () => maps.map(mapView));
get('/api/fleet/maps/:id', ({ params }) => mapView(mapOf(params.id)));
get('/api/fleet/maps/:id/image', async ({ params }) => {
  mapOf(params.id);
  return floorPng();
});
put('/api/fleet/maps/:id', ({ params, body }) => {
  const m = mapOf(params.id);
  if (typeof body?.name === 'string') m.name = body.name;
  if ('note' in (body ?? {})) m.note = body.note;
  if (body?.is_active) maps.filter((x) => x.space_id === m.space_id).forEach((x) => (x.is_active = x === m));
  m.updatedAt = iso();
  return mapView(m);
});
del('/api/fleet/maps/:id', ({ params }) => {
  if (num(params.id) === MAP_ID) throw new HttpError(409, '구역의 기준 지도는 지울 수 없습니다.');
  const i = maps.findIndex((x) => x.id === num(params.id));
  if (i >= 0) maps.splice(i, 1);
  return { ok: true };
});
get('/api/fleet/maps/:id/nav-graph', ({ params }) => ({ map_id: num(params.id), site_id: SITE_ID, nodes: [], edges: [], updated_by: null, updatedAt: null }));
put('/api/fleet/maps/:id/nav-graph', ({ params, body }) => ({ map_id: num(params.id), site_id: SITE_ID, nodes: body?.nodes ?? [], edges: body?.edges ?? [], updated_by: DEMO_USER.username, updatedAt: iso() }));
get('/api/fleet/maps/:id/alignments', ({ params }) =>
  robots
    .filter((r) => !r.is_virtual && r.map_id === num(params.id))
    .map((r) => ({ robot_id: r.id, robot_name: r.name, protocol: 'TETRA', map_id: num(params.id), aligned: false, transform: { tx: 0, ty: 0, theta: 0, scale: 1 }, pairs: [], rms_error: null, warn: false, robot_map_name: '1층 창고 지도', current_robot_map: null, warp: null, uses_fleet_map: true, robot_pose: { ...r.pose }, map_pose: { ...r.pose }, updated_by: null, updatedAt: null })),
);
for (const p of ['/api/fleet/maps/import', '/api/fleet/maps/upload', '/api/fleet/maps/robot-copy', '/api/fleet/maps/:id/edit', '/api/fleet/maps/:id/send', '/api/fleet/maps/:id/nav-graph/send', '/api/fleet/maps/:id/copy-from']) post(p, () => demoOnly('지도 가져오기·보내기·편집'));
get('/api/fleet/maps/:id/alignments/:robotId/robot-map', () => demoOnly('로봇 지도 읽기'));
get('/api/fleet/maps/:id/bundle', () => demoOnly('지도 내려받기'));
get('/api/fleet/maps/:id/export', () => demoOnly('지도 내보내기'));

// ------------------------------------------------------------------ 장소

const poiOf = (id: string) => pois.find((p) => p.id === num(id)) ?? notFound('장소');
function readPoi(body: any, base?: PoiRow): Omit<PoiRow, 'id'> {
  const type = body?.type ?? base?.type ?? 'WAYPOINT';
  if (!(POI_TYPES as readonly string[]).includes(type)) throw new HttpError(400, '장소 종류가 올바르지 않습니다.');
  const x = Number(body?.x ?? base?.x);
  const y = Number(body?.y ?? base?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new HttpError(400, '장소 좌표가 올바르지 않습니다.');
  const name = String(body?.name ?? base?.name ?? '').trim();
  if (!name) throw new HttpError(400, '장소 이름을 넣어 주세요.');
  return {
    site_id: SITE_ID,
    map_id: Number(body?.map_id ?? base?.map_id ?? MAP_ID),
    name,
    type,
    x,
    y,
    yaw: body?.yaw === undefined ? (base?.yaw ?? 0) : body.yaw === null ? null : Number(body.yaw),
    marker_id: body?.marker_id === undefined ? (base?.marker_id ?? (type === 'CHARGER' ? 9 : null)) : body.marker_id,
    robot_models: body?.robot_models === undefined ? (base?.robot_models ?? null) : body.robot_models,
  };
}

get('/api/fleet/locations', ({ query }) => pois.filter((p) => !query.map_id || p.map_id === Number(query.map_id)).map(poiView));
post('/api/fleet/locations', ({ body }) => {
  const p = { id: nextId('poi'), ...readPoi(body) };
  pois.push(p);
  audit('POI_CREATE', { target_type: 'LOCATION', target_id: String(p.id) });
  return poiView(p);
});
put('/api/fleet/locations/:id', ({ params, body }) => {
  const p = poiOf(params.id);
  Object.assign(p, readPoi(body, p));
  audit('POI_UPDATE', { target_type: 'LOCATION', target_id: String(p.id) });
  return poiView(p);
});
del('/api/fleet/locations/:id', ({ params }) => {
  const p = poiOf(params.id);
  pois.splice(pois.indexOf(p), 1);
  audit('POI_DELETE', { target_type: 'LOCATION', target_id: String(p.id) });
  return { ok: true };
});
post('/api/fleet/locations/import', () => demoOnly('로봇 장소 가져오기'));
post('/api/fleet/locations/send', () => demoOnly('로봇에 장소 보내기'));

// ------------------------------------------------------------------ 교통 구역 (현장 구역은 보이기만, 움직임에는 반영 안 함)·설비 (데모에는 없음)

const zones: Array<Record<string, any> & { id: number; map_id: number }> = ZONES.map((z) => ({
  id: nextId('zone'), site_id: SITE_ID, map_id: MAP_ID, name: z.name,
  // 싱글관제 가상벽(진입 금지) = 관제 RESTRICTED
  type: z.kind === 'NO_ENTRY' ? 'RESTRICTED' : 'SPEED_LIMIT',
  polygon: z.polygon.map((p) => [p.x, p.y]), capacity: 1, speed_limit: z.speed, params: {}, vda_only: false, enabled: true, supported: true,
}));
const zoneView = (z: (typeof zones)[number]) => ({ ...z, inside: [], granted: [], waiting: [] });
get('/api/fleet/traffic/zones', ({ query }) => zones.filter((z) => !query.map_id || z.map_id === Number(query.map_id)).map(zoneView));
post('/api/fleet/traffic/zones', ({ body }) => {
  const z = { id: nextId('zone'), site_id: SITE_ID, map_id: Number(body?.map_id ?? MAP_ID), name: String(body?.name ?? '구역'), type: body?.type ?? 'SPEED_LIMIT', polygon: body?.polygon ?? [], capacity: Number(body?.capacity ?? 1), speed_limit: body?.speed_limit ?? null, params: body?.params ?? {}, vda_only: false, enabled: body?.enabled ?? true, supported: true };
  zones.push(z);
  return zoneView(z);
});
put('/api/fleet/traffic/zones/:id', ({ params, body }) => {
  const z = zones.find((x) => x.id === num(params.id)) ?? notFound('교통 구역');
  Object.assign(z, body ?? {});
  return zoneView(z);
});
del('/api/fleet/traffic/zones/:id', ({ params }) => {
  const i = zones.findIndex((x) => x.id === num(params.id));
  if (i >= 0) zones.splice(i, 1);
  return { ok: true };
});
get('/api/fleet/traffic/status', () => ({ zones: [], waits: [] }));
post('/api/fleet/traffic/maps/:id/robot-sync', () => demoOnly('로봇 속도 구역·가상벽 맞추기'));
post('/api/fleet/traffic/maps/:id/robot-import', () => demoOnly('로봇 속도 구역·가상벽 가져오기'));

get('/api/fleet/lifts', () => []);
get('/api/fleet/doors', () => []);
get('/api/fleet/formations', () => []);
get('/api/fleet/mapping', () => null);
get('/api/fleet/vda5050', () => ({ enabled: false, broker_url: '', username: '', has_password: false, interface_name: 'uagv', major_version: 'v2', connected: false, error: null }));
post('/api/fleet/formations/preview', () => demoOnly('대형 모으기'));
post('/api/fleet/formations', () => demoOnly('대형 모으기'));
post('/api/fleet/mapping/start', () => demoOnly('여러 로봇으로 지도 만들기'));

// 화면이 처음 붙을 때 보내는 실시간 값들 (서버도 연결되면 현재 상태를 보낸다)
hub.onConnection((c) => {
  hub.send(c, 'fleet:traffic', { zones: [], waits: [] });
});
