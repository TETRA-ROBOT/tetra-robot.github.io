/**
 * 공개 사이트에 나가면 안 되는 값(원본 코드에 박힌 공장 기본 비밀번호 등).
 * 값 자체를 이 저장소에 두면 그것이 또 공개되므로 SHA-256 해시만 둔다.
 *   - 빌드: demos/shared/redact-plugin.ts 가 해시가 맞는 문자열 리터럴을 REPLACEMENT 로 바꾼다
 *   - 검사: scripts/secret_scan.cjs 가 site/ 에 남아 있으면 실패한다 (갱신·배포 전에 돈다)
 * 새 값을 막으려면: printf '%s' '<값>' | sha256sum 의 결과를 HASHES 에 더한다.
 */
const crypto = require('crypto');

const HASHES = new Set([
  'e2ce1111f95284a12eb2d8c55a99ced93b96e505e7714f6ec41073412be81503', // 로봇 admin·핫스팟·관제 기본 계정 공장 비밀번호
]);
const REPLACEMENT = 'demo-password';
const MIN = 6;
const MAX = 64;

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// 따옴표 안의 문자열 (빌드 전 코드·빌드된 JS 모두)
const LITERAL = new RegExp(`(["'\`])((?:\\\\.|(?!\\1)[^\\\\\\n]){${MIN},${MAX}})\\1`, 'g');
// 공백·따옴표·구두점으로 나눈 낱말 (주석·HTML·JSON 등 따옴표 밖도 보려고)
const TOKEN = /[^\s"'`<>(){}\[\],;=:]+/g;

/** 코드 안의 막힌 문자열 리터럴을 바꾼다. 바꾼 개수를 함께 돌려준다 */
function redact(code) {
  let count = 0;
  const out = code.replace(LITERAL, (whole, quote, body) => {
    if (!HASHES.has(sha256(body))) return whole;
    count++;
    return quote + REPLACEMENT + quote;
  });
  return { code: out, count };
}

/** 텍스트에서 막힌 값이 보이는 자리(줄 번호)를 찾는다 */
function find(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    const words = new Set([...(line.match(TOKEN) || []), ...[...line.matchAll(LITERAL)].map((m) => m[2])]);
    for (const w of words) if (w.length >= MIN && w.length <= MAX && HASHES.has(sha256(w))) hits.push(i + 1);
  });
  return hits;
}

module.exports = { redact, find, REPLACEMENT };
