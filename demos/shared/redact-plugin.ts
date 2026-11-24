/**
 * 공개하면 안 되는 문자열(원본 코드에 박힌 공장 기본 비밀번호)을 빌드 결과에서 빼는 Vite 플러그인.
 * 막을 값은 해시로만 scripts/lib/secrets.cjs 에 있다. 원본을 고치지 않고 모든 모듈(원본·목업·node_modules)을 거친 뒤 바꾼다.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const secrets = createRequire(import.meta.url)(path.join(here, '../../scripts/lib/secrets.cjs')) as {
  redact: (code: string) => { code: string; count: number };
};

export function redactSecrets(): Plugin {
  const pass = (code: string): { code: string; map: null } | null => {
    const result = secrets.redact(code);
    return result.count ? { code: result.code, map: null } : null;
  };
  return {
    name: 'tetra-redact-secrets',
    enforce: 'post',
    // 모듈마다 (TS·Vue 가 JS 로 바뀐 뒤) 한 번, 묶은 결과에서 한 번 더
    transform: (code) => pass(code),
    renderChunk: (code) => pass(code),
  };
}
