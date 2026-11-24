#!/usr/bin/env node
/**
 * 지도 이름표 겹침 시험: 두 데모(1440×900)의 2D 지도를 기본 배율로 열고, 화면에 그려진 이름표 상자가 서로 겹치는지 본다.
 * - 멀티관제 지도 화면: 장소 이름표(.fleet-poi-label)·교통 구역 이름표(.fleet-zone-label) 끼리,
 *   그리고 처음에 서 있는 로봇의 이름표(.fleet-robot-label)·몸통(.fleet-robot-body) 과 위 이름표들
 * - 싱글관제 메인 지도: 위치 이름표(지도 위 SVG 글자) 끼리
 * 장소 자리는 demos/shared/world.ts 에서 고친다. 움직이는 로봇은 지나가며 겹칠 수 있으므로 1초 동안 안 움직인 로봇만 본다.
 *
 *   node scripts/label_overlap_check.cjs [--shots <폴더>]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve, login, BASE_PATH } = require('./lib/demo_server.cjs');

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const GAP = 1; // px. 테두리가 맞닿는 정도는 겹침으로 보지 않는다

/** 브라우저에서: 선택자마다 보이는 상자 [{kind, text, x0, y0, x1, y1}] */
function collect(selectors) {
  const boxes = [];
  for (const [kind, selector] of Object.entries(selectors)) {
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      // 로봇은 이름으로 짝짓는다 (이름표 끝의 배터리 % 는 충전하며 바뀐다)
      const label = el.closest('.fleet-robot-marker')?.querySelector('.fleet-robot-label')?.textContent ?? el.textContent;
      boxes.push({ kind, text: label.trim().replace(/\s+/g, ' ').replace(/\s*\d+%$/, ''), x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
    }
  }
  return boxes;
}

const overlaps = (a, b) => a.x0 < b.x1 - GAP && b.x0 < a.x1 - GAP && a.y0 < b.y1 - GAP && b.y0 < a.y1 - GAP;

/** 겹치는 짝 (같은 로봇의 몸통·이름표 끼리, 로봇 몸통 끼리는 보지 않는다) */
function collisions(boxes) {
  const found = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.kind.startsWith('robot') && b.kind.startsWith('robot') && (a.text === b.text || (a.kind === 'robotBody' && b.kind === 'robotBody'))) continue;
      if (overlaps(a, b)) found.push(`${a.kind} "${a.text}" ↔ ${b.kind} "${b.text}"`);
    }
  }
  return found;
}

async function checkFleet(page, origin) {
  await page.goto(`${origin}${BASE_PATH}fleet/`, { waitUntil: 'domcontentloaded' });
  await login(page);
  await page.waitForFunction(() => location.hash.includes('/monitor'), null, { timeout: 20000 });
  await page.goto(`${origin}${BASE_PATH}fleet/#/monitor/map`);
  await page.locator('.fleet-poi-label').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); // 지도 맞춤(fitBounds)·구역 그리기
  const places = await page.evaluate(collect, { place: '.fleet-poi-label', zone: '.fleet-zone-label' });
  // 1초 사이에 안 움직인 로봇 = 서 있는 로봇
  const robotSelectors = { robotLabel: '.fleet-robot-label', robotBody: '.fleet-robot-body' };
  const before = await page.evaluate(collect, robotSelectors);
  await page.waitForTimeout(1000);
  const after = await page.evaluate(collect, robotSelectors);
  const parked = after.filter((b) => before.some((a) => a.kind === b.kind && a.text === b.text && Math.abs(a.x0 - b.x0) < 0.5 && Math.abs(a.y0 - b.y0) < 0.5));
  if (places.filter((b) => b.kind === 'place').length < 10) throw new Error(`장소 이름표가 너무 적음 (${places.length})`);
  const parkedNames = [...new Set(parked.filter((b) => b.kind === 'robotLabel').map((b) => b.text))];
  return { problems: collisions([...places, ...parked]), summary: `장소·구역 이름표 ${places.length}개, 서 있는 로봇 ${parkedNames.length}대 (${parkedNames.join(', ')})` };
}

async function checkSingle(page, origin) {
  await page.goto(`${origin}${BASE_PATH}single/`, { waitUntil: 'domcontentloaded' });
  await login(page);
  await page.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 20000 });
  // 위치 이름표: 지도 위 svgOverlay 안의 <text> (원본 map.vue createLocations)
  const selector = '.leaflet-overlay-pane svg.leaflet-image-layer text';
  await page.locator(selector).first().waitFor({ state: 'attached', timeout: 20000 });
  await page.waitForTimeout(1500); // 처음 지도 맞춤(fitBounds → 로봇 쪽 setView)이 끝날 때까지
  const labels = await page.evaluate(collect, { location: selector });
  if (labels.length < 10) throw new Error(`위치 이름표가 너무 적음 (${labels.length})`);
  return { problems: collisions(labels), summary: `위치 이름표 ${labels.length}개` };
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  for (const [name, run] of [['fleet', checkFleet], ['single', checkSingle]]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    try {
      const { problems, summary } = await run(page, origin);
      if (problems.length) { failed++; console.log(`✗ ${name} 지도 이름표 겹침 (${summary})\n  - ${problems.join('\n  - ')}`); }
      else console.log(`✓ ${name} 지도 이름표 겹침 없음 (${summary})`);
    } catch (e) {
      failed++;
      console.log(`✗ ${name} 확인 실패: ${e.message.split('\n')[0]}`);
    }
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `labels-${name}.png`) }); }
    await page.close();
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
