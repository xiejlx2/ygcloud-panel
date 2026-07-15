#!/usr/bin/env bash
# 面板自助更新脚本。
#
# 由 /api/admin/update (POST) 通过 systemd-run 以独立 transient 服务单元启动，
# 因此 build 完 `systemctl restart` 杀主服务时不会连本脚本一起杀。
#
# 全程由环境变量驱动（均由 lib/selfUpdate.ts 的 spawnUpdater 注入）：
#   PANEL_DIR    项目根目录（同时是 git 检出目录、cwd）
#   BRANCH       拉取分支（默认 main）
#   RESTART_CMD  构建后重启服务的命令（生产：systemctl restart ygcloud-panel；为空则跳过）
#   DB_FILE      sqlite 数据库文件绝对路径（迁移前备份、失败时恢复；为空则跳过）
#   STATUS_FILE  进度状态 JSON 文件（前端轮询）
#   LOG_FILE     完整日志文件
#   OLD_COMMIT   更新前 HEAD 短 SHA（回滚目标）
#   TRIGGERED_BY 触发者用户 id（写入状态）
#
# 每个阶段回写 STATUS_FILE；任一步失败 → rollback（恢复 DB + 代码 + 重启旧版）→ 状态 error。
set -uo pipefail

PANEL_DIR="${PANEL_DIR:?PANEL_DIR 未设置}"
BRANCH="${BRANCH:-main}"
RESTART_CMD="${RESTART_CMD:-}"
DB_FILE="${DB_FILE:-}"
STATUS_FILE="${STATUS_FILE:?STATUS_FILE 未设置}"
LOG_FILE="${LOG_FILE:-/dev/null}"
OLD_COMMIT="${OLD_COMMIT:-}"
TRIGGERED_BY="${TRIGGERED_BY:-}"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DB_BACKUP=""

cd "$PANEL_DIR" || exit 1

log() { echo "[$(date -u +%H:%M:%S)] $*" >>"$LOG_FILE" 2>&1; }

# write_status <phase> <ok:true|false|null> <newCommit> <error>
# 用 node 生成 JSON（安全转义 logTail 中的引号/换行），原子写入。
write_status() {
  PHASE="$1" OKV="$2" NEWC="$3" ERRMSG="$4" \
  ST_STARTED="$STARTED_AT" ST_FILE="$STATUS_FILE" ST_OLD="$OLD_COMMIT" \
  ST_BY="$TRIGGERED_BY" ST_LOG="$LOG_FILE" \
  node -e '
    const fs = require("fs");
    const okRaw = process.env.OKV;
    const ok = okRaw === "true" ? true : okRaw === "false" ? false : null;
    let logTail = null;
    try {
      const lines = fs.readFileSync(process.env.ST_LOG, "utf8").split("\n");
      logTail = lines.slice(-16).join("\n");
    } catch {}
    const terminal = process.env.PHASE === "done" || process.env.PHASE === "error";
    const s = {
      phase: process.env.PHASE,
      startedAt: process.env.ST_STARTED,
      finishedAt: terminal ? new Date().toISOString() : null,
      oldCommit: process.env.ST_OLD || null,
      newCommit: process.env.NEWC || null,
      ok,
      error: process.env.ERRMSG || null,
      logTail,
      triggeredBy: process.env.ST_BY || null,
    };
    const tmp = process.env.ST_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
    fs.renameSync(tmp, process.env.ST_FILE);
  ' >>"$LOG_FILE" 2>&1
}

rollback() {
  local msg="$1"
  log "!! 失败：$msg —— 开始回滚到 $OLD_COMMIT"
  write_status "rollback" "false" "" "$msg"
  if [ -n "$DB_BACKUP" ] && [ -f "$DB_BACKUP" ] && [ -n "$DB_FILE" ]; then
    cp -f "$DB_BACKUP" "$DB_FILE" && log "已从 $DB_BACKUP 恢复数据库"
  fi
  if [ -n "$OLD_COMMIT" ]; then
    git reset --hard "$OLD_COMMIT" >>"$LOG_FILE" 2>&1 && log "代码已回退到 $OLD_COMMIT"
    npm install --no-audit --no-fund >>"$LOG_FILE" 2>&1 || log "回滚：npm install 返回非零"
    npm run build >>"$LOG_FILE" 2>&1 || log "回滚：build 返回非零（旧代码构建异常）"
  fi
  if [ -n "$RESTART_CMD" ]; then
    bash -c "$RESTART_CMD" >>"$LOG_FILE" 2>&1 || log "回滚：重启命令返回非零"
  fi
  write_status "error" "false" "$OLD_COMMIT" "$msg（已回滚到 $OLD_COMMIT）"
  exit 1
}

# run <cmd...>：执行并记录，失败即回滚（第一个参数用于失败信息）。
run() {
  log "+ $*"
  if ! "$@" >>"$LOG_FILE" 2>&1; then
    rollback "$1 失败"
  fi
}

log "===== 自助更新开始 old=$OLD_COMMIT branch=$BRANCH ====="
write_status "starting" "null" "" ""

# 1) 备份数据库
write_status "backup" "null" "" ""
if [ -n "$DB_FILE" ] && [ -f "$DB_FILE" ]; then
  DB_BACKUP="$PANEL_DIR/backups/db-preupdate-$(date -u +%Y%m%dT%H%M%SZ).db"
  if cp -f "$DB_FILE" "$DB_BACKUP"; then
    log "数据库已备份到 $DB_BACKUP"
  else
    rollback "数据库备份失败"
  fi
else
  log "跳过数据库备份（DB_FILE 未设置或不存在）"
fi

# 2) 拉取代码
write_status "pull" "null" "" ""
run git fetch --quiet origin "$BRANCH"
run git reset --hard "origin/$BRANCH"
NEW_COMMIT="$(git rev-parse --short HEAD 2>/dev/null)"
log "已更新代码到 $NEW_COMMIT"

# 3) 安装依赖
write_status "install" "null" "$NEW_COMMIT" ""
run npm install --no-audit --no-fund

# 4) 数据库迁移
write_status "migrate" "null" "$NEW_COMMIT" ""
run ./node_modules/.bin/prisma migrate deploy

# 5) 构建
write_status "build" "null" "$NEW_COMMIT" ""
run npm run build

# 6) 重启服务
write_status "restart" "null" "$NEW_COMMIT" ""
if [ -n "$RESTART_CMD" ]; then
  log "重启：$RESTART_CMD"
  # 重启会杀掉主服务；本脚本在独立 transient 单元中，不受影响。
  bash -c "$RESTART_CMD" >>"$LOG_FILE" 2>&1 || log "重启命令返回非零（服务正在重启时可能属正常）"
else
  log "未配置 RESTART_CMD，跳过重启（需手动重启才能生效）"
fi

log "===== 更新完成 new=$NEW_COMMIT ====="
write_status "done" "true" "$NEW_COMMIT" ""
exit 0
