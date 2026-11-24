#!/usr/bin/env bash
# TETRA 멀티관제 화면(tetra-fleet-ui)을 가짜 서버와 함께 정적 데모로 빌드해 site/fleet 에 넣는다.
#   FLEET_UI_DIR  원본 화면 폴더 (기본 /home/user/tetrafleetmanagement/tetra-fleet-ui)
#   FLEET_API_DIR 원본 서버 폴더 (기본 $FLEET_UI_DIR/../tetra-fleet-api, lib/ 의 순수 로직을 쓴다)
# 원본 폴더는 고치지 않는다 (node_modules 가 없으면 npm ci 만 한다). vue-tsc 는 건너뛴다.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FLEET_UI_DIR="${FLEET_UI_DIR:-/home/user/tetrafleetmanagement/tetra-fleet-ui}"
export FLEET_UI_DIR
export FLEET_OUT_DIR="${FLEET_OUT_DIR:-$(cd "$HERE/../.." && pwd)/site/fleet}"
if [ ! -d "$FLEET_UI_DIR/src" ]; then
  echo "원본 화면 폴더가 없습니다: $FLEET_UI_DIR (FLEET_UI_DIR 로 바꾸세요)" >&2
  exit 1
fi
if [ ! -d "$FLEET_UI_DIR/node_modules" ]; then
  echo "[fleet] npm ci ($FLEET_UI_DIR)"
  (cd "$FLEET_UI_DIR" && npm ci --no-audit --no-fund)
fi
echo "[fleet] vite build → $FLEET_OUT_DIR"
cd "$FLEET_UI_DIR"
./node_modules/.bin/vite build --config "$HERE/vite.config.ts"
# 데모에는 필요 없는 파일 (서비스 워커·앱 설치 정보는 사이트 전체 범위를 건드린다)
rm -f "$FLEET_OUT_DIR/sw.js" "$FLEET_OUT_DIR/manifest.webmanifest"
echo "[fleet] 완료: $FLEET_OUT_DIR"
