#!/usr/bin/env node
/**
 * 두 데모 잇기 시험 (demos/shared/world.ts):
 * 1) 멀티관제 데모에서 로봇을 눌러 "로봇 화면 열기 (싱글관제)" → 새 탭이 그 로봇의 싱글관제 데모로 열리는지
 * 2) 그 탭이 멀티관제 탭의 같은 로봇 자리를 따라 하는지 (BroadcastChannel), 데모 띠가 그렇다고 알리는지
 * 3) 멀티관제 탭을 닫으면 혼자 창고 통로를 따라 일하기로 돌아가는지
 * 4) 싱글관제 데모를 바로 열면(로봇 지정 없음) 1호기로 혼자 움직이는지
 *
 *   node scripts/fleet_single_sync_check.cjs [--shots <폴더>]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve, login, BASE_PATH } = require('./lib/demo_server.cjs');

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ROBOT = { id: 2, name: 'TETRA-H 02', model: 'h' };

async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

const bannerText = (page) => page.locator('#tetra-demo-banner .msg').textContent();
const pose = (page) => page.evaluate(() => fetch('/nav').then((r) => r.json()).then((d) => ({ x: d.translation.x, y: d.translation.y })));
const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 싱글관제 탭 안에서 멀티관제 탭이 보내는 그 로봇의 자리 하나를 받고, 바로 싱글관제 위치를 읽는다 */
function fleetVsSingle(page, robotId) {
  return page.evaluate((id) => new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('tetra-demo-fleet');
    const timer = setTimeout(() => { channel.close(); reject(new Error('멀티관제 탭 소식이 없음')); }, 5000);
    channel.onmessage = async (event) => {
      const robot = event.data.robots.find((r) => r.id === id);
      if (!robot) return;
      clearTimeout(timer);
      channel.close();
      // 싱글관제는 다음 0.1초 계산에서 이 값을 쓴다
      await new Promise((r) => setTimeout(r, 150));
      const nav = await fetch('/nav').then((r) => r.json());
      resolve({ fleet: { x: robot.x, y: robot.y }, single: { x: nav.translation.x, y: nav.translation.y } });
    };
  }), robotId);
}

async function run(origin, browser, step) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const fleet = await context.newPage();
  await fleet.goto(`${origin}${BASE_PATH}fleet/`, { waitUntil: 'domcontentloaded' });
  await login(fleet);
  await fleet.waitForFunction(() => location.hash.includes('/monitor'), null, { timeout: 20000 });

  step('멀티관제: 로봇 → 로봇 화면 열기');
  await fleet.getByText(ROBOT.name, { exact: true }).first().click();
  const openButton = fleet.getByRole('button', { name: /로봇 화면 열기/ });
  await openButton.waitFor({ timeout: 10000 });
  await shot(fleet, 'sync-1-fleet-panel');
  const [single] = await Promise.all([context.waitForEvent('page'), openButton.click()]);
  await single.waitForURL((url) => url.pathname === `${BASE_PATH}single/` && url.searchParams.get('robot') === String(ROBOT.id), { timeout: 10000 });
  await login(single);
  await single.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 20000 });

  step('싱글관제 탭: 그 로봇·창고 지도·따라 하기');
  await single.locator('#header-model-title').getByText(ROBOT.model, { exact: true }).waitFor({ timeout: 10000 });
  await single.waitForFunction((name) => document.querySelector('#tetra-demo-banner .msg')?.textContent?.includes(`멀티관제 데모의 ${name} 를 따라`), ROBOT.name, { timeout: 10000 });
  const map = await single.evaluate(() => fetch('/map').then((r) => r.json()).then((g) => g.info.width));
  if (map !== 800) throw new Error(`창고 지도가 아님 (폭 ${map})`);
  for (let i = 0; i < 3; i++) {
    const { fleet: f, single: s } = await fleetVsSingle(single, ROBOT.id);
    if (moved(f, s) > 0.4) throw new Error(`멀티관제 자리를 따라 하지 않음: 멀티관제 (${f.x.toFixed(2)}, ${f.y.toFixed(2)}) · 싱글관제 (${s.x.toFixed(2)}, ${s.y.toFixed(2)})`);
    await single.waitForTimeout(1500);
  }
  await shot(single, 'sync-2-single-mirroring');

  step('멀티관제 탭을 닫으면 혼자 일하기로');
  await fleet.close();
  await single.waitForFunction((name) => document.querySelector('#tetra-demo-banner .msg')?.textContent?.includes(`데모 모드 · ${name}`), ROBOT.name, { timeout: 8000 });
  const a = await pose(single);
  await single.waitForTimeout(6000);
  const b = await pose(single);
  if (moved(a, b) < 0.5) throw new Error(`혼자 움직이지 않음: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  await shot(single, 'sync-3-single-own-route');
  await context.close();

  step('싱글관제 데모를 바로 열면 1호기');
  const direct = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await direct.goto(`${origin}${BASE_PATH}single/`, { waitUntil: 'domcontentloaded' });
  await login(direct);
  await direct.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 20000 });
  await direct.locator('#header-model-title').getByText('m', { exact: true }).waitFor({ timeout: 10000 });
  if (!(await bannerText(direct)).includes('TETRA-M 01')) throw new Error(`데모 띠에 1호기 이름이 없음: ${await bannerText(direct)}`);
  const c = await pose(direct);
  await direct.waitForTimeout(6000);
  const d = await pose(direct);
  if (moved(c, d) < 0.5) throw new Error(`혼자 움직이지 않음: ${JSON.stringify(c)} → ${JSON.stringify(d)}`);
  await shot(direct, 'sync-4-single-direct');
  await direct.close();
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let current = '';
  let ok = true;
  try {
    await run(origin, browser, (name) => { current = name; });
    console.log('✓ 멀티관제 → 싱글관제 로봇 화면 열기·따라 하기·혼자 돌기');
  } catch (e) {
    ok = false;
    console.log(`✗ ${current}: ${e.message.split('\n')[0]}`);
  }
  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})();
