/**
 * 미션·자주 쓰는 미션·반복 예약·알림 (서버 controllers/mission·preset·schedule·alert).
 */
import { del, get, notFound, num, post, put } from './router';
import { acknowledgeAlert, createMission, HttpError, type MissionCreateInput } from './events';
import { alerts, audit, DEMO_USER, iso, missions, nextId, presets, schedules, SITE_ID } from './state';
import { alertView, missionView } from './views';
import { cancelMission, pauseMission, resumeMission, retryMission } from './dispatch';

const missionOf = (id: string) => missions.find((m) => m.id === num(id)) ?? notFound('미션');

get('/api/fleet/missions', ({ query }) => {
  const sim = query.simulation === '1' || query.simulation === 'true';
  let rows = missions.filter((m) => m.is_simulation === sim);
  if (query.status) {
    const s = query.status.split(',');
    rows = rows.filter((m) => s.includes(m.status));
  }
  if (query.robot_id) rows = rows.filter((m) => m.assigned_robot_id === Number(query.robot_id));
  const limit = Math.min(1000, Math.max(1, Number(query.limit) || 200));
  return rows.slice(0, limit).map(missionView);
});
get('/api/fleet/missions/:id', ({ params }) => missionView(missionOf(params.id)));

post('/api/fleet/missions', ({ body }) => {
  const m = createMission(body as MissionCreateInput, 'USER');
  audit('MISSION_CREATE', { target_type: 'MISSION', target_id: String(m.id), robot_id: m.requested_robot_id, detail: { type: m.type, name: m.name } });
  return missionView(m);
});
post('/api/fleet/missions/:id/cancel', ({ params }) => cancelMission(missionOf(params.id)));
post('/api/fleet/missions/:id/pause', ({ params }) => {
  const m = missionOf(params.id);
  pauseMission(m);
  return missionView(m);
});
post('/api/fleet/missions/:id/resume', ({ params }) => {
  const m = missionOf(params.id);
  resumeMission(m);
  return missionView(m);
});
post('/api/fleet/missions/:id/retry', ({ params }) => missionView(retryMission(missionOf(params.id))));

// ------------------------------------------------------------------ 자주 쓰는 미션·반복 예약

const presetOf = (id: string) => presets.find((p) => p.id === num(id)) ?? notFound('자주 쓰는 미션');

get('/api/fleet/presets', () => presets);
post('/api/fleet/presets', ({ body }) => {
  const p = { id: nextId('preset'), site_id: SITE_ID, name: String(body?.name || '새 미션'), request: body?.request ?? {}, problem: null, created_by: DEMO_USER.username };
  presets.push(p);
  audit('PRESET_CREATE', { target_type: 'PRESET', target_id: String(p.id) });
  return p;
});
put('/api/fleet/presets/:id', ({ params, body }) => {
  const p = presetOf(params.id);
  if (typeof body?.name === 'string') p.name = body.name;
  if (body?.request) p.request = body.request;
  return p;
});
del('/api/fleet/presets/:id', ({ params }) => {
  const p = presetOf(params.id);
  presets.splice(presets.indexOf(p), 1);
  for (let i = schedules.length - 1; i >= 0; i--) if (schedules[i].preset_id === p.id) schedules.splice(i, 1);
  return { ok: true };
});
post('/api/fleet/presets/:id/run', ({ params, body }) => {
  const p = presetOf(params.id);
  const req = { ...(p.request as MissionCreateInput), name: p.name };
  if (body?.robot_id) Object.assign(req, { robot_id: body.robot_id, group_id: null });
  else if (body?.group_id) Object.assign(req, { group_id: body.group_id, robot_id: null });
  const m = createMission(req, 'PRESET');
  audit('MISSION_CREATE', { target_type: 'MISSION', target_id: String(m.id), detail: { preset: p.name } });
  return missionView(m);
});

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
function scheduleSummary(s: Record<string, any>): string {
  if (s.mode === 'LOOP') return '끝나면 바로 다시';
  const days: number[] = s.weekdays ?? [];
  const label = days.length === 7 ? '매일' : days.join() === '1,2,3,4,5' ? '평일' : days.join() === '0,6' ? '주말' : days.map((d) => WEEKDAY[d]).join('·');
  return `${label} ${s.time}`;
}
function nextRun(s: Record<string, any>): string | null {
  if (!s.enabled || s.mode !== 'TIME' || !s.time) return null;
  const [h, m] = String(s.time).split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now() && (s.weekdays ?? []).includes(d.getDay())) return iso(d.getTime());
  }
  return null;
}

get('/api/fleet/schedules', () => schedules);
post('/api/fleet/schedules', ({ body }) => {
  const preset = presetOf(String(body?.preset_id));
  const s: Record<string, any> & { id: number } = { id: nextId('schedule'), preset_id: preset.id, preset_name: preset.name, mode: body?.mode ?? 'TIME', run_count: 0, weekdays: body?.weekdays ?? [], time: body?.time ?? '09:00', tz_offset: body?.tz_offset ?? 0, robot_id: body?.robot_id ?? null, group_id: body?.group_id ?? null, enabled: body?.enabled ?? true, last_run_at: null, last_result: null, last_mission_id: null };
  s.summary = scheduleSummary(s);
  s.next_run_at = nextRun(s);
  schedules.push(s);
  audit('SCHEDULE_CREATE', { target_type: 'SCHEDULE', target_id: String(s.id) });
  return s;
});
put('/api/fleet/schedules/:id', ({ params, body }) => {
  const s = schedules.find((x) => x.id === num(params.id)) ?? notFound('반복 예약');
  Object.assign(s, body ?? {});
  s.summary = scheduleSummary(s);
  s.next_run_at = nextRun(s);
  return s;
});
del('/api/fleet/schedules/:id', ({ params }) => {
  const i = schedules.findIndex((x) => x.id === num(params.id));
  if (i >= 0) schedules.splice(i, 1);
  return { ok: true };
});

// ------------------------------------------------------------------ 알림

get('/api/fleet/alerts', ({ query }) => {
  const status = query.status ?? 'ACTIVE';
  let rows = alerts.filter((a) => !a.is_simulation);
  if (status !== 'ALL') rows = rows.filter((a) => a.status === status);
  const limit = Number(query.limit) || 50;
  const offset = Number(query.offset) || 0;
  return { count: rows.length, rows: rows.slice(offset, offset + limit).map(alertView) };
});
post('/api/fleet/alerts/ack-all', () => {
  alerts.filter((a) => a.status === 'ACTIVE' && !a.acknowledged_at).forEach((a) => acknowledgeAlert(a, DEMO_USER.username));
  return { ok: true };
});
post('/api/fleet/alerts/:id/ack', ({ params }) => {
  const a = alerts.find((x) => x.id === num(params.id)) ?? notFound('알림');
  if (a.acknowledged_at) throw new HttpError(409, '이미 확인한 알림입니다.');
  acknowledgeAlert(a, DEMO_USER.username);
  audit('ALERT_ACK', { target_type: 'ALERT', target_id: String(a.id), robot_id: a.robot_id });
  return alertView(a);
});
get('/api/fleet/incidents', () => []);
