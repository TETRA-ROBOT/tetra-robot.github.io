/**
 * 창고 통로 그래프: 싱글관제 데모 로봇이 혼자 돌 때 따라가는 길이자, 싱글관제 "경로 지정 주행" 화면에 보이는 그래프.
 *
 * 선반·벽 사이 통로 가운데만 잇는다 (로봇이 선반을 뚫고 가지 않게). 모든 선이 지도 빈 곳에 있고 벽에서 0.3 m 넘게 떨어져 있는지는
 * 이 파일의 checkAislesFree() 로 빌드 때 확인한다 (demos/single/vite.config.ts 가 부른다).
 * 장소(world.ts PLACES)는 이름 그대로 노드가 된다.
 */
import { HEIGHT, RESOLUTION, WIDTH, buildFloorPixels } from './floorplan';
import { PLACES, type Point } from './world';

export interface AisleNode extends Point {
  key: string;
}

// 세로 통로: 왼쪽 x 3.0, 오른쪽 x 25.9 (기둥 x 24.6~25.0 과 칸막이 x 27 사이). 가로 통로: y 2.8 / 7.6 / 11.25 / 15.6 / 20.4
const AISLE_POINTS: Array<[string, number, number]> = [
  ['L1', 3.0, 2.8], ['L2', 3.0, 7.6], ['L3', 3.0, 11.25], ['L4', 3.0, 15.6], ['L5', 3.0, 20.4],
  ['R1', 25.9, 2.8], ['R2', 25.9, 5.7], ['R3', 25.9, 7.6], ['R4', 25.9, 11.25], ['R5', 25.9, 15.6], ['R6', 25.9, 20.4],
  // 출고장 방 (아래 문 y 5.7 로 들어온다)
  ['E1', 28.5, 5.7], ['E2', 28.5, 7.5], ['E3', 28.5, 10.6],
  // 충전 구역 입구와 충전기 앞 (충전기 x 33.75 를 동쪽에서 다가간다)
  ['C0', 35.8, 7.2], ['C3', 35.8, 5.1], ['C2', 35.8, 3.5], ['C1', 35.8, 1.9],
  // 사무 구역 (출고장 위 문 x 32.75, 창고 쪽 문 y 15.6)
  ['O0', 32.75, 11.6], ['O1', 32.75, 13.4], ['O2', 28.5, 15.6], ['O3', 31.25, 15.6], ['O4', 32.75, 15.6],
];

const EDGES: Array<[string, string]> = [
  ['L1', 'L2'], ['L2', 'L3'], ['L3', 'L4'], ['L4', 'L5'],
  ['R1', 'R2'], ['R2', 'R3'], ['R3', '대기 장소 2'], ['대기 장소 2', 'R4'], ['R4', 'R5'], ['R5', 'R6'], ['R6', '대기 장소 1'],
  ['L1', 'R1'], ['L2', '선반 A-1'], ['선반 A-1', '선반 A-2'], ['선반 A-2', 'R3'],
  ['L3', '선반 B-1'], ['선반 B-1', 'R4'], ['L4', '선반 B-2'], ['선반 B-2', 'R5'], ['L5', 'R6'],
  ['L1', '입고장 B'], ['L5', '입고장 A'],
  ['R2', 'E1'], ['E1', 'E2'], ['E2', '출고장 1'], ['E2', 'E3'], ['E3', '출고장 2'],
  ['출고장 1', 'C0'], ['C0', 'C3'], ['C3', 'C2'], ['C2', 'C1'],
  ['C3', '충전소 3'], ['C2', '충전소 2'], ['C1', '충전소 1'],
  ['출고장 2', 'O0'], ['O0', 'O1'], ['O1', 'O4'],
  ['R5', 'O2'], ['O2', 'O3'], ['O3', 'O4'], ['O3', '회의실'], ['O4', '사무실'],
];

export const AISLE_NODES: AisleNode[] = [
  ...AISLE_POINTS.map(([key, x, y]) => ({ key, x, y })),
  ...PLACES.map((p) => ({ key: p.name, x: p.x, y: p.y })),
];
export const AISLE_EDGES: ReadonlyArray<readonly [string, string]> = EDGES;

const nodeOf = new Map(AISLE_NODES.map((n) => [n.key, n]));
const neighbors = new Map<string, string[]>();
for (const [a, b] of EDGES) {
  if (!nodeOf.has(a) || !nodeOf.has(b)) throw new Error(`[demo world] 통로 그래프에 없는 노드: ${a}–${b}`);
  neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
  neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
}

/** 가장 가까운 노드 */
export function nearestNode(point: Point): AisleNode {
  return AISLE_NODES.reduce((best, n) => (Math.hypot(n.x - point.x, n.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? n : best));
}

/** 두 노드 사이 가장 짧은 길 (다익스트라, 노드가 수십 개라 단순하게) */
export function shortestPath(fromKey: string, toKey: string): AisleNode[] {
  const dist = new Map<string, number>([[fromKey, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([fromKey]);
  while (open.size) {
    const current = [...open].reduce((a, b) => (dist.get(a)! <= dist.get(b)! ? a : b));
    open.delete(current);
    if (current === toKey) break;
    const here = nodeOf.get(current)!;
    for (const next of neighbors.get(current) ?? []) {
      const there = nodeOf.get(next)!;
      const d = dist.get(current)! + Math.hypot(there.x - here.x, there.y - here.y);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, current);
        open.add(next);
      }
    }
  }
  if (!dist.has(toKey)) return [];
  const keys = [toKey];
  while (keys[0] !== fromKey) keys.unshift(prev.get(keys[0])!);
  return keys.map((k) => nodeOf.get(k)!);
}

let floor: Uint8Array | null = null;

/** 그 점에서 clearance 안에 벽·선반(또는 지도 밖)이 있는지 */
function blockedAt(x: number, y: number, clearance: number): boolean {
  floor ??= buildFloorPixels();
  const reach = Math.ceil(clearance / RESOLUTION);
  const cu = Math.floor(x / RESOLUTION);
  const cr = HEIGHT - 1 - Math.floor(y / RESOLUTION);
  for (let dv = -reach; dv <= reach; dv++) {
    for (let du = -reach; du <= reach; du++) {
      if (du * du + dv * dv > reach * reach) continue;
      const u = cu + du;
      const v = cr + dv;
      if (u < 0 || v < 0 || u >= WIDTH || v >= HEIGHT || floor[v * WIDTH + u] === 0) return true;
    }
  }
  return false;
}

/** 두 점을 잇는 곧은 선이 벽·선반에서 clearance 넘게 떨어져 있는지 */
export function lineFree(p: Point, q: Point, clearance = 0.3): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.05));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (blockedAt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, clearance)) return false;
  }
  return true;
}

/** 곧게 갈 수 있는 가장 가까운 노드 (선반 너머의 노드를 고르지 않게). 없으면 그냥 가장 가까운 노드 */
export function nearestReachableNode(point: Point): AisleNode {
  const sorted = [...AISLE_NODES].sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
  return sorted.slice(0, 8).find((n) => lineFree(point, n, 0.2)) ?? sorted[0];
}

/**
 * 모든 통로 선이 빈 곳 위에 있고 벽·선반에서 clearance 넘게 떨어져 있는지. 어긋난 선 목록 (비면 통과).
 * 지도나 장소를 옮기다 로봇이 선반을 뚫고 지나가게 되면 여기서 걸린다 (싱글관제 데모 빌드가 부른다).
 */
export function checkAislesFree(clearance = 0.3): string[] {
  return EDGES.filter(([a, b]) => !lineFree(nodeOf.get(a)!, nodeOf.get(b)!, clearance)).map(([a, b]) => `${a}–${b}`);
}
