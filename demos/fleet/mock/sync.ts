/**
 * 탭 사이 동기화: 실제 로봇(가상 로봇 제외)의 위치·배터리·상태를 BroadcastChannel 로 0.2초마다 내보낸다.
 * "로봇 화면 열기"로 연 싱글관제 데모 탭이 이것을 받아 같은 로봇을 같은 자리에 보여 준다 (single/world/drive.ts).
 * 같은 출처의 탭끼리만 닿고, 받는 탭이 없으면 아무 일도 하지 않는다.
 */
import { FLEET_SYNC_CHANNEL, type FleetSyncMessage } from '../../shared/world';
import { robots, MAP_ID } from './state';

const SEND_MS = 200;
const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

export function startFleetSync(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(FLEET_SYNC_CHANNEL);
  setInterval(() => {
    const message: FleetSyncMessage = {
      kind: 'fleet-robots',
      sentAt: Date.now(),
      robots: robots
        .filter((r) => !r.is_virtual && r.map_id === MAP_ID && r.online)
        .map((r) => ({
          id: r.id,
          name: r.name,
          model: r.model_type,
          x: round(r.pose.x),
          y: round(r.pose.y),
          yaw: round(r.pose.yaw),
          battery: Math.round(r.battery),
          speed: round(r.speed, 2),
          state: r.nav_state,
          path: (r.path ?? []).map((p) => [round(p.x, 2), round(p.y, 2)] as [number, number]),
        })),
    };
    channel.postMessage(message);
  }, SEND_MS);
}
