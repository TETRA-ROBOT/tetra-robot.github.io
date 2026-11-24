/**
 * TETRA 싱글 관제 UI 의 정적 데모 빌드 (GitHub Pages 등 아무 하위 경로에서 열리게 base './').
 * 원본(SINGLE_UI_DIR)은 고치지 않고, 이 폴더의 index.html → demo-main.ts 가 목업을 설치한 뒤 원본 src/main.ts 를 부른다.
 */
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(process.env.SINGLE_UI_DIR || path.join(HERE, '../../../tetrasinglemanagement/tetra-single-ui'));
const API_SRC = path.resolve(UI_DIR, '../tetra-single-api/src');
const MOCK_DIR = path.join(UI_DIR, 'mock');
const OUT_DIR = path.resolve(process.env.SINGLE_OUT_DIR || path.join(HERE, '../../site/single'));
const SHIMS = path.join(HERE, 'shims');

/** 원본 vite.config.ts 의 backendRoutes 를 그대로 읽어 목업이 받을 경로를 맞춘다 */
function readBackendRoutes(): string[] {
  const source = fs.readFileSync(path.join(UI_DIR, 'vite.config.ts'), 'utf8');
  const match = /const backendRoutes\s*=\s*\[([\s\S]*?)\]/.exec(source);
  if (!match) throw new Error('backendRoutes not found in upstream vite.config.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const NODE_SHIMS: Record<string, string> = {
  fs: path.join(SHIMS, 'fs.ts'),
  path: 'path-browserify',
  os: path.join(SHIMS, 'node-misc.ts'),
  child_process: path.join(SHIMS, 'node-misc.ts'),
  url: path.join(SHIMS, 'node-misc.ts'),
  crypto: path.join(SHIMS, 'node-misc.ts'),
  'socket.io': path.join(SHIMS, 'socket.io-server.ts'),
};

const inside = (file: string | undefined, dir: string): boolean => !!file && path.resolve(file.split('?')[0]).startsWith(dir + path.sep);

/** mock/ 과 API 소스가 부르는 node 모듈만 브라우저 대역으로 바꾼다 (앱 쪽 의존성은 건드리지 않음) */
function demoNodeShims(): Plugin {
  return {
    name: 'tetra-demo-node-shims',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (source === 'virtual:demo-builtin-sounds') return '\0demo-builtin-sounds';
      if (!inside(importer, MOCK_DIR) && !inside(importer, API_SRC) && !inside(importer, SHIMS)) return null;
      const bare = source.replace(/^node:/, '');
      const target = NODE_SHIMS[bare];
      if (!target || (inside(importer, SHIMS) && bare !== 'path')) return null;
      if (path.isAbsolute(target)) return target;
      return (await this.resolve(target, path.join(HERE, 'index.html'), { skipSelf: true }))?.id ?? null;
    },
    // 기본 소리 파일(API src/views/sound)을 base64 로 묶은 가상 모듈 (메모리 fs 가 동기로 읽는다)
    load(id) {
      if (id !== '\0demo-builtin-sounds') return null;
      const dir = path.join(API_SRC, 'views/sound');
      const entries = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => !name.startsWith('.')) : [];
      const table = Object.fromEntries(entries.map((name) => [name, fs.readFileSync(path.join(dir, name)).toString('base64')]));
      return `export default ${JSON.stringify(table)};`;
    },
    transform(code, id) {
      // API 소스의 import.meta.url 을 고정 주소로 바꿔, 기본 소리 폴더가 메모리 fs 의 /api/src/views/sound 가 되게 한다
      if (!inside(id, API_SRC) || !code.includes('import.meta.url')) return null;
      const virtual = 'file:///api/src/' + path.relative(API_SRC, id.split('?')[0]).split(path.sep).join('/');
      return { code: code.replaceAll('import.meta.url', JSON.stringify(virtual)), map: null };
    },
  };
}

export default defineConfig({
  root: HERE,
  base: './',
  publicDir: false,
  plugins: [demoNodeShims(), vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: [
      { find: /^socket\.io-client$/, replacement: path.join(SHIMS, 'socket.io-client.ts') },
      { find: /^@mock\//, replacement: MOCK_DIR + '/' },
      { find: /^@api\//, replacement: API_SRC + '/' },
      { find: /^@\//, replacement: path.join(UI_DIR, 'src') + '/' },
      { find: /^util$/, replacement: path.join(UI_DIR, 'src/plugins/util.ts') },
      { find: /^math3d$/, replacement: path.join(UI_DIR, 'src/lib/math3d.ts') },
    ],
    extensions: ['.ts', '.vue', '.mjs', '.js', '.jsx', '.tsx', '.json'],
  },
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
    __DEMO_BACKEND_ROUTES__: JSON.stringify(readBackendRoutes()),
  },
  assetsInclude: ['**/*.mpeg', '**/*.mp3', '**/*.mp4'],
  server: { fs: { allow: [HERE, path.dirname(UI_DIR)] } },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
