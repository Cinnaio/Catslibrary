#!/usr/bin/env bash
# 原子发布：把 /tmp 里上传的 release 包切换成线上产物，失败自动回滚。
#
# 用法（由 GitHub Actions 通过 sudo -n 调用）：
#   zhizhou-release <git-sha>
#
# 设计要点：
# - 解包到临时目录并校验完整性，校验通过前不碰线上目录；
# - 用「目录改名」完成切换，任一目录切换失败都会把已切换的一侧回滚；
# - 切换后重启服务并做健康检查，不健康则整组回滚并重启旧版本；
# - 只接受 /tmp/release-<sha>.tgz，sha 必须是 7-40 位十六进制，避免任意路径。
set -euo pipefail

SITE_ROOT=/var/www/zhi-zhou
BACKUP_ROOT=/var/www/zhi-zhou-backups
SERVICE=zhizhou.service
HEALTH_URL=http://127.0.0.1:8080/api/health

log() { printf '[release] %s\n' "$*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  log '必须以 root 运行'
  exit 1
fi

SHA="${1:-}"
case "$SHA" in
  ''|*[!0-9a-f]*) log "非法的发布标识: $SHA"; exit 2 ;;
esac
if [ "${#SHA}" -lt 7 ] || [ "${#SHA}" -gt 40 ]; then
  log "发布标识长度不合法: $SHA"
  exit 2
fi

ARCHIVE="/tmp/release-${SHA}.tgz"
[ -f "$ARCHIVE" ] || { log "找不到发布包: $ARCHIVE"; exit 3; }

STAGE="$(mktemp -d /tmp/zhizhou-stage-XXXXXX)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

log "解包 $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$STAGE"
[ -f "$STAGE/web/dist/index.html" ] || { log '发布包缺少 web/dist/index.html'; exit 4; }
[ -f "$STAGE/api/dist/index.js" ] || { log '发布包缺少 api/dist/index.js'; exit 4; }
[ -d "$STAGE/api/dist/migrations" ] || { log '发布包缺少 api/dist/migrations'; exit 4; }
chmod -R u+rwX,go+rX "$STAGE/web/dist" "$STAGE/api/dist"

STAMP="$(date +%Y%m%d-%H%M%S)-${SHA:0:7}"
mkdir -p "$BACKUP_ROOT"
PREV_WEB="$SITE_ROOT/web/dist.prev-$STAMP"
PREV_API="$SITE_ROOT/api/dist.prev-$STAMP"

log "备份当前产物 -> $BACKUP_ROOT"
if [ -d "$SITE_ROOT/web/dist" ]; then tar -czf "$BACKUP_ROOT/web-dist-$STAMP.tgz" -C "$SITE_ROOT/web" dist; fi
if [ -d "$SITE_ROOT/api/dist" ]; then tar -czf "$BACKUP_ROOT/api-dist-$STAMP.tgz" -C "$SITE_ROOT/api" dist; fi

rollback() {
  log '开始回滚'
  if [ -d "$PREV_WEB" ]; then rm -rf "$SITE_ROOT/web/dist"; mv "$PREV_WEB" "$SITE_ROOT/web/dist"; fi
  if [ -d "$PREV_API" ]; then rm -rf "$SITE_ROOT/api/dist"; mv "$PREV_API" "$SITE_ROOT/api/dist"; fi
  systemctl restart "$SERVICE" || true
  sleep 5
  if curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL"; then
    log '回滚完成，服务已恢复'
  else
    log '回滚后健康检查仍失败，需要人工处理'
  fi
  exit 5
}

set_owner() {
  chown -R cinnaio:cinnaio "$1" 2>/dev/null || true
}

log "切换 web/dist"
set_owner "$STAGE/web/dist"
mv "$SITE_ROOT/web/dist" "$PREV_WEB" 2>/dev/null || true
mv "$STAGE/web/dist" "$SITE_ROOT/web/dist" || rollback

log "切换 api/dist"
set_owner "$STAGE/api/dist"
mv "$SITE_ROOT/api/dist" "$PREV_API" 2>/dev/null || true
mv "$STAGE/api/dist" "$SITE_ROOT/api/dist" || rollback

log "重启 $SERVICE"
systemctl restart "$SERVICE"
sleep 6

for i in 1 2 3 4 5; do
  if curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL"; then
    log "健康检查通过（第 ${i} 次）"
    rm -f "$ARCHIVE"
    log "发布完成: $SHA"
    exit 0
  fi
  sleep 5
done

log '健康检查连续失败'
rollback
