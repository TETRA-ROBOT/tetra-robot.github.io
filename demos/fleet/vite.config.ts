/**
 * TETRA 멀티관제(tetra-fleet-ui) 정적 데모 빌드 설정.
 *
 * - 원본 화면 코드(FLEET_UI_DIR, 기본 .upstream/fleet/tetra-fleet-ui)는 고치지 않고 그대로 묶는다.
 * - 진입점은 이 폴더의 index.html → demo-main.ts (가짜 서버를 먼저 깔고 원본 src/main.ts 를 불러온다).
 * - GitHub Pages 의 아무 하위 경로에서도 열리도록 base './' + 해시 주소(vue-router 감싸기).
 *
 * 실행: demos/fleet/build.sh (원본 폴더에서 그 폴더의 vite 로 이 설정을 쓴다)
 */
import type { Plugin, UserConfig } from 'vite';
import path from 'path';
import { redactSecrets } from '../shared/redact-plugin';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(process.env.FLEET_UI_DIR || path.join(here, '../../.upstream/fleet/tetra-fleet-ui'));
const apiDir = path.resolve(process.env.FLEET_API_DIR || path.join(uiDir, '../tetra-fleet-api'));
const outDir = path.resolve(process.env.FLEET_OUT_DIR || path.join(here, '../../site/fleet'));
const uiRequire = createRequire(path.join(uiDir, 'package.json'));
const nm = (p: string) => path.join(uiDir, 'node_modules', p);

// 플러그인은 원본 폴더의 node_modules 에서 읽는다 (이 폴더에는 node_modules 가 없다)
const importFromUi = async (id: string) => import(pathToFileURL(uiRequire.resolve(id)).href);

/**
 * 원본 코드에서 사이트 맨 위(/)를 가정한 주소만 고친다 (파일은 건드리지 않고 빌드할 때만).
 * - 3D 로봇 모델 STL: '/models/...' → './models/...'
 * - 파비콘: '/favicon-...svg' → './favicon-...svg'
 * - 서비스 워커 등록은 데모에서 하지 않는다 ('/sw.js' 는 다른 사이트 범위를 건드린다)
 */
function subPathFixes(): Plugin {
  const src = path.join(uiDir, 'src') + path.sep;
  return {
    name: 'tetra-demo-subpath-fixes',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(src)) return null;
      let out = code;
      if (id.endsWith(path.join('components', 'map', 'robot-model.ts'))) out = out.replace('`/models/tetra-', '`./models/tetra-');
      if (id.endsWith(path.join('composables', 'useTheme.ts'))) out = out.replace('`/favicon-', '`./favicon-');
      if (id.endsWith(path.join('src', 'main.ts'))) out = out.replace("navigator.serviceWorker.register('/sw.js')", 'Promise.resolve()');
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default async (): Promise<UserConfig> => {
  const vue = (await importFromUi('@vitejs/plugin-vue')).default;
  const vuetify = (await importFromUi('vite-plugin-vuetify')).default;
  return {
  root: here,
  base: './',
  publicDir: path.join(uiDir, 'public'),
  plugins: [vue(), vuetify({ autoImport: true }), subPathFixes(), redactSecrets()],
  resolve: {
    alias: [
      { find: '@', replacement: path.join(uiDir, 'src') },
      // 원본 src/main.ts 를 데모 진입점에서 부른다
      { find: /^@fleet-ui\/(.*)$/, replacement: path.join(uiDir, '$1') },
      // 서버 순수 로직(lib/*.ts, Node 의존 없음)을 가짜 서버가 그대로 쓴다
      { find: /^@fleet-api\/(.*)$/, replacement: path.join(apiDir, 'src', '$1') },
      // createWebHistory → createWebHashHistory (GitHub Pages 에는 서버 쪽 주소 되돌리기가 없다)
      { find: /^vue-router$/, replacement: path.join(here, 'shims/vue-router.ts') },
      { find: /^vue-router-real$/, replacement: nm('vue-router/dist/vue-router.mjs') },
      // 실시간 연결은 브라우저 안의 가짜 서버로
      { find: /^socket\.io-client$/, replacement: path.join(here, 'shims/socket.io-client.ts') },
      // 이 폴더의 파일이 쓰는 패키지도 원본과 같은 사본을 쓴다 (axios 기본값을 함께 쓰려면 꼭 같아야 한다)
      { find: /^axios$/, replacement: nm('axios/index.js') },
      // @vitejs/plugin-vue 가 vue 를 dedupe 하는데 dedupe 는 root(이 폴더)에서 찾으므로 직접 가리킨다
      { find: /^vue$/, replacement: nm('vue/dist/vue.runtime.esm-bundler.js') },
    ],
  },
  server: { fs: { allow: [here, uiDir, apiDir] } },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    reportCompressedSize: false,
  },
  logLevel: 'warn',
  };
};
