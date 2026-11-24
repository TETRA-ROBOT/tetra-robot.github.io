#!/usr/bin/env node
/**
 * 데모 확인 시험: site/ 를 하위 경로(/x/y/)로 띄우고 브라우저로 소개 페이지·두 데모를 연다.
 * 아무 계정으로 로그인해서 주 화면이 뜨는지, 페이지 오류·실패한 요청이 없는지 본다.
 * 원본(싱글관제·멀티관제)이 바뀌어 데모의 가짜 서버와 맞지 않게 되면 여기서 걸린다.
 *
 *   node scripts/smoke_test.cjs [--only single|fleet] [--shots <폴더>]
 * Playwright 가 필요하다 (CI: npm ci && npx playwright install --with-deps chromium).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SITE = path.resolve(__dirname, '../site');
const BASE_PATH = '/x/y/'; // 사이트 맨 위가 아니어도 열리는지 함께 본다
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.stl': 'model/stl',
  '.mpeg': 'audio/mpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE_PATH)) { res.writeHead(404).end(); return; }
    let file = path.join(SITE, url.slice(BASE_PATH.length));
    if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** 보이는 입력 칸을 채우고 비밀번호 칸에서 Enter (두 화면 모두 아무 계정이나 통과) */
async function login(page) {
  const password = page.locator('input[type="password"]:visible').first();
  await password.waitFor({ timeout: 20000 });
  const textInputs = page.locator('input[type="text"]:visible, input:not([type]):visible');
  for (let i = 0; i < await textInputs.count(); i++) await textInputs.nth(i).fill('demo');
  await password.fill('demo1234!');
  await password.press('Enter');
}

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
