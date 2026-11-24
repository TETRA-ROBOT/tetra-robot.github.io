/**
 * 로그인·로봇·비상정지·그룹·설정·현황·사용자·조작 이력 (서버 controllers/auth·robot·group·settings·stats·user·audit).
 */
import { applySettingsPatch } from '@fleet-api/lib/settings-schema';
import { computeStats, statsWindow, MAX_STATS_DAYS } from '@fleet-api/lib/ops-stats';
import { hub } from './hub';
import { del, get, notFound, num, post, put, demoOnly } from './router';
import { HttpError, requestSnapshot } from './events';
import { alerts, audit, auditLogs, DEMO_USER, groups, iso, maps, missions, newRobot, nextId, pois, robots, settings, users, MAP_ID } from './state';
import { allRobotViews, groupsView, robotView, activeMissionOf } from './views';
import { emergencyStop, releaseHold } from './dispatch';
import { haltRobot } from './engine';

// ------------------------------------------------------------------ 로그인 (아무 아이디·비밀번호나 데모 관리자로)

const b64url = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function makeToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: DEMO_USER.id, username: DEMO_USER.username, role: DEMO_USER.role, iat: now, exp: now + 7 * 86_400 })}.demo-signature`;
}
const session = () => ({ token: makeToken(), user: { ...DEMO_USER } });

post('/api/auth/login', () => {
  audit('LOGIN', { target_type: 'USER', target_id: String(DEMO_USER.id) });
  return session();
});
get('/api/auth/me', () => ({ user: { ...DEMO_USER } }));
post('/api/auth/change-password', () => session());
post('/api/auth/logout', () => ({ ok: true }));
get('/api/health', () => ({ status: 'ok', db: 'ok', version: { display: '26.11.1 · 데모', version: '26.11.1', build: 'demo' }, uptime_sec: Math.round(performance.now() / 1000) }));

// ------------------------------------------------------------------ 로봇

const robotOf = (id: string) => robots.find((r) => r.id === num(id)) ?? notFound('로봇');

get('/api/fleet/robots', () => allRobotViews());
get('/api/fleet/robots/:id', ({ params }) => robotView(robotOf(params.id)));

post('/api/fleet/robots', ({ body }) => {
  const wait = pois.find((p) => p.type === 'WAIT_ZONE' && p.map_id === MAP_ID && !robots.some((r) => Math.hypot(r.pose.x - p.x, r.pose.y - p.y) < 1));
  if (!wait) throw new HttpError(400, '새 로봇을 세울 빈 대기 장소가 없습니다.');
  const model = typeof body?.model_type === 'string' && body.model_type ? body.model_type : 'TETRA-M';
  const r = newRobot({ name: String(body?.name || `${model} ${String(robots.length + 1).padStart(2, '0')}`), model, x: wait.x, y: wait.y, yaw: wait.yaw ?? 0, battery: 90 });
  robots.push(r);
  audit('ROBOT_CREATE', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  requestSnapshot();
  return robotView(r);
});
put('/api/fleet/robots/:id', ({ params, body }) => {
  const r = robotOf(params.id);
  if (typeof body?.name === 'string' && body.name.trim()) r.name = body.name.trim();
  if (typeof body?.model_type === 'string' && body.model_type) r.model_type = body.model_type;
  audit('ROBOT_UPDATE', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  requestSnapshot();
  return robotView(r);
});
del('/api/fleet/robots/:id', ({ params }) => {
  const r = robotOf(params.id);
  if (activeMissionOf(r.id)) throw new HttpError(409, '미션을 하는 중인 로봇은 지울 수 없습니다.');
  robots.splice(robots.indexOf(r), 1);
  groups.forEach((g) => (g.robot_ids = g.robot_ids.filter((id) => id !== r.id)));
  audit('ROBOT_DELETE', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  requestSnapshot();
  return { ok: true };
});

post('/api/fleet/robots/control/emergency-stop-all', () => {
  const summary = emergencyStop(robots.filter((r) => !r.is_virtual));
  hub.broadcast('fleet:alert:emergency_stop', { site_id: 1, group_name: null, timestamp: iso(), by: DEMO_USER.username, results: summary.results });
  return summary;
});
post('/api/fleet/robots/control/release-hold', () => releaseHold(robots.filter((r) => !r.is_virtual)));
post('/api/fleet/robots/:id/emergency-stop', ({ params }) => emergencyStop([robotOf(params.id)]).results[0]);
post('/api/fleet/robots/:id/release-hold', ({ params }) => releaseHold([robotOf(params.id)]));

put('/api/fleet/robots/:id/servo', ({ params, body }) => {
  const r = robotOf(params.id);
  if (r.estop_latched && body?.servo) throw new HttpError(409, '로봇 비상정지가 걸려 있어 모터를 켤 수 없습니다. [운행 재개]를 누르세요.');
  r.servo = !!body?.servo;
  if (!r.servo) haltRobot(r, 'stop');
  audit(r.servo ? 'SERVO_ON' : 'SERVO_OFF', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  requestSnapshot();
  return { servo: r.servo };
});
put('/api/fleet/robots/:id/service', ({ params, body }) => {
  const r = robotOf(params.id);
  r.out_of_service = !!body?.out_of_service;
  r.service_note = r.out_of_service ? String(body?.note ?? '') || null : null;
  audit(r.out_of_service ? 'ROBOT_SERVICE_OFF' : 'ROBOT_SERVICE_ON', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  requestSnapshot();
  return robotView(r);
});
post('/api/fleet/robots/:id/localize', ({ params, body }) => {
  const r = robotOf(params.id);
  if (r.speed > 0.05) throw new HttpError(409, '움직이는 중에는 위치를 다시 잡을 수 없습니다.');
  r.pose = { x: Number(body?.x) || r.pose.x, y: Number(body?.y) || r.pose.y, yaw: Number(body?.yaw) || 0 };
  hub.broadcast('fleet:robot:pose', { robot_id: r.id, ...r.pose });
  return { progress: 'sent' };
});
get('/api/fleet/robots/:id/camera', () => ({ available: false }));
get('/api/fleet/robots/:id/ping', ({ params }) => ({ ok: true, reachable: true, latency_ms: 3, robot_id: num(params.id) }));
get('/api/fleet/robots/:id/wifi', () => demoOnly('로봇 와이파이'));
// 로봇 화면 열기: 실제 관제는 /single/<ID>/ 로 로봇 화면을 중계한다. 데모는 같은 사이트의 싱글관제 데모를 그 로봇으로 연다.
// 화면이 빈 창에 이 주소를 넣으므로 절대 주소로 준다. 싱글관제는 해시 주소를 쓰므로 쿼리는 # 앞에 둔다 (어느 하위 경로에서도 맞게 지금 주소 기준)
post('/api/fleet/robots/:id/single-console', ({ params }) => {
  const r = robotOf(params.id);
  if (r.is_virtual) throw new HttpError(409, '가상 로봇에는 로봇 화면이 없습니다.');
  const url = new URL(`../single/?robot=${r.id}`, window.location.href);
  url.hash = '';
  audit('SINGLE_CONSOLE_OPEN', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id), detail: { name: r.name, ip: r.ip_address } });
  return { success: true, url: url.href };
});
post('/api/fleet/robots/scan', () => ({ robots: [], scanned: 0 }));

/** 배터리 그래프: 지난 시간은 그럴듯하게 만들어 내고, 끝은 지금 값 */
get('/api/fleet/robots/:id/history', ({ params, query }) => {
  const r = robotOf(params.id);
  const hours = Math.min(168, Math.max(1, Number(query.hours) || 24));
  const n = 120;
  const now = Date.now();
  const battery = Array.from({ length: n + 1 }, (_, i) => {
    const t = now - ((n - i) / n) * hours * 3600_000;
    const phase = ((t / 3600_000 + r.id * 1.7) % 3) / 3; // 3시간 주기 톱니
    const v = i === n ? r.battery : 35 + 60 * (phase < 0.75 ? 1 - phase / 0.75 : (phase - 0.75) / 0.25);
    return { at: iso(t), value: Math.round(v) };
  });
  const values = battery.map((b) => b.value);
  const jobs = missions
    .filter((m) => m.assigned_robot_id === r.id && m.completed_at && Date.parse(m.completed_at) > now - hours * 3600_000)
    .slice(0, 30)
    .map((m) => ({ job_id: m.id, name: m.name, result: m.status === 'COMPLETED' ? 'COMPLETED' : m.status === 'CANCELED' ? 'CANCELED' : 'FAILED', done: m.status === 'COMPLETED' ? m.steps.length : m.current_step, failed: m.status === 'FAILED' ? 1 : 0, ended_at: m.completed_at }));
  return { robot_id: r.id, hours, jobs, battery, battery_stats: { min: Math.min(...values), max: Math.max(...values), avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), count: values.length } };
});

const lastJogAudit = new Map<number, number>();
/** 수동 조종: 화면이 100ms 마다 보내는 속도. 0.5초 안에 다음 명령이 없으면 선다 */
hub.onClientEvent('fleet:robot:jog', (data) => {
  const d = data as { robot_id: number; linearX: number; angularZ: number };
  const r = robots.find((x) => x.id === Number(d?.robot_id));
  if (!r) return;
  const lin = Math.max(-0.6, Math.min(0.6, Number(d.linearX) || 0));
  const ang = Math.max(-1.2, Math.min(1.2, Number(d.angularZ) || 0));
  const was = !!r.jog;
  r.jog = lin === 0 && ang === 0 ? null : { lin, ang, until: Date.now() + 500 };
  if (was !== !!r.jog) requestSnapshot();
  if (!was && r.jog && Date.now() - (lastJogAudit.get(r.id) ?? 0) > 30_000) {
    lastJogAudit.set(r.id, Date.now());
    audit('JOG_START', { robot_id: r.id, target_type: 'ROBOT', target_id: String(r.id) });
  }
});

// ------------------------------------------------------------------ 그룹

const groupOf = (id: string) => groups.find((g) => g.id === num(id)) ?? notFound('그룹');
const broadcastGroups = () => hub.broadcast('fleet:groups', groupsView());

get('/api/fleet/groups', () => groupsView());
post('/api/fleet/groups', ({ body }) => {
  const g = { id: nextId('group'), name: String(body?.name || '새 그룹'), color: body?.color ?? null, charge_threshold: body?.charge_threshold ?? null, charge_resume: body?.charge_resume ?? null, created_by: DEMO_USER.username, robot_ids: Array.isArray(body?.robot_ids) ? body.robot_ids.map(Number) : [] };
  groups.push(g);
  audit('GROUP_CREATE', { target_type: 'GROUP', target_id: String(g.id) });
  broadcastGroups();
  return g;
});
put('/api/fleet/groups/:id', ({ params, body }) => {
  const g = groupOf(params.id);
  for (const k of ['name', 'color', 'charge_threshold', 'charge_resume'] as const) if (body && k in body) (g as any)[k] = body[k];
  if (Array.isArray(body?.robot_ids)) g.robot_ids = body.robot_ids.map(Number);
  audit('GROUP_UPDATE', { target_type: 'GROUP', target_id: String(g.id) });
  broadcastGroups();
  return g;
});
del('/api/fleet/groups/:id', ({ params }) => {
  const g = groupOf(params.id);
  groups.splice(groups.indexOf(g), 1);
  broadcastGroups();
  return { ok: true };
});
post('/api/fleet/groups/:id/emergency-stop', ({ params }) => {
  const g = groupOf(params.id);
  const summary = emergencyStop(robots.filter((r) => g.robot_ids.includes(r.id)), g.name);
  hub.broadcast('fleet:alert:emergency_stop', { site_id: 1, group_name: g.name, timestamp: iso(), by: DEMO_USER.username, results: summary.results });
  return summary;
});
post('/api/fleet/groups/:id/release-hold', ({ params }) => {
  const g = groupOf(params.id);
  return releaseHold(robots.filter((r) => g.robot_ids.includes(r.id)));
});

// ------------------------------------------------------------------ 설정·초기 설정·현황

get('/api/fleet/settings', () => settings.value);
put('/api/fleet/settings', ({ body }) => {
  const res = applySettingsPatch(settings.value, body);
  if (!res.ok) throw new HttpError(400, res.error);
  settings.value = res.value;
  audit('SETTINGS_UPDATE', { target_type: 'SETTINGS', target_id: 'fleet' });
  hub.broadcast('fleet:settings', settings.value);
  return settings.value;
});
get('/api/fleet/settings/charge-sync', () => []);

get('/api/fleet/setup/status', () => ({
  sites: 1,
  robots: robots.filter((r) => !r.is_virtual).length,
  robots_online: robots.filter((r) => !r.is_virtual && r.online).length,
  maps: maps.filter((m) => !m.is_simulation).length,
  robots_map_unchecked: 0,
  pois: pois.filter((p) => p.map_id === MAP_ID).length,
  chargers: pois.filter((p) => p.map_id === MAP_ID && p.type === 'CHARGER').length,
  auto_charge_enabled: settings.value.autoCharge.enabled,
  missions_completed: missions.filter((m) => m.status === 'COMPLETED' && !m.is_simulation).length,
  users_pending_password: 0,
  operators: users.filter((u) => u.role === 'OPERATOR').length,
}));

get('/api/fleet/stats', ({ query }) => {
  const days = Math.min(MAX_STATS_DAYS, Math.max(1, Number(query.days) || 1));
  const tz = Number(query.tz_offset) || 0;
  const { from, to } = statsWindow(Date.now(), days, tz);
  return computeStats({
    missions: missions.filter((m) => !m.is_simulation),
    alerts: alerts.filter((a) => !a.is_simulation),
    robots: robots.filter((r) => !r.is_virtual).map((r) => ({ id: r.id, name: r.name })),
    from,
    to,
    days,
    tzOffsetMin: tz,
  });
});

// ------------------------------------------------------------------ 사용자·조작 이력

get('/api/fleet/users', () => users);
post('/api/fleet/users', ({ body }) => {
  const u = { id: nextId('user', 4), username: String(body?.username || 'user'), name: String(body?.name || ''), role: String(body?.role || 'VIEWER'), partner_id: 1, is_active: true, must_change_password: true, last_login_at: null, createdAt: iso(), updatedAt: iso() };
  users.push(u as (typeof users)[number]);
  return { ...u, temporary_password: 'demo-1234' };
});
put('/api/fleet/users/:id', ({ params, body }) => {
  const u = users.find((x) => x.id === num(params.id)) ?? notFound('사용자');
  Object.assign(u, body ?? {}, { updatedAt: iso() });
  return u;
});
post('/api/fleet/users/:id/reset-password', ({ params }) => ({ id: num(params.id), username: users.find((u) => u.id === num(params.id))?.username, temporary_password: 'demo-1234' }));

get('/api/fleet/audit-logs', ({ query }) => {
  let rows = auditLogs.slice();
  if (query.action) rows = rows.filter((r) => query.action.split(',').includes(r.action));
  if (query.robot_id) rows = rows.filter((r) => r.robot_id === Number(query.robot_id));
  if (query.username) rows = rows.filter((r) => r.username?.includes(query.username));
  if (query.from) rows = rows.filter((r) => r.createdAt >= new Date(query.from).toISOString());
  if (query.to) rows = rows.filter((r) => r.createdAt <= new Date(query.to).toISOString());
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  return { count: rows.length, rows: rows.slice(offset, offset + limit) };
});
get('/api/fleet/audit-logs/export', () => new Blob(['﻿시각,사용자,조작\n' + auditLogs.map((a) => `${a.createdAt},${a.username},${a.action}`).join('\n')], { type: 'text/csv' }));
