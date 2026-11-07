#!/usr/bin/env bash
# 协议 2：代码、依赖与 Node 一起切换；切换后任何失败均尝试整组回滚。
set -euo pipefail
umask 022
SITE_ROOT=/var/www/zhi-zhou
BACKUP_ROOT=/var/www/zhi-zhou-backups
SERVICE=zhizhou.service
SERVICE_USER=cinnaio
VALIDATOR=/usr/local/lib/zhizhou/validate-release.py
LOCK_FILE=/var/lock/zhizhou-release.lock
BASE_URL=http://127.0.0.1:8080
ARCHIVE_ROOT=/tmp
log() { printf '[release] %s\n' "$*" >&2; }
if [ "${1:-}" = --protocol-version ]; then printf '2\n'; exit 0; fi
[ "$(id -u)" -eq 0 ] || { log '必须以 root 运行'; exit 1; }
SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { log '发布标识必须是完整的 Git SHA'; exit 2; }
ARCHIVE="$ARCHIVE_ROOT/release-${SHA}.tgz"
[ -f "$ARCHIVE" ] || { log "找不到发布包: $ARCHIVE"; exit 3; }
exec 9>"$LOCK_FILE"
flock -n 9 || { log '另一个发布正在执行'; exit 3; }
STAGE="$(mktemp -d "$SITE_ROOT/.release-stage-XXXXXX")"
STAMP="$(date +%Y%m%d-%H%M%S)-${SHA:0:7}-$$"
PREV_WEB="$SITE_ROOT/web/dist.prev-$STAMP"
PREV_API="$SITE_ROOT/api/dist.prev-$STAMP"
SWITCH_STARTED=0

ready() {
  local expected="$1" body
  body=$(curl -fsS --max-time 5 "$BASE_URL/api/ready") || return 1
  printf '%s' "$body" | python3 -c 'import json,sys; p=json.load(sys.stdin); sys.exit(0 if p.get("ready") is True and p.get("release")==sys.argv[1] else 1)' "$expected"
}
check_site() {
  local html entry
  html=$(curl -fsS --max-time 5 "$BASE_URL/") || return 1
  entry=$(printf '%s' "$html" | grep -o '/assets/index-[A-Za-z0-9_.-]*\.js' | head -1) || return 1
  [ -n "$entry" ] || return 1
  curl -fsS -o /dev/null --max-time 5 "$BASE_URL$entry" && curl -fsS -o /dev/null --max-time 5 "$BASE_URL/api/novels?limit=1"
}
rollback() {
  local failed=0 expected=''
  log '开始回滚代码、依赖与运行时；数据库迁移不自动降级'
  systemctl stop "$SERVICE" || { log '无法停止服务，保留目录，需要人工处理'; return 1; }
  # 根据实际目录恢复，覆盖 rename 已完成、下一条状态赋值前被中断的窗口。
  for component in web api; do
    local previous="$PREV_WEB" current="$SITE_ROOT/$component/dist"
    if [ "$component" = api ]; then previous="$PREV_API"; fi
    if [ -e "$previous" ]; then
      if rm -rf -- "$current"; then mv -- "$previous" "$current" || failed=1; else failed=1; fi
    elif [ ! -e "$STAGE/$component/dist" ]; then
      rm -rf -- "$current" || failed=1
    fi
  done
  if [ "$failed" -ne 0 ]; then log '回滚目录或停止服务失败，保留现场，需要人工处理'; return 1; fi
  systemctl restart "$SERVICE" || { log '旧服务重启失败，需要人工处理'; return 1; }
  if [ -f "$SITE_ROOT/api/dist/release.json" ]; then
    expected=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["releaseSha"])' "$SITE_ROOT/api/dist/release.json") || return 1
  fi
  for _ in 1 2 3 4 5; do
    if [ -n "$expected" ]; then
      if ready "$expected" && check_site; then log '旧版本就绪检查通过'; return 0; fi
    elif curl -fsS -o /dev/null --max-time 5 "$BASE_URL/api/health"; then
      log '旧版存活检查通过（旧版尚无就绪接口）'; return 0
    fi
    sleep 2
  done
  log '回滚后的检查未通过，需要人工处理'; return 1
}
finish() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ] && [ "$SWITCH_STARTED" -eq 1 ]; then rollback || log "回滚未完成；备份位于 $BACKUP_ROOT"; fi
  rm -rf -- "$STAGE" || log "暂存目录清理失败: $STAGE"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

log '解包并校验完整发布包'
python3 "$VALIDATOR" "$ARCHIVE" "$STAGE" "$SHA"
chmod 755 "$STAGE"
# 绝不以 root 执行包内 Node 或 JS；原生依赖、glibc 与模块解析在服务账号下预检。
runuser -u "$SERVICE_USER" -- env -u NODE_OPTIONS -u NODE_PATH "$STAGE/api/dist/runtime/node" "$STAGE/api/dist/check-release-runtime.mjs"
systemctl show -p ExecStart --value "$SERVICE" | grep -Fq '/usr/local/bin/zhizhou-start' || { log '请先安装发布启动器并更新 systemd ExecStart'; exit 4; }
mkdir -p "$BACKUP_ROOT"
if [ -d "$SITE_ROOT/web/dist" ]; then tar -czf "$BACKUP_ROOT/web-dist-$STAMP.tgz" -C "$SITE_ROOT/web" dist; fi
if [ -d "$SITE_ROOT/api/dist" ]; then tar -czf "$BACKUP_ROOT/api-dist-$STAMP.tgz" -C "$SITE_ROOT/api" dist; fi
SWITCH_STARTED=1
systemctl stop "$SERVICE"
# 预备目录与线上目录处在同一文件系统；服务停止后成组切换，避免加载混合版本。
if [ -e "$SITE_ROOT/web/dist" ]; then mv -- "$SITE_ROOT/web/dist" "$PREV_WEB"; fi
mv -- "$STAGE/web/dist" "$SITE_ROOT/web/dist"
if [ -e "$SITE_ROOT/api/dist" ]; then mv -- "$SITE_ROOT/api/dist" "$PREV_API"; fi
mv -- "$STAGE/api/dist" "$SITE_ROOT/api/dist"
systemctl restart "$SERVICE"
for i in 1 2 3 4 5; do
  if ready "$SHA" && check_site; then
    log "目标版本、数据库、首页与业务检查通过（第 ${i} 次）"
    SWITCH_STARTED=0
    rm -f -- "$ARCHIVE" || log '上传归档清理失败，已部署产物保持有效'
    log "发布完成: $SHA"
    exit 0
  fi
  sleep 5
done
log '就绪检查连续失败'
exit 5
