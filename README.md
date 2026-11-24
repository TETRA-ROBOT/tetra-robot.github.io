# TETRA 소개 페이지 · 브라우저 데모

TETRA 로봇 소개 페이지와, 서버·로봇 없이 브라우저에서 도는 관리 화면 데모 두 개를 GitHub Pages 로 올리는 저장소입니다.

| 경로 | 내용 | 원본 |
|---|---|---|
| `/` | 소개 페이지 (모델 6종 3D 보기, 구성, 데모 링크) | `site/index.html` |
| `/single/` | 싱글관제(로봇 1대) 데모 | TetraSingleManagement `tetra-single-ui` + 그 안의 `mock/` |
| `/fleet/` | 멀티관제(여러 대) 데모 | TetraFleetManagement `tetra-fleet-ui` + `demos/fleet/mock/` |

데모는 아무 아이디·비밀번호로 로그인합니다. 데이터는 브라우저 메모리에만 있고 새로고침하면 처음으로 돌아갑니다.

## 어떻게 동작하나

원본 저장소 코드는 고치지 않고, 빌드할 때 앞단만 바꿔 끼웁니다.

- **싱글관제** (`demos/single/`): 원본 `npm run dev:mock` 이 개발 서버에서 쓰던 `mock/`(REST 응답·소켓 텔레메트리)을 브라우저 안에서 돌립니다. axios 어댑터, `fetch`·`<img>`·`<audio>` 주소 바꾸기, 메모리 안의 socket.io 서버·클라이언트, Node 모듈(`fs` 등) 대체품으로 붙입니다.
- **멀티관제** (`demos/fleet/`): 원본에 목업이 없어서 브라우저 안의 가짜 관제 서버(`demos/fleet/mock/`)를 새로 만들었습니다. 창고 지도, 로봇 4대(M·H·S·MH), 미션 배정·진행, 비상정지·운행 재개, 자동 충전, 알림, 시뮬레이터(저장된 시나리오 1개)가 돌아갑니다. 경로 찾기·미션 계획·통계·시뮬레이션 보고서는 `tetra-fleet-api/src/lib/` 의 실제 코드를 그대로 가져다 씁니다. `vue-router` 는 해시 방식으로 바꿔 끼워 어느 하위 경로에서도 열립니다.
- 데모에서 안 되는 것: 실제 로봇이 필요한 기능(지도 보내기, 와이파이, 카메라(멀티관제), AI 연결, 백업·업데이트 등)은 "데모에서는 쓸 수 없음"으로 답합니다. 교통 구역·길 그래프는 만들 수 있지만 움직임에 반영되지 않습니다.

## 원본이 바뀌었을 때 (데모 갱신)

데모가 어느 원본 판으로 빌드됐는지는 `demos/sources.lock.json` 에 남고, 소개 페이지 데모 카드에도 보입니다(`site/versions.json`).

| 파일 | 역할 |
|---|---|
| `demos/sources.json` | 따라갈 원본 판. `latest` = 가장 높은 배포판 태그(`v26.11.2` 같은), 또는 브랜치·태그 이름 |
| `demos/sources.lock.json` | 마지막으로 빌드한 판 (태그·커밋·날짜) |
| `scripts/update_demos.sh` | 원본 받기 → 빌드 → 확인 시험 → 판 기록 |
| `scripts/smoke_test.cjs` | 확인 시험: 하위 경로로 띄워 두 데모에 로그인하고, 페이지 오류·실패한 요청이 없는지 봄 |

지금은 싱글관제는 배포판(`latest`), 멀티관제는 `main` 을 따릅니다. 멀티관제 `v26.11.1` 에는 데모가 쓰는 `lib/sim-report` 가 없기 때문이며, 다음 배포판이 나오면 `sources.json` 의 `fleet.ref` 를 `latest` 로 바꾸세요.

### 자동 갱신 (GitHub Actions)

`.github/workflows/update-demos.yml` 이 매일 06:17 에 원본의 새 판을 확인합니다. 바뀌었으면 다시 빌드하고 확인 시험을 통과한 경우에만 커밋·배포합니다. 시험이 실패하면 사이트는 그대로이고, 실패 메일과 화면 캡처(`smoke-shots`)가 남습니다. 원본 API 가 바뀌어 데모의 가짜 서버(`demos/*/mock`, 싱글관제는 원본 `mock/`)를 맞춰야 할 때가 이 경우입니다.

켜려면 비밀값 하나가 필요합니다.

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token
   - Resource owner: `TETRA-ROBOT`
   - Repository access: `TetraSingleManagement`, `TetraFleetManagement` 만
   - Permissions: **Contents: Read-only** 만
2. 이 저장소 Settings → Secrets and variables → Actions → New repository secret → 이름 `UPSTREAM_TOKEN`

조직이 fine-grained 토큰 승인을 요구하면 조직 관리자가 승인해야 합니다. 비밀값이 없으면 워크플로는 경고만 남기고 아무것도 하지 않습니다.

바로 갱신하려면 Actions → **Update demos** → Run workflow. 한쪽만(`single`/`fleet`) 또는 다른 판(`v26.11.2`, `main`)을 골라 돌릴 수 있습니다. 원본 저장소에서 배포판을 낼 때 이 저장소로 `repository_dispatch`(종류 `upstream-updated`)를 보내면 그때 바로 갱신됩니다(선택).

### 내 PC 에서 갱신

GitHub 에 로그인된 PC(두 비공개 저장소를 읽을 수 있어야 함)에서:

```bash
./scripts/update_demos.sh                 # 두 데모 모두
./scripts/update_demos.sh --only fleet    # 멀티관제만
./scripts/update_demos.sh --ref main      # 이번만 다른 판
git add -A && git commit -m "데모 갱신" && git push
```

원본은 `.upstream/` 에 받습니다(git 에 넣지 않음). 확인 시험에는 Playwright 가 필요합니다: `npm ci && npx playwright install chromium`.

로컬에서 보기:

```bash
cd site && python3 -m http.server 8000   # http://localhost:8000/
```

## 배포

`main` 에 push 하면 `.github/workflows/pages.yml` 이 `site/` 를 GitHub Pages 로 올립니다(저장소 Settings → Pages → Source 를 **GitHub Actions** 로). 자동 갱신은 커밋 뒤 이 워크플로를 직접 부릅니다.

> 주의: Pages 에 올린 데모는 누구나 내려받을 수 있는 빌드된 화면 코드(JS)입니다. 서버 코드·비밀값은 들어가지 않지만, 화면 코드와 `tetra-fleet-api/src/lib` 의 일부 로직이 공개됩니다.
