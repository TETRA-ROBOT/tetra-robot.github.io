/**
 * 확인 시험 공용: site/ 를 하위 경로(/x/y/)로 띄우는 작은 정적 서버와 데모 로그인.
 * smoke_test.cjs · label_overlap_check.cjs · fleet_single_sync_check.cjs 가 같이 쓴다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '../../site');
const BASE_PATH = '/x/y/'; // 사이트 맨 위가 아니어도 열리는지 함께 본다

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.stl': 'model/stl',
  '.mpeg': 'audio/mpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.wasm': 'application/wasm' };

/** @returns 듣고 있는 http.Server (주소는 server.address().port) */
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

module.exports = { serve, login, SITE, BASE_PATH };
