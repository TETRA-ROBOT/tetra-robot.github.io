#!/usr/bin/env bash
# 싱글관제·멀티관제 원본을 정한 판(배포판 태그·브랜치)으로 받아 데모를 다시 빌드하고, 확인 시험을 돌린 뒤 판을 기록한다.
#
#   ./scripts/update_demos.sh                  # 두 데모 모두 demos/sources.json 의 ref (기본: 가장 높은 배포판 태그)
#   ./scripts/update_demos.sh --only fleet     # 멀티관제만
#   ./scripts/update_demos.sh --ref main       # 이번만 다른 판으로 (태그 v26.11.2, 브랜치 main, 커밋 해시)
#   ./scripts/update_demos.sh --no-test        # 확인 시험 건너뛰기
#   ./scripts/update_demos.sh --if-changed     # 기록된 판과 같으면 빌드하지 않음 (자동 갱신용)
#
# 원본은 .upstream/<이름>/ 에 받는다 (git 에 넣지 않음). 결과:
#   site/single, site/fleet   빌드한 데모
#   site/versions.json        빌드한 판 (소개 페이지가 읽어 데모 카드에 보여 줌)
#   demos/sources.lock.json   같은 내용 (어느 판으로 빌드했는지 git 기록으로 남김)
# 확인 시험이 실패하면 기록을 바꾸지 않고 멈춘다. 그때 site/ 의 빌드 결과는 git checkout 으로 되돌린다.
#
# 비공개 저장소라 GitHub 인증이 필요하다. 이 PC 의 git 인증을 쓰고, UPSTREAM_TOKEN 이 있으면 그 토큰을 쓴다 (CI).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="$ROOT/.upstream"
ONLY="" REF_OVERRIDE="" RUN_TEST=1 IF_CHANGED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --ref) REF_OVERRIDE="$2"; shift 2 ;;
    --no-test) RUN_TEST=0; shift ;;
    --if-changed) IF_CHANGED=1; shift ;;
    *) echo "모르는 옵션: $1" >&2; exit 2 ;;
  esac
done

# 토큰은 명령줄·원격 주소에 남기지 않고 이번 git 명령의 헤더로만 넘긴다
git_up() {
  if [ -n "${UPSTREAM_TOKEN:-}" ]; then
    local basic; basic="$(printf 'x-access-token:%s' "$UPSTREAM_TOKEN" | base64 | tr -d '\n')"
    # 빈 값으로 먼저 비운다: actions/checkout 이 github.com 용 인증 헤더를 이미 넣어 두어 헤더가 둘이면 GitHub 가 400 으로 거절한다
    git -c "http.https://github.com/.extraheader=" -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $basic" "$@"
  else
    git "$@"
  fi
}

conf() { python3 -c "import json,sys;print(json.load(open('$ROOT/demos/sources.json'))['$1']['$2'])"; }

# latest → 가장 높은 v<YY.MM.N> 태그 (싱글관제·멀티관제 software_update.sh 와 같은 규칙)
resolve_ref() {
  local url="$1" ref="$2"
  if [ "$ref" != "latest" ]; then echo "$ref"; return; fi
  local tag
  tag="$(git_up ls-remote --tags --refs "$url" | sed 's#.*refs/tags/##' \
    | grep -E '^v[0-9]{2}\.(0[1-9]|1[0-2])\.[1-9][0-9]*$' | sort -V | tail -1 || true)"
  if [ -z "$tag" ]; then echo "배포판 태그가 없습니다: $url" >&2; exit 1; fi
  echo "$tag"
}

# .upstream/<name> 을 그 판으로 맞춘다 (얕게 받음)
checkout() {
  local name="$1" url="$2" ref="$3" dir="$UPSTREAM/$1"
  if [ ! -d "$dir/.git" ]; then mkdir -p "$dir"; git -C "$dir" init -q; git -C "$dir" remote add origin "$url"; fi
  git_up -C "$dir" fetch -q --depth 1 origin "$ref" 2>/dev/null \
    || git_up -C "$dir" fetch -q --depth 1 origin "refs/tags/$ref"
  git -C "$dir" checkout -q --force --detach FETCH_HEAD
  git -C "$dir" clean -q -fdx -e node_modules
}

# 판이 바뀌어 package-lock 이 달라졌으면 의존성을 새로 깐다 (빌드 스크립트는 node_modules 가 없을 때만 깐다)
refresh_deps() {
  local ui="$1" stamp="$1/node_modules/.lock-hash" hash
  hash="$(sha1sum "$ui/package-lock.json" | cut -d' ' -f1)"
  if [ "$(cat "$stamp" 2>/dev/null || true)" != "$hash" ]; then
    rm -rf "$ui/node_modules"
    (cd "$ui" && npm ci --no-audit --no-fund --loglevel=error)
    echo "$hash" > "$stamp"
  fi
}

declare -A RESULT=()
# 기록된 "ref commit" (없으면 빈 줄)
locked() {
  python3 -c "import json,sys
try: d=json.load(open('$ROOT/demos/sources.lock.json'))['$1']; print(d['ref'], d['commit'])
except Exception: print()"
}
build_one() {
  local name="$1" url ref dir ui
  url="$(conf "$name" repo)"
  ref="$(resolve_ref "$url" "${REF_OVERRIDE:-$(conf "$name" ref)}")"
  dir="$UPSTREAM/$name"
  echo "[$name] $url @ $ref"
  checkout "$name" "$url" "$ref"
  if [ "$IF_CHANGED" = 1 ] && [ "$(locked "$name")" = "$ref $(git -C "$dir" rev-parse HEAD)" ]; then
    echo "[$name] 기록된 판과 같아 건너뜀"; return
  fi
  ui="$dir/$(conf "$name" ui_dir)"
  refresh_deps "$ui"
  case "$name" in
    single) SINGLE_UI_DIR="$ui" bash "$ROOT/demos/single/build.sh" ;;
    fleet)  FLEET_UI_DIR="$ui" FLEET_API_DIR="$dir/tetra-fleet-api" bash "$ROOT/demos/fleet/build.sh" ;;
  esac
  RESULT[$name]="$ref $(git -C "$dir" rev-parse HEAD) $(git -C "$dir" log -1 --format=%cI)"
}

for name in single fleet; do
  if [ -z "$ONLY" ] || [ "$ONLY" = "$name" ]; then build_one "$name"; fi
done

if [ ${#RESULT[@]} -eq 0 ]; then echo "바뀐 원본이 없습니다."; exit 0; fi

if [ "$RUN_TEST" = 1 ]; then
  node "$ROOT/scripts/smoke_test.cjs" ${ONLY:+--only "$ONLY"}
fi

# 이번에 빌드한 것만 바꾸고 나머지 기록은 그대로 둔다
python3 - "$ROOT" "$(for k in "${!RESULT[@]}"; do echo "$k ${RESULT[$k]}"; done)" <<'EOF'
import json, sys, os, datetime
root, lines = sys.argv[1], sys.argv[2].strip().splitlines()
lock_path = os.path.join(root, 'demos/sources.lock.json')
lock = json.load(open(lock_path)) if os.path.exists(lock_path) else {}
sources = json.load(open(os.path.join(root, 'demos/sources.json')))
for line in lines:
    name, ref, commit, date = line.split()
    prev = lock.get(name, {})
    # 원본이 그대로면 빌드 시각도 그대로 둔다 (바뀐 것이 없으면 git 에도 바뀐 것이 없게)
    built_at = prev['built_at'] if prev.get('commit') == commit and prev.get('ref') == ref else \
        datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    lock[name] = {'repo': sources[name]['repo'], 'ref': ref, 'commit': commit, 'commit_date': date, 'built_at': built_at}
text = json.dumps(dict(sorted(lock.items())), indent=2, ensure_ascii=False) + '\n'
for p in (lock_path, os.path.join(root, 'site/versions.json')):
    open(p, 'w').write(text)
print(text)
EOF
echo "완료. 바뀐 것을 확인하고 커밋하세요: git status"
