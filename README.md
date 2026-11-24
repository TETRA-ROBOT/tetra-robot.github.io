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

## 다시 빌드하기

원본 저장소를 이 저장소 옆 폴더에 받아 둡니다.

```
parent/
├── tetra-site/                 (이 저장소)
├── tetrasinglemanagement/      TETRA-ROBOT/TetraSingleManagement
└── tetrafleetmanagement/       TETRA-ROBOT/TetraFleetManagement
```

```bash
./scripts/build_all.sh
```

다른 위치면 `SINGLE_UI_DIR`, `FLEET_UI_DIR`, `FLEET_API_DIR` 로 지정합니다. 결과는 `site/single`, `site/fleet` 에 들어가고, 이것을 커밋합니다.

확인:

```bash
cd site && python3 -m http.server 8000   # http://localhost:8000/
```

## 배포

`main` 에 push 하면 `.github/workflows/pages.yml` 이 `site/` 를 GitHub Pages 로 올립니다(저장소 Settings → Pages → Source 를 **GitHub Actions** 로). 원본 저장소가 비공개라서 CI 에서 빌드하지 않고 빌드 결과를 커밋합니다.

> 주의: Pages 에 올린 데모는 누구나 내려받을 수 있는 빌드된 화면 코드(JS)입니다. 서버 코드·비밀값은 들어가지 않지만, 화면 코드와 `tetra-fleet-api/src/lib` 의 일부 로직이 공개됩니다.
