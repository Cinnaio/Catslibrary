#!/usr/bin/env bash
set -euo pipefail
SITE_ROOT=/var/www/zhi-zhou
cd "$SITE_ROOT"
if [ -f api/dist/release.json ]; then
  [ -x api/dist/runtime/node ] || { echo '发布包缺少 Node 运行时' >&2; exit 1; }
  exec api/dist/runtime/node api/dist/index.js
fi
# 首次迁移前或回滚到旧产物时，继续使用原来的系统 Node 与旧依赖。
exec node api/dist/index.js
