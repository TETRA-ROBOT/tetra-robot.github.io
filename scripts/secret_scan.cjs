#!/usr/bin/env node
/**
 * 공개 전 검사: 공개하면 안 되는 값(scripts/lib/secrets.cjs 의 해시)이 들어 있는 파일이 있으면 실패한다.
 *   node scripts/secret_scan.cjs [폴더…]   (기본: site)
 * 데모 갱신(update_demos.sh)과 Pages 배포(pages.yml) 전에 돈다.
 */
const fs = require('fs');
const path = require('path');
const { find } = require('./lib/secrets.cjs');

const roots = process.argv.slice(2).length ? process.argv.slice(2) : [path.resolve(__dirname, '../site')];
const TEXT = /\.(html?|js|mjs|cjs|css|json|svg|txt|md|map|ts|vue|ya?ml)$/i;
let files = 0;
const hits = [];
function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const n of fs.readdirSync(p)) if (n !== 'node_modules' && n !== '.git') walk(path.join(p, n)); return; }
  if (!TEXT.test(p)) return;
  files++;
  const lines = find(fs.readFileSync(p, 'utf8'));
  if (lines.length) hits.push(`${path.relative(process.cwd(), p)}: ${lines.slice(0, 5).join(', ')}번째 줄`);
}
roots.forEach(walk);
if (hits.length) {
  console.log(`✗ 공개하면 안 되는 값이 ${hits.length}개 파일에 있습니다 (값은 보이지 않게 줄 번호만):\n  - ${hits.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ 공개 금지 값 없음 (파일 ${files}개 검사)`);
