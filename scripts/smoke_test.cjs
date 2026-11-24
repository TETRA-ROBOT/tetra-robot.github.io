#!/usr/bin/env node
/**
 * 데모 확인 시험: site/ 를 하위 경로(/x/y/)로 띄우고 브라우저로 소개 페이지·두 데모를 연다.
 * 아무 계정으로 로그인해서 주 화면이 뜨는지, 페이지 오류·실패한 요청이 없는지 본다.
 * 원본(싱글관제·멀티관제)이 바뀌어 데모의 가짜 서버와 맞지 않게 되면 여기서 걸린다.
 *
 *   node scripts/smoke_test.cjs [--only single|fleet] [--shots <폴더>]
 * Playwright 가 필요하다 (CI: npm ci && npx playwright install --with-deps chromium).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve, login, BASE_PATH } = require('./lib/demo_server.cjs');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

const CASES = [
  {
    name: 'landing', path: '',
    async check(page) { await page.getByText('설치 없이 브라우저에서 체험').waitFor(); },
  },
  {
    name: 'single', path: 'single/',
    async check(page) {
      await login(page);
      await page.waitForFunction(() => !location.hash.includes('login'), null, { timeout: 20000 });
      await page.getByText('비상정지').first().waitFor({ timeout: 20000 });
      // 원본 목업(사무실 지도, 원을 도는 로봇)이 아니라 멀티관제와 같은 창고 현장으로 바꿔 끼워졌는지 (demos/single/world)
      const world = await page.evaluate(async () => {
        const json = (p) => fetch(p).then((r) => r.json());
        const [nav, map, locations] = await Promise.all([json('/nav'), json('/map'), json('/location')]);
        return { x: nav.translation.x, y: nav.translation.y, width: map.info.width, names: locations.map((l) => l.location_name) };
      });
      if (world.width !== 800 || !world.names.includes('충전소 1') || !world.names.includes('출고장 1')) throw new Error(`창고 지도·장소가 아님: ${JSON.stringify({ width: world.width, names: world.names })}`);
      if (!(world.x > 1 && world.x < 39 && world.y > 1 && world.y < 23)) throw new Error(`로봇이 창고 안에 있지 않음: (${world.x}, ${world.y})`);
    },
  },
  {
    name: 'fleet', path: 'fleet/',
    async check(page) {
      await login(page);
      await page.waitForFunction(() => location.hash.includes('/monitor'), null, { timeout: 20000 });
      await page.getByText('TETRA-', { exact: false }).first().waitFor({ timeout: 20000 });
    },
  },
];

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  for (const c of CASES) {
    if (only && c.name !== 'landing' && c.name !== only) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`페이지 오류: ${e.message}`));
    page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) problems.push(`${r.status()} ${r.url().slice(origin.length)}`); });
    page.on('requestfailed', (r) => { if (r.url().startsWith(origin)) problems.push(`요청 실패 ${r.url().slice(origin.length)}`); });
    try {
      await page.goto(origin + BASE_PATH + c.path, { waitUntil: 'domcontentloaded' });
      await c.check(page);
      await page.waitForTimeout(4000); // 실시간 갱신이 몇 번 돌 때까지
    } catch (e) {
      problems.push(`확인 실패: ${e.message.split('\n')[0]}`);
    }
    if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot({ path: path.join(shots, `${c.name}.png`) }); }
    if (problems.length) { failed++; console.log(`✗ ${c.name}\n  - ${problems.join('\n  - ')}`); }
    else console.log(`✓ ${c.name}`);
    await page.close();
  }
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
