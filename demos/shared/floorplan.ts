/**
 * 데모 지도: 물류창고 + 출고장·충전 구역 + 사무 구역 한 층. 멀티관제·싱글관제 데모가 같은 지도를 쓴다 (world.ts).
 * 로봇 지도와 같은 회색 칸(벽 0, 빈 곳 254, 모르는 곳 205, 위쪽 행이 y 최댓값)으로 그리고 PNG 로 바꾼다.
 * 좌표 단위는 m (지도 원점 0,0 = 왼쪽 아래).
 */

export const MAP_W_M = 40;
export const MAP_H_M = 24;
export const RESOLUTION = 0.05;
export const ORIGIN = { x: 0, y: 0 };
export const WIDTH = Math.round(MAP_W_M / RESOLUTION);
export const HEIGHT = Math.round(MAP_H_M / RESOLUTION);

const FREE = 254;
const WALL = 0;
const UNKNOWN = 205;
const WALL_T = 0.15;

export function buildFloorPixels(): Uint8Array {
  const px = new Uint8Array(WIDTH * HEIGHT).fill(UNKNOWN);
  /** 지도 좌표 사각형 칠하기 */
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    const u0 = Math.max(0, Math.floor(Math.min(x0, x1) / RESOLUTION));
    const u1 = Math.min(WIDTH, Math.ceil(Math.max(x0, x1) / RESOLUTION));
    const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / RESOLUTION));
    const r1 = Math.min(HEIGHT, Math.ceil(Math.max(y0, y1) / RESOLUTION));
    for (let r = r0; r < r1; r++) {
      const row = HEIGHT - 1 - r;
      px.fill(v, row * WIDTH + u0, row * WIDTH + u1);
    }
  };
  const hWall = (x0: number, x1: number, y: number) => rect(x0, y - WALL_T / 2, x1, y + WALL_T / 2, WALL);
  const vWall = (x: number, y0: number, y1: number) => rect(x - WALL_T / 2, y0, x + WALL_T / 2, y1, WALL);

  // 건물 안쪽 (빈 곳) + 바깥 벽
  rect(1, 1, 39, 23, FREE);
  hWall(1, 39, 1);
  hWall(1, 39, 23);
  vWall(1, 1, 23);
  vWall(39, 1, 23);
  // 입고 문 (왼쪽 벽 두 곳: 레이저가 바깥으로 조금 보인다)
  rect(0.2, 2, 1.1, 4.2, FREE);
  rect(0.2, 18.8, 1.1, 21, FREE);
  hWall(0.2, 1, 2);
  hWall(0.2, 1, 4.2);
  hWall(0.2, 1, 18.8);
  hWall(0.2, 1, 21);

  // 창고 선반 (가로 4줄 × 2열, 사이가 통로)
  for (const y of [4.6, 8.6, 12.6, 16.6]) {
    for (const [x0, x1] of [[5, 13], [15.4, 23.4]] as const) {
      rect(x0, y, x1, y + 1.3, WALL);
      // 선반 안쪽은 빈 칸 줄무늬 (레이저가 기둥 사이로 본 모습)
      for (let x = x0 + 0.9; x < x1 - 0.4; x += 1.0) rect(x, y + 0.15, x + 0.75, y + 1.15, UNKNOWN);
    }
  }
  // 기둥
  for (const [x, y] of [[14.2, 6.7], [14.2, 14.7], [24.8, 6.7], [24.8, 14.7]] as const) rect(x - 0.2, y - 0.2, x + 0.2, y + 0.2, WALL);

  // 창고 ↔ 오른쪽 구역 칸막이 (문 둘)
  vWall(27, 1, 4.2);
  vWall(27, 7.2, 14.2);
  vWall(27, 17.4, 23);

  // 오른쪽 아래: 출고장·충전 구역, 오른쪽 위: 사무 구역 (가로 벽, 문 하나)
  hWall(27, 31.5, 12.2);
  hWall(34, 39, 12.2);
  // 사무 구역 방 (회의실·사무실)
  vWall(33, 17.5, 23);
  hWall(27, 30.5, 17.5);
  hWall(32, 33, 17.5);
  rect(34.5, 19.5, 37.5, 21, WALL); // 책상 줄
  rect(28, 19.5, 31.5, 21.2, WALL); // 회의 탁자
  rect(34.5, 14.5, 37.5, 15.6, WALL);
  // 출고장 컨베이어
  rect(29.5, 8.6, 33.5, 9.4, WALL);
  // 충전 구역 칸막이: 충전기 3대를 이 벽에 세로로 붙인다 (가로로 늘어놓으면 지도 이름표가 서로 겹친다)
  vWall(33, 1, 6);
  return px;
}

/** 회색 칸 → PNG Blob (브라우저 캔버스) */
export async function pixelsToPng(px: Uint8Array, width = WIDTH, height = HEIGHT): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < px.length; i++) {
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = px[i];
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 만들기 실패'))), 'image/png'));
}
