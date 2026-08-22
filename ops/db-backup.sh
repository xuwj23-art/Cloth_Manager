#!/usr/bin/env bash
#
# 服装进销存 —— 每日自动备份（数据库 + 商品图片）
# 在服务器上运行（数据库跑在 docker 容器 cloth_scan_db、图片在 cloth_scan_uploads 卷里）。
#
# 备份内容：
#   1) PostgreSQL 全库 pg_dump（商品/销售等文字数据）
#   2) uploads 卷打包（商品图片。「删除商品不删图片、历史账单可看图」是产品
#      不变量，图片丢光 = 历史账单全部裂图，必须与数据库同批备份）
#
# 失败告警：设置 NOTIFY_WEBHOOK_URL（企业微信/钉钉群机器人地址）即可，
#   任一步失败会向该地址推送文本消息；不设置则只写本地日志。
#
# 用法：
#   手动跑一次:   bash /opt/Cloth_Manager/ops/db-backup.sh
#   自动（cron）: 见 docs/服务器部署指南.md「数据库备份与恢复」一节
#
set -euo pipefail

# ===== 可调参数 =====
CONTAINER="cloth_scan_db"                # 数据库容器名
SERVER_CONTAINER="cloth_scan_server"     # 应用容器名（uploads 卷挂载在它上面）
UPLOADS_IN_CONTAINER="/app/apps/server/uploads"
DB_USER="cloth"
DB_NAME="cloth_scan"
BACKUP_DIR="/var/backups/cloth_scan"     # 不要放进 git 仓库目录，避免被误提交
RETENTION_DAYS=14                        # 只保留最近 N 天的备份，更早的自动删除
NOTIFY_WEBHOOK_URL="${NOTIFY_WEBHOOK_URL:-}"  # 可选：失败告警 webhook（企业微信/钉钉群机器人）
# ====================

mkdir -p "$BACKUP_DIR"
LOG="$BACKUP_DIR/backup.log"
TS="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads_${TS}.tar.gz"

# 失败告警（兼容企业微信/钉钉群机器人的 text 消息格式；发不出不阻塞备份流程）
notify() {
  echo "[$(date '+%F %T')] ALERT $1" >> "$LOG"
  if [ -n "$NOTIFY_WEBHOOK_URL" ]; then
    curl -s -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"[cloth_scan 备份告警] $1\"}}" \
      "$NOTIFY_WEBHOOK_URL" > /dev/null 2>&1 || true
  fi
}

FAILED=0

# ---- 1) 数据库 ----
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$FILE"; then
  if [ -s "$FILE" ]; then
    SIZE="$(du -h "$FILE" | cut -f1)"
    echo "[$(date '+%F %T')] OK   db   $FILE ($SIZE)" >> "$LOG"
  else
    rm -f "$FILE"
    notify "pg_dump 导出文件为空：$FILE"
    FAILED=1
  fi
else
  rm -f "$FILE"
  notify "pg_dump 执行失败（容器 $CONTAINER 是否在运行？）"
  FAILED=1
fi

# ---- 2) 商品图片卷 ----
# 借用已有的 postgres:16-alpine 镜像临时容器挂载 uploads 卷打包，避免额外拉镜像
if docker run --rm --volumes-from "$SERVER_CONTAINER" \
    -v "$BACKUP_DIR":/backup postgres:16-alpine \
    tar czf "/backup/uploads_${TS}.tar.gz" -C "$UPLOADS_IN_CONTAINER" . 2>>"$LOG"; then
  if [ -s "$UPLOADS_FILE" ]; then
    SIZE="$(du -h "$UPLOADS_FILE" | cut -f1)"
    echo "[$(date '+%F %T')] OK   imgs $UPLOADS_FILE ($SIZE)" >> "$LOG"
  else
    rm -f "$UPLOADS_FILE"
    notify "uploads 打包结果为空：$UPLOADS_FILE"
    FAILED=1
  fi
else
  rm -f "$UPLOADS_FILE"
  notify "uploads 卷打包失败（容器 $SERVER_CONTAINER 是否在运行？）"
  FAILED=1
fi

# ---- 3) 清理过期备份 ----
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "uploads_*.tar.gz" -type f -mtime +"$RETENTION_DAYS" -delete

exit "$FAILED"
