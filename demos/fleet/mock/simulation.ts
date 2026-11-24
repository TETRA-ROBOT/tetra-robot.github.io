/**
 * 시뮬레이터 (서버 services/simulation.ts 흉내): 저장한 설정마다 시뮬레이션 구역·지도(1층 지도 복사)를 두고,
 * 시작하면 그 지도에 가상 로봇을 세워 분당 작업 수만큼 미션을 넣는다. 배속·일시정지·결과 보고서.
 * 자리 고르기·작업 고르기·보고서 계산은 서버 lib/simulation.ts·lib/sim-report.ts 를 그대로 쓴다.
 */
import { chooseSimMission, defaultScenarioConfig, missionInterval, parseScenarioConfig, placeSimRobots, SIM_DEFAULT_MODEL, type SimScenarioConfig } from '@fleet-api/lib/simulation';
import { addActivity, addTimelinePoint, closeOpenMissions, emptyReport, queuedCount, recordMission, robotStats, summarize, compactReport, type SimReport } from '@fleet-api/lib/sim-report';
import { del, get, notFound, num, post, put } from './router';
import { createMission, HttpError, requestSnapshot, setMissionStatus } from './events';
import { engineHooks, haltRobot, sendPath } from './engine';
import { audit, DEMO_USER, grid, iso, maps, missions, newRobot, nextId, pois, robots, spaces, SITE_ID, MAP_ID, type RobotState } from './state';
import { activeMissionOf } from './views';

interface ScenarioRow {
  id: number;
  name: string;
  space_id: number;
  map_id: number;
  config: SimScenarioConfig;
  snapshot: { sim_ms: number; saved_at: string; robots: Array<{ name: string; model: string; x: number; y: number; yaw: number; battery: number; speed: number | null }>; run_id: number } | null;
  created_by: string | null;
  last_run_at: string | null;
  createdAt: string;
  updatedAt: string;
}
interface RunRow {
  id: number;
  scenario_id: number | null;
  scenario_name: string;
  map_name: string | null;
  started_at: string;
  ended_at: string | null;
  sim_ms: number;
  resumes: number;
  report: SimReport;
}

const scenarios: ScenarioRow[] = [];
const runs: RunRow[] = [];
let state: { scenario: ScenarioRow; run: RunRow; started_at: string; paused: boolean; genAcc: number; sampleAcc: number } | null = null;

/** 1층 지도·장소를 복사해 시뮬레이션 구역·지도를 만든다 */
function materialize(name: string) {
  const space = { id: nextId('space', 2), site_id: SITE_ID, name: `시뮬레이션 · ${name}`, kind: 'AREA', sort_order: 100, description: null, is_simulation: true, createdAt: iso(), updatedAt: iso() };
  spaces.push(space);
  const map = { id: nextId('map', 2), site_id: SITE_ID, space_id: space.id, name: `시뮬레이션 · ${name}`, is_simulation: true, is_active: true, version: 1, note: '1층 창고 지도에서 복사', createdAt: iso(), updatedAt: iso() };
  maps.push(map);
  pois.filter((p) => p.map_id === MAP_ID).forEach((p) => pois.push({ ...p, id: nextId('poi'), map_id: map.id }));
  return { spaceId: space.id, mapId: map.id };
}

function scenarioView(s: ScenarioRow) {
  return {
    id: s.id,
    site_id: SITE_ID,
    name: s.name,
    source_map_id: MAP_ID,
    source_map_name: '1층 창고 지도',
    space_id: s.space_id,
    map_id: s.map_id,
    config: s.config,
    snapshot: s.snapshot ? { sim_ms: s.snapshot.sim_ms, saved_at: s.snapshot.saved_at, robots: s.snapshot.robots.length } : null,
    running: state?.scenario === s,
    runs: runs.filter((r) => r.scenario_id === s.id).length,
    created_by: s.created_by,
    last_run_at: s.last_run_at,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function createScenario(name: string, config: SimScenarioConfig = defaultScenarioConfig()): ScenarioRow {
  const { spaceId, mapId } = materialize(name);
  const s: ScenarioRow = { id: nextId('scenario'), name, space_id: spaceId, map_id: mapId, config, snapshot: null, created_by: DEMO_USER.username, last_run_at: null, createdAt: iso(), updatedAt: iso() };
  scenarios.unshift(s);
  return s;
}

const simRobots = () => robots.filter((r) => r.is_virtual);

function status() {
  if (!state) return { running: false, paused: false, scenario_id: null, scenario_name: null, run_id: null, config: null, space_id: null, map_id: null, started_at: null, sim_ms: 0, robot_ids: [], robots: [], missions: { created: 0, completed: 0, failed: 0 } };
  const { scenario, run } = state;
  return {
    running: true,
    paused: state.paused,
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    run_id: run.id,
    config: scenario.config,
    space_id: scenario.space_id,
    map_id: scenario.map_id,
    started_at: state.started_at,
    sim_ms: Math.round(run.sim_ms),
    robot_ids: simRobots().map((r) => r.id),
    robots: simRobots().map((r) => ({ id: r.id, name: r.name, model: r.model_type, speed: speedOverride.get(r.id) ?? null })),
    missions: { created: run.report.counts.created, completed: run.report.counts.completed, failed: run.report.counts.failed },
  };
}

const speedOverride = new Map<number, number>();
const spawnHints = (mapId: number) => pois.filter((p) => p.map_id === mapId && (p.type === 'WAIT_ZONE' || p.type === 'CHARGER')).map((p) => ({ x: p.x, y: p.y }));

function place(mapId: number, specs: Array<{ x: number | null; y: number | null }>, avoid: Array<{ x: number; y: number }> = []) {
  const places = pois.filter((p) => p.map_id === mapId).map((p) => ({ x: p.x, y: p.y }));
  return placeSimRobots(grid, specs.map((s) => (s.x !== null && s.y !== null ? { x: s.x, y: s.y } : null)), spawnHints(mapId), { x: 25.6, y: 10.6 }, [...places, ...avoid]);
}

let virtualSeq = 0;
function spawn(s: ScenarioRow, model: string, pose: { x: number; y: number; yaw: number }, speed: number | null, name?: string, battery?: number): RobotState {
  const short = model.replace('TETRA-', '');
  const r = newRobot({ id: nextId('robot', 101), name: name ?? `가상 ${short}-${++virtualSeq}`, model, x: pose.x, y: pose.y, yaw: pose.yaw, battery: battery ?? 85 + Math.round(Math.random() * 15), virtual: true, map_id: s.map_id, space_id: s.space_id, serial: null, speed: speed ?? s.config.speed });
  if (speed !== null) speedOverride.set(r.id, speed);
  robots.push(r);
  robotStats(state!.run.report, r.name, model, r.battery);
  return r;
}

function removeRobot(r: RobotState) {
  const m = activeMissionOf(r.id);
  if (m) setMissionStatus(m, 'CANCELED', { status_reason: '시뮬레이션을 끝내 취소됨' });
  haltRobot(r);
  robots.splice(robots.indexOf(r), 1);
  speedOverride.delete(r.id);
}

// ------------------------------------------------------------------ 엔진에 붙이기: 배속·일시정지·작업 넣기·보고서

engineHooks.timeScale = (r) => (r.is_virtual && state ? state.scenario.config.time_scale : 1);
engineHooks.frozen = (r) => r.is_virtual && (!state || state.paused);
engineHooks.onTick = (dtReal) => {
  if (!state || state.paused) return;
  const dt = dtReal * state.scenario.config.time_scale;
  const run = state.run;
  run.sim_ms += dt * 1000;
  const nowS = run.sim_ms / 1000;
  for (const r of simRobots()) {
    const m = activeMissionOf(r.id);
    const activity = r.docking === 1 ? 'charging' : r.speed > 0.01 ? 'moving' : m ? 'waiting' : 'idle';
    addActivity(robotStats(run.report, r.name, r.model_type, r.battery), activity, dt, r.speed * dt, Math.round(r.battery * 10) / 10);
  }
  for (const m of missions) {
    if (!m.is_simulation || m.map_id !== state.scenario.map_id) continue;
    if (!m.sim_created_ms) m.sim_created_ms = run.sim_ms;
    recordMission(run.report, m, robots.find((r) => r.id === m.assigned_robot_id)?.name ?? null, nowS);
  }
  // 분당 작업 수만큼 넣는다 (밀린 작업이 로봇 수의 3배가 넘으면 쉰다)
  const every = missionInterval(state.scenario.config.missions_per_min);
  if (every !== null) {
    state.genAcc += dt * 1000;
    if (state.genAcc >= every) {
      state.genAcc -= every;
      const mapId = state.scenario.map_id;
      const open = missions.filter((m) => m.is_simulation && m.status === 'PENDING' && m.map_id === mapId).length;
      const req = chooseSimMission(pois.filter((p) => p.map_id === mapId), Math.random);
      if (req && open < Math.max(3, simRobots().length * 3)) createMission({ ...req, wait_sec: 3 }, 'SIMULATION', { simulation: true, createdBy: null, mapId });
    }
  }
  state.sampleAcc += dt;
  if (state.sampleAcc >= run.report.sample_every_s) {
    state.sampleAcc = 0;
    const list = simRobots();
    addTimelinePoint(run.report, {
      t: nowS,
      completed: run.report.counts.completed,
      failed: run.report.counts.failed,
      queued: queuedCount(run.report),
      working: list.filter((r) => activeMissionOf(r.id)).length,
      charging: list.filter((r) => r.docking === 1).length,
      avg_battery: list.length ? list.reduce((a, r) => a + r.battery, 0) / list.length : null,
    });
  }
};

// ------------------------------------------------------------------ API

const scenarioOf = (id: string | number) => scenarios.find((s) => s.id === Number(id)) ?? notFound('시뮬레이션 설정');
const runView = (r: RunRow, withReport = false) => ({
  id: r.id,
  scenario_id: r.scenario_id,
  scenario_name: r.scenario_name,
  map_name: r.map_name,
  started_at: r.started_at,
  ended_at: r.ended_at,
  sim_ms: Math.round(r.sim_ms),
  resumes: r.resumes,
  running: state?.run === r,
  summary: summarize(r.report, r.sim_ms / 1000),
  ...(withReport ? { report: compactReport(r.report) } : {}),
});

get('/api/fleet/simulation', () => status());
get('/api/fleet/simulation/scenarios', () => scenarios.map(scenarioView));
get('/api/fleet/simulation/scenarios/:id', ({ params }) => scenarioView(scenarioOf(params.id)));
post('/api/fleet/simulation/scenarios', ({ body }) => {
  const name = String(body?.name ?? '').trim();
  if (!name) throw new HttpError(400, '시뮬레이션 이름을 넣어 주세요.');
  const s = createScenario(name);
  audit('SIM_SCENARIO_CREATE', { target_type: 'SIMULATION', target_id: String(s.id) });
  return scenarioView(s);
});
post('/api/fleet/simulation/scenarios/:id/duplicate', ({ params, body }) => {
  const from = scenarioOf(params.id);
  const s = createScenario(String(body?.name || `${from.name} 복사본`), JSON.parse(JSON.stringify(from.config)));
  return scenarioView(s);
});
put('/api/fleet/simulation/scenarios/:id', ({ params, body }) => {
  const s = scenarioOf(params.id);
  const { name, ...rest } = (body ?? {}) as Record<string, unknown>;
  const cfg = parseScenarioConfig(rest, s.config);
  if (typeof cfg === 'string') throw new HttpError(400, cfg);
  s.config = cfg;
  if (typeof name === 'string' && name.trim()) s.name = name.trim();
  s.updatedAt = iso();
  return scenarioView(s);
});
del('/api/fleet/simulation/scenarios/:id', ({ params }) => {
  const s = scenarioOf(params.id);
  if (state?.scenario === s) throw new HttpError(409, '돌고 있는 시뮬레이션은 지울 수 없습니다. 먼저 끝내 주세요.');
  scenarios.splice(scenarios.indexOf(s), 1);
  return { ok: true };
});
post('/api/fleet/simulation/scenarios/:id/preview', ({ params, body }) => {
  const s = scenarioOf(params.id);
  const specs = Array.isArray(body?.robots) ? body.robots : s.config.robots;
  const placed = place(s.map_id, specs);
  if (typeof placed === 'string') return { robots: specs.map(() => null), error: placed };
  return { robots: placed.map((p, i) => (p ? { x: p.x, y: p.y, yaw: specs[i]?.yaw ?? 0 } : null)), error: null };
});

post('/api/fleet/simulation/start', ({ body }) => {
  if (state) throw new HttpError(409, '시뮬레이션이 이미 돌고 있습니다. 먼저 끝내 주세요.');
  const s = scenarioOf(body?.scenario_id);
  const resume = body?.resume === true && !!s.snapshot;
  if (!resume && s.config.robots.length === 0) throw new HttpError(400, '가상 로봇을 1대 이상 두고 시작해 주세요.');
  const prev = resume ? runs.find((r) => r.id === s.snapshot!.run_id) : null;
  const run: RunRow = prev ?? { id: nextId('run'), scenario_id: s.id, scenario_name: s.name, map_name: `시뮬레이션 · ${s.name}`, started_at: iso(), ended_at: null, sim_ms: resume ? s.snapshot!.sim_ms : 0, resumes: 0, report: emptyReport() };
  if (prev) {
    prev.ended_at = null;
    prev.resumes += 1;
  } else runs.unshift(run);
  state = { scenario: s, run, started_at: iso(), paused: false, genAcc: 0, sampleAcc: 0 };
  if (resume) {
    for (const r of s.snapshot!.robots) spawn(s, r.model, r, r.speed, r.name, r.battery);
  } else {
    const placed = place(s.map_id, s.config.robots);
    if (typeof placed === 'string') {
      state = null;
      throw new HttpError(422, placed);
    }
    placed.forEach((p, i) => p && spawn(s, s.config.robots[i].model ?? SIM_DEFAULT_MODEL, { x: p.x, y: p.y, yaw: s.config.robots[i].yaw ?? 0 }, s.config.robots[i].speed));
  }
  s.snapshot = null;
  s.last_run_at = iso();
  audit('SIM_START', { target_type: 'SIMULATION', target_id: String(s.id), detail: { scenario: s.name, resume } });
  requestSnapshot();
  return status();
});
post('/api/fleet/simulation/pause', () => {
  if (!state) throw new HttpError(409, '돌고 있는 시뮬레이션이 없습니다.');
  state.paused = true;
  simRobots().forEach((r) => (r.speed = 0));
  requestSnapshot();
  return status();
});
post('/api/fleet/simulation/resume', () => {
  if (!state) throw new HttpError(409, '돌고 있는 시뮬레이션이 없습니다.');
  state.paused = false;
  return status();
});
post('/api/fleet/simulation/stop', ({ body }) => {
  if (!state) throw new HttpError(409, '돌고 있는 시뮬레이션이 없습니다.');
  const { scenario, run } = state;
  const save = body?.save !== false;
  const list = simRobots();
  if (save && list.length) scenario.snapshot = { run_id: run.id, sim_ms: Math.round(run.sim_ms), saved_at: iso(), robots: list.map((r) => ({ name: r.name, model: r.model_type, x: r.pose.x, y: r.pose.y, yaw: r.pose.yaw, battery: Math.round(r.battery * 10) / 10, speed: speedOverride.get(r.id) ?? null })) };
  list.forEach(removeRobot);
  missions.filter((m) => m.is_simulation && m.status === 'PENDING').forEach((m) => setMissionStatus(m, 'CANCELED', { status_reason: '시뮬레이션을 끝내 취소됨' }));
  closeOpenMissions(run.report, run.sim_ms / 1000, '시뮬레이션을 끝내 취소됨');
  run.ended_at = iso();
  state = null;
  audit('SIM_STOP', { target_type: 'SIMULATION', target_id: String(scenario.id) });
  requestSnapshot();
  return status();
});
post('/api/fleet/simulation/robots', ({ body }) => {
  if (!state) throw new HttpError(409, '돌고 있는 시뮬레이션이 없습니다.');
  const s = state.scenario;
  const placed = place(s.map_id, [{ x: body?.x ?? null, y: body?.y ?? null }], simRobots().map((r) => r.pose));
  if (typeof placed === 'string' || !placed[0]) throw new HttpError(422, typeof placed === 'string' ? placed : '로봇을 세울 빈 곳이 없습니다.');
  spawn(s, String(body?.model || SIM_DEFAULT_MODEL), { ...placed[0], yaw: Number(body?.yaw) || 0 }, body?.speed ?? null);
  requestSnapshot();
  return status();
});
del('/api/fleet/simulation/robots/:id', ({ params }) => {
  const r = simRobots().find((x) => x.id === num(params.id)) ?? notFound('가상 로봇');
  removeRobot(r);
  sendPath(r);
  requestSnapshot();
  return status();
});
put('/api/fleet/simulation/robots/:id', ({ params, body }) => {
  const r = simRobots().find((x) => x.id === num(params.id)) ?? notFound('가상 로봇');
  const speed = body?.speed === null || body?.speed === undefined ? null : Number(body.speed);
  if (speed === null) speedOverride.delete(r.id);
  else speedOverride.set(r.id, speed);
  r.max_speed = speed ?? state!.scenario.config.speed;
  return status();
});
get('/api/fleet/simulation/runs', ({ query }) => runs.filter((r) => !query.scenario_id || r.scenario_id === Number(query.scenario_id)).map((r) => runView(r)));
get('/api/fleet/simulation/runs/:id', ({ params }) => runView(runs.find((r) => r.id === num(params.id)) ?? notFound('결과 보고서'), true));
del('/api/fleet/simulation/runs/:id', ({ params }) => {
  const i = runs.findIndex((r) => r.id === num(params.id) && r !== state?.run);
  if (i >= 0) runs.splice(i, 1);
  return { ok: true };
});

/** 처음부터 들어 있는 시뮬레이션 설정 하나 (모델이 서로 다른 가상 로봇 4대) */
export function seedSimulation() {
  createScenario('창고 피크 시간 (4대)', {
    ...defaultScenarioConfig(),
    robots: ['TETRA-M', 'TETRA-H', 'TETRA-S', 'TETRA-MH'].map((model) => ({ model: model as SimScenarioConfig['robots'][number]['model'], x: null, y: null, yaw: null, speed: null })),
    speed: 0.8,
    missions_per_min: 6,
    time_scale: 2,
  });
}

