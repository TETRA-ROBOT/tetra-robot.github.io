/**
 * 처음 상태: 로봇 4대(모델이 서로 다름), 지난 7일 미션·알림 기록, 그룹, 자주 쓰는 미션, 반복 예약, 조작 이력.
 */
import { buildMissionPlan, type Poi } from '@fleet-api/lib/mission-plan';
import { alerts, audit, groups, iso, missions, newRobot, nextId, poiByName, pois, presets, robots, schedules, SITE_ID, MAP_ID, type MissionRow } from './state';

const DAY = 86_400_000;

export function seed() {
  const c1 = poiByName('충전소 1');
  robots.push(
    newRobot({ name: 'TETRA-M 01', model: 'TETRA-M', x: c1.x, y: c1.y, yaw: c1.yaw ?? 0, battery: 71 }),
    newRobot({ name: 'TETRA-H 02', model: 'TETRA-H', x: 25.6, y: 21.3, yaw: -Math.PI / 2, battery: 88 }),
    newRobot({ name: 'TETRA-S 03', model: 'TETRA-S', x: 4.5, y: 10.8, yaw: 0, battery: 64 }),
    newRobot({ name: 'TETRA-MH 04', model: 'TETRA-MH', x: 20.5, y: 11.2, yaw: Math.PI, battery: 34 }),
  );
  // 1호기는 충전기에 붙어 있다
  robots[0].docking = 1;
  robots[0].nav_state = 'charging';
  robots[0].charger_id = c1.id;

  groups.push(
    { id: nextId('group'), name: '창고 운반조', color: '#34b79b', charge_threshold: null, charge_resume: null, created_by: 'demo', robot_ids: [1, 2, 4] },
    { id: nextId('group'), name: '순찰·안내', color: '#ab47bc', charge_threshold: 35, charge_resume: null, created_by: 'demo', robot_ids: [3] },
  );

  const pa = poiByName('입고장 A');
  const pb = poiByName('입고장 B');
  const d1 = poiByName('출고장 1');
  const d2 = poiByName('출고장 2');
  const office = poiByName('사무실');
  presets.push(
    { id: nextId('preset'), site_id: SITE_ID, name: '입고장 A → 출고장 1', request: { type: 'DELIVERY', pickup: { location_id: pa.id }, dropoff: { location_id: d1.id }, wait_sec: 5 }, problem: null, created_by: 'demo' },
    { id: nextId('preset'), site_id: SITE_ID, name: '입고장 B → 출고장 2', request: { type: 'DELIVERY', pickup: { location_id: pb.id }, dropoff: { location_id: d2.id }, wait_sec: 5 }, problem: null, created_by: 'demo' },
    { id: nextId('preset'), site_id: SITE_ID, name: '사무실 서류 배달', request: { type: 'DELIVERY', pickup: { location_id: d1.id }, dropoff: { location_id: office.id }, wait_sec: 3 }, problem: null, created_by: 'demo' },
    { id: nextId('preset'), site_id: SITE_ID, name: '선반 순찰', request: { type: 'PATROL', waypoints: ['선반 A-1', '선반 A-2', '선반 B-2', '선반 B-1'].map((n) => ({ location_id: poiByName(n).id })) }, problem: null, created_by: 'demo' },
  );
  const tomorrow = new Date(Date.now() + DAY);
  tomorrow.setHours(9, 0, 0, 0);
  schedules.push({
    id: nextId('schedule'),
    preset_id: presets[3].id,
    preset_name: presets[3].name,
    mode: 'TIME',
    run_count: 12,
    weekdays: [1, 2, 3, 4, 5],
    time: '09:00',
    tz_offset: new Date().getTimezoneOffset(),
    robot_id: null,
    group_id: 2,
    enabled: true,
    summary: '평일 09:00',
    next_run_at: iso(tomorrow.getTime()),
    last_run_at: iso(Date.now() - 6 * 3600_000),
    last_result: '미션 #1080 완료',
    last_mission_id: null,
  });

  seedHistory();
}

/** 지난 7일의 끝난 미션·알림 (홈 '오늘의 운영'·미션 이력·알림 이력이 비어 보이지 않게) */
function seedHistory() {
  const now = Date.now();
  const real = new Map<number, Poi>(pois.filter((p) => p.map_id === MAP_ID).map((p) => [p.id, p]));
  const pick = <T,>(l: T[]) => l[Math.floor(Math.random() * l.length)];
  const pickups = pois.filter((p) => p.type === 'PICKUP');
  const drops = pois.filter((p) => p.type === 'DROPOFF');
  const rows: MissionRow[] = [];
  for (let day = 6; day >= 0; day--) {
    const base = new Date(now - day * DAY);
    base.setHours(8, 0, 0, 0);
    // 오늘은 지금까지 (이른 시각에 열어도 '오늘의 운영'이 비지 않게 자정 이후부터)
    const midnight = new Date(now).setHours(0, 0, 0, 0);
    const start = day === 0 ? Math.max(midnight, Math.min(base.getTime(), now - 6 * 3600_000)) : base.getTime();
    const end = day === 0 ? now - 10 * 60_000 : base.getTime() + 10 * 3600_000;
    let t = start;
    while (t < end) {
      t += (12 + Math.random() * 30) * 60_000;
      if (t >= end) break;
      const robot = pick(robots);
      const roll = Math.random();
      const plan = buildMissionPlan(roll < 0.8 ? { type: 'DELIVERY', pickup: { location_id: pick(pickups).id }, dropoff: { location_id: pick(drops).id }, wait_sec: 5 } : { type: 'CHARGE', charger_location_id: poiByName('충전소 2').id }, real);
      const dur = (90 + Math.random() * 200) * 1000;
      const status = roll < 0.04 ? 'FAILED' : roll < 0.07 ? 'CANCELED' : 'COMPLETED';
      rows.push({
        id: nextId('mission', 1000),
        is_simulation: false,
        site_id: SITE_ID,
        map_id: MAP_ID,
        name: plan.name,
        type: plan.type,
        priority: plan.type === 'CHARGE' ? 1 : 3,
        status,
        status_reason: status === 'CANCELED' ? '사용자 취소' : null,
        error_message: status === 'FAILED' ? '이동 시간이 600초를 넘었습니다.' : null,
        waiting_reason: null,
        requested_robot_id: plan.type === 'CHARGE' ? robot.id : null,
        requested_group_id: null,
        assigned_robot_id: robot.id,
        current_step: status === 'COMPLETED' ? plan.steps.length : 1,
        steps: plan.steps,
        source: plan.type === 'CHARGE' ? 'AUTO_CHARGE' : pick(['USER', 'API', 'API', 'PRESET', 'SCHEDULE']),
        created_by: plan.type === 'CHARGE' ? null : 'operator',
        started_at: iso(t + 8000),
        completed_at: iso(t + dur),
        assigned_at: iso(t + 2000),
        createdAt: iso(t),
        updatedAt: iso(t + dur),
        step_until: 0,
        step_started: false,
        eta_seconds: null,
      });
      if (status === 'FAILED') pastAlert(t + dur, 'MISSION_FAILED', 'WARNING', `미션 [${plan.name}] 실패: 이동 시간이 600초를 넘었습니다.`, robot.id);
      if (Math.random() < 0.05) pastAlert(t + dur / 2, 'TRAFFIC_WAIT', 'WARNING', `${robot.name}: 앞이 막혀 45초째 기다리는 중입니다. 길을 막은 로봇이나 물건이 없는지 확인하세요.`, robot.id);
    }
    if (day === 3) pastAlert(base.getTime() + 4 * 3600_000, 'BUMPER', 'CRITICAL', `${robots[1].name}: 범퍼가 눌렸습니다 (충돌 가능성). 현장을 확인하세요.`, robots[1].id);
    if (day === 1) pastAlert(base.getTime() + 2 * 3600_000, 'COMM_LOST', 'CRITICAL', `${robots[2].name}: 통신이 끊겼습니다.`, robots[2].id);
  }
  missions.push(...rows.reverse());
  alerts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const logs: Array<[number, string, Record<string, unknown>]> = [
    [now - 5 * DAY, 'LOGIN', { target_type: 'USER', target_id: '1' }],
    [now - 4 * DAY, 'SETTINGS_UPDATE', { target_type: 'SETTINGS', target_id: 'fleet' }],
    [now - 3 * DAY, 'ESTOP_ROBOT', { robot_id: 2, target_type: 'ROBOT', target_id: '2', detail: { connection: 'ONLINE', attempts: 1 } }],
    [now - 3 * DAY + 600_000, 'ESTOP_RELEASE', { robot_id: 2, target_type: 'ROBOT', target_id: '2' }],
    [now - 2 * DAY, 'PRESET_CREATE', { target_type: 'PRESET', target_id: '4' }],
    [now - DAY, 'JOG_START', { robot_id: 3, target_type: 'ROBOT', target_id: '3' }],
    [now - DAY + 120_000, 'JOG_STOP', { robot_id: 3, target_type: 'ROBOT', target_id: '3', detail: { duration_sec: 112, reason: 'USER' } }],
  ];
  logs.forEach(([t, action, f]) => audit(action, f, t));
}

function pastAlert(t: number, type: string, severity: 'CRITICAL' | 'WARNING' | 'INFO', message: string, robotId: number) {
  alerts.push({
    id: nextId('alert', 100),
    is_simulation: false,
    type,
    severity,
    message,
    robot_id: robotId,
    mission_id: null,
    site_id: SITE_ID,
    status: 'RESOLVED',
    acknowledged_at: iso(t + 120_000),
    acknowledged_by: 'operator',
    resolved_at: iso(t + 300_000),
    createdAt: iso(t),
    updatedAt: iso(t + 300_000),
    dedup_key: null,
  });
}
