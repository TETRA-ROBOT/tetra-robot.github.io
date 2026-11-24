/**
 * 싱글관제 데모 로봇이 혼자 도는 하루 일: 창고 통로 그래프(shared/aisles.ts)를 따라 장소를 차례로 돌고,
 * 배터리가 낮아지면 자기 충전소로 가서 충전한다. 원본 목업은 로봇이 방 가운데를 원으로 돌기만 해서 지도와 맞지 않았다.
 *
 * 순수 계산만 한다 (소켓·화면 모름). step(dt) 를 부르면 위치·속도·배터리가 바뀐다.
 */
import { nearestReachableNode, shortestPath } from '../../shared/aisles';
import { ZONES, insidePolygon, placeByName, type Point, type RosterRobot } from '../../shared/world';

export type SimMode = 'drive' | 'wait' | 'dock' | 'charge' | 'hold';

/** 장소를 도는 순서 (입고 → 선반 → 출고, 사이사이 사무 구역 배달) */
const TOUR = ['선반 A-1', '출고장 1', '선반 B-2', '입고장 A', '선반 A-2', '출고장 2', '사무실', '입고장 B', '선반 B-1', '회의실'];
const MODEL_SPEED: Record<string, number> = { m: 0.7, h: 0.6, s: 0.8, mh: 0.6, sm: 0.6, edu: 0.5 };
const ACCEL = 0.5; // m/s²
const TURN_RATE = 1.0; // rad/s
const TURN_IN_PLACE = 0.35; // rad 보다 어긋나면 서서 돈다
const WAIT_S = 6;
const DOCK_S = 3;
const LOW_BATTERY = 25;
const CHARGE_UNTIL = 90;
const BATTERY = { perMeter: 0.12, idlePerSec: 0.003, chargePerSec: 0.6 };

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class RouteSim {
  x: number;
  y: number;
  yaw: number;
  battery: number;
  speed = 0;
  odometer = 0;
  mode: SimMode = 'wait';
  /** 남은 길 (다음 점부터) */
  path: Point[] = [];
  /** 지금 가는(또는 서 있는) 장소 */
  target: string | null = null;
  private timer = 0;
  private chargeUntil = CHARGE_UNTIL;
  private tourIndex: number;
  private readonly maxSpeed: number;
  private readonly homeCharger: string;

  constructor(robot: RosterRobot, modelKey: string) {
    this.x = robot.start.x;
    this.y = robot.start.y;
    this.yaw = robot.start.yaw;
    this.battery = robot.battery;
    this.homeCharger = robot.homeCharger;
    this.maxSpeed = MODEL_SPEED[modelKey] ?? 0.6;
    // 로봇마다 다른 곳부터 돌게 한다 (여러 탭을 열어도 같은 길을 겹쳐 가지 않게)
    this.tourIndex = (robot.id * 3) % TOUR.length;
    if (robot.dockedAt) {
      // 충전기 위에서 시작하면 잠깐 충전하다 일하러 나간다
      this.target = robot.dockedAt;
      this.mode = 'charge';
      this.chargeUntil = Math.min(CHARGE_UNTIL, this.battery + 3);
    } else {
      this.timer = 2;
    }
  }

  get charging(): boolean {
    return this.mode === 'charge';
  }

  /** 장소로 간다 (지금 자리에서 곧게 닿는 가장 가까운 통로 노드부터 그래프를 따라) */
  goTo(name: string): void {
    const start = nearestReachableNode(this);
    const nodes = shortestPath(start.key, name);
    if (!nodes.length) return;
    this.path = nodes.filter((n, i) => i > 0 || Math.hypot(n.x - this.x, n.y - this.y) > 0.05).map((n) => ({ x: n.x, y: n.y }));
    this.target = name;
    this.mode = 'drive';
  }

  /** 사람이 멈췄다: 그 자리에 서 있다가 holdSeconds 뒤 하던 일로 돌아간다 */
  hold(holdSeconds: number): void {
    this.path = [];
    this.speed = 0;
    this.mode = 'hold';
    this.timer = holdSeconds;
  }

  /** 다른 탭(멀티관제)이 움직이던 자리에서 이어 간다 */
  resumeFrom(pose: { x: number; y: number; yaw: number; battery: number }): void {
    Object.assign(this, { x: pose.x, y: pose.y, yaw: pose.yaw, battery: pose.battery, speed: 0 });
    this.mode = 'hold';
    this.timer = 1;
  }

  private nextJob(): void {
    if (this.battery < LOW_BATTERY) {
      this.chargeUntil = CHARGE_UNTIL;
      this.goTo(this.homeCharger);
      return;
    }
    this.tourIndex = (this.tourIndex + 1) % TOUR.length;
    this.goTo(TOUR[this.tourIndex]);
  }

  private arrive(dt: number): void {
    const place = this.target ? placeByName(this.target) : null;
    // 장소 방향으로 돌고 나서 일을 한다
    if (place && Math.abs(wrap(place.yaw - this.yaw)) > 0.03) {
      this.yaw = wrap(this.yaw + clamp(wrap(place.yaw - this.yaw), -TURN_RATE * dt, TURN_RATE * dt));
      return;
    }
    this.speed = 0;
    this.mode = place?.type === 'CHARGER' ? 'dock' : 'wait';
    this.timer = this.mode === 'dock' ? DOCK_S : WAIT_S;
  }

  /** 서행 구간 안이면 그 속도, 아니면 모델 최고 속도 */
  private speedCap(): number {
    const zone = ZONES.find((z) => z.kind === 'SPEED_LIMIT' && z.speed !== null && insidePolygon(this, z.polygon));
    return zone ? Math.min(this.maxSpeed, zone.speed!) : this.maxSpeed;
  }

  /** 다음에 서야 하는 곳(크게 꺾이는 노드 또는 끝)까지 거리 */
  private stopDistance(): number {
    let d = Math.hypot(this.path[0].x - this.x, this.path[0].y - this.y);
    for (let i = 0; i < this.path.length - 1; i++) {
      const a = i === 0 ? { x: this.x, y: this.y } : this.path[i - 1];
      const b = this.path[i];
      const c = this.path[i + 1];
      const turn = Math.abs(wrap(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x)));
      if (turn > TURN_IN_PLACE) return d;
      d += Math.hypot(c.x - b.x, c.y - b.y);
    }
    return d;
  }

  private drive(dt: number): number {
    const next = this.path[0];
    const heading = Math.atan2(next.y - this.y, next.x - this.x);
    const error = wrap(heading - this.yaw);
    this.yaw = wrap(this.yaw + clamp(error, -TURN_RATE * dt, TURN_RATE * dt));
    if (Math.abs(error) > TURN_IN_PLACE) {
      this.speed = 0;
      return 0;
    }
    const brake = Math.sqrt(2 * ACCEL * this.stopDistance()) + 0.05;
    this.speed = Math.max(0, Math.min(this.speedCap(), this.speed + ACCEL * dt, brake));
    let step = this.speed * dt;
    const moved = step;
    while (step > 0 && this.path.length) {
      const p = this.path[0];
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (step < d) {
        this.x += ((p.x - this.x) / d) * step;
        this.y += ((p.y - this.y) / d) * step;
        break;
      }
      this.x = p.x;
      this.y = p.y;
      step -= d;
      this.path.shift();
      // 꺾이는 노드에서는 남은 거리를 버리고 다음 차례에 방향부터 맞춘다
      const after = this.path[0];
      if (after && Math.abs(wrap(Math.atan2(after.y - p.y, after.x - p.x) - this.yaw)) > TURN_IN_PLACE) break;
    }
    return moved;
  }

  step(dt: number): void {
    let moved = 0;
    if (this.mode === 'drive') {
      if (this.path.length) moved = this.drive(dt);
      else this.arrive(dt);
    } else if (this.mode === 'charge') {
      this.speed = 0;
      this.battery = Math.min(100, this.battery + BATTERY.chargePerSec * dt);
      if (this.battery >= this.chargeUntil) this.nextJob();
    } else {
      this.speed = 0;
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.mode === 'dock') this.mode = 'charge';
        else this.nextJob();
      }
    }
    this.odometer += moved;
    if (this.mode !== 'charge') this.battery = Math.max(0, this.battery - moved * BATTERY.perMeter - dt * BATTERY.idlePerSec);
  }
}
