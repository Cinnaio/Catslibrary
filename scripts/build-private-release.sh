#!/usr/bin/env bash
# 仅由 deploy-private.mjs 在独立 Linux 构建机调用；不连接生产数据库。
set -euo pipefail
umask 077
JOB=$(realpath "$1")
export RELEASE_SHA="$2" CATSLIBRARY_SOURCE_ADAPTER_SHA="$3" CATSLIBRARY_PRIVATE_SOURCES=1
export PATH="$4:$PATH"
PG_IMAGE="$5"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ && "$CATSLIBRARY_SOURCE_ADAPTER_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$JOB" = /*/catslibrary-release.* ]] && [ -O "$JOB" ]
[ "$(uname -s)" = Linux ]
[ -f "$JOB/core.tar" ] && [ -f "$JOB/private.tar" ]
mkdir "$JOB/core"
tar -xf "$JOB/core.tar" -C "$JOB/core"
cd "$JOB/core"
mkdir -p api/private-sources
tar -xf "$JOB/private.tar" -C api/private-sources
[ "$(node -p 'process.versions.node')" = "$(tr -d '\r\n' < .node-version)" ]
# 部署工具回归先行；失败不会继续构建或上传。
python3 scripts/test-release.py
node --test scripts/test-private-deploy.mjs
npm ci --no-audit --no-fund
npm run typecheck
node node_modules/typescript/bin/tsc -p api/private-sources/tsconfig.json --noEmit
npm run test --workspace=@zhi-zhou/api -- --config private-sources/vitest.config.ts private-sources/tests --maxWorkers=1 --minWorkers=1
npm run build
npm run release:package -- --output "$JOB/package"
tar -czf "$JOB/release.tgz" -C "$JOB/package" web/dist api/dist
sha256sum "$JOB/release.tgz" > "$JOB/release.tgz.sha256"
# 重新解出最终归档，冒烟使用它的 Node、依赖与文件，避免验错目录。
mkdir "$JOB/verified"
python3 - "$JOB" <<'PY'
import os, pathlib, runpy, shutil, sys
job = pathlib.Path(sys.argv[1])
validate = runpy.run_path('scripts/validate-release.py')['validate_archive']
manifest = validate(job / 'release.tgz', job / 'verified', os.environ['RELEASE_SHA'], pathlib.Path('.node-version').read_text().strip())
assert manifest['sourceAdapterRevision'] == os.environ['CATSLIBRARY_SOURCE_ADAPTER_SHA']
shutil.copyfile(job / 'verified/api/dist/release.json', job / 'release-manifest.json')
PY
"$JOB/verified/api/dist/runtime/node" "$JOB/verified/api/dist/check-release-runtime.mjs"
PG="catslibrary-smoke-$(basename "$JOB" | tr '[:upper:]' '[:lower:]')"
cleanup() { sudo -n docker rm -fv "$PG" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# 独立容器、随机本地端口和可删除卷；不读取或挂载生产数据。
sudo -n docker run --pull=never -d --name "$PG" --memory=256m --cpus=0.5 -e POSTGRES_USER=release_smoke -e POSTGRES_PASSWORD=release_smoke -e POSTGRES_DB=release_smoke -p 127.0.0.1::5432 "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  if sudo -n docker exec "$PG" pg_isready -U release_smoke -d release_smoke >/dev/null 2>&1; then break; fi
  sleep 1
done
sudo -n docker exec "$PG" pg_isready -U release_smoke -d release_smoke
PG_PORT=$(sudo -n docker port "$PG" 5432/tcp | awk -F: '{print $NF}')
export RELEASE_SMOKE_DATABASE_URL="postgresql://release_smoke:release_smoke@127.0.0.1:${PG_PORT}/release_smoke"
npm run release:smoke -- "$JOB/verified"
sha256sum --check --strict "$JOB/release.tgz.sha256"
printf '核心与私有书源完整归档、Linux 运行时与隔离 PostgreSQL 冒烟检查通过\n'
