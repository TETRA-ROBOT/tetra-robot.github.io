#!/usr/bin/env bash
# 두 데모를 다시 빌드해 site/single, site/fleet 에 넣는다.
# 원본 화면 코드는 옆 폴더의 저장소를 쓴다 (바꾸려면 SINGLE_UI_DIR, FLEET_UI_DIR).
#   ../tetrasinglemanagement/tetra-single-ui   (TETRA-ROBOT/TetraSingleManagement)
#   ../tetrafleetmanagement/tetra-fleet-ui     (TETRA-ROBOT/TetraFleetManagement)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/demos/single/build.sh"
bash "$ROOT/demos/fleet/build.sh"
echo "완료: $ROOT/site  (확인: cd site && python3 -m http.server 8000)"
