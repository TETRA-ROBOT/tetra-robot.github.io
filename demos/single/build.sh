#!/usr/bin/env bash
# TETRA 싱글 관제 UI 정적 데모를 site/single/ 로 빌드한다.
#   SINGLE_UI_DIR  원본 UI 폴더 (기본: scripts/update_demos.sh 가 받아 둔 .upstream/single/tetra-single-ui)
#   SINGLE_OUT_DIR 출력 폴더 (기본: ../../site/single)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SINGLE_UI_DIR="$(cd "${SINGLE_UI_DIR:-$HERE/../../.upstream/single/tetra-single-ui}" && pwd)"
export SINGLE_OUT_DIR="${SINGLE_OUT_DIR:-$HERE/../../site/single}"

if [ ! -d "$SINGLE_UI_DIR/node_modules" ]; then
  echo "[single-demo] installing upstream dependencies in $SINGLE_UI_DIR"
  (cd "$SINGLE_UI_DIR" && npm ci --no-audit --no-fund)
fi

# 이 폴더의 설정·대역 파일이 원본과 같은 패키지(axios 등)를 쓰도록 원본 node_modules 를 가리킨다
if [ "$(readlink "$HERE/node_modules" 2>/dev/null || true)" != "$SINGLE_UI_DIR/node_modules" ]; then
  rm -rf "$HERE/node_modules"
  ln -s "$SINGLE_UI_DIR/node_modules" "$HERE/node_modules"
fi

cd "$HERE"
"$SINGLE_UI_DIR/node_modules/.bin/vite" build --config "$HERE/vite.config.ts"
BRAND="$(cd "$HERE/../../site/assets" && pwd)"  # 사이트 공용 아이콘 (TETRA ROBOT 조직 아이콘)
cp "$BRAND/../favicon.ico" "$SINGLE_OUT_DIR/favicon.ico"
cp "$BRAND/favicon.svg" "$SINGLE_OUT_DIR/favicon.svg"
echo "[single-demo] built into $(cd "$SINGLE_OUT_DIR" && pwd)"
