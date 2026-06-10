#!/usr/bin/env bash
#
# 服装进销存 —— PostgreSQL 每日自动备份
# 在服务器上运行（数据库跑在 docker 容器 cloth_scan_db 里）。
# 只备份数据库（商品/销售等文字数据，体积很小）；图片文件不在库里，不在此备份范围。
#
# 用法：
#   手动跑一次:   bash /opt/Cloth_Manager/ops/db-backup.sh
#   自动（cron）: 见 docs/服务器部署指南.md「数据库备份」一节
#
set -euo pipefail

# ===== 可调参数 =====
CONTAINER="cloth_scan_db"          # 数据库容器名
DB_USER="cloth"
DB_NAME="cloth_scan"
BACKUP_DIR="/opt/Cloth_Manager/backups"
RETENTION_DAYS=14                  # 只保留最近 N 天的备份，更早的自动删除
# ====================

mkdir -p "$BACKUP_DIR"
LOG="$BACKUP_DIR/backup.log"
TS="$(date +%Y%m%d_%H%M%S)"
FILE="$BACKUP_DIR/${DB_NAME}_${TS}.sql.gz"

# 流式导出 + gzip 压缩（几乎不占内存）
if docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$FILE"; then
  if [ -s "$FILE" ]; then
    SIZE="$(du -h "$FILE" | cut -f1)"
    echo "[$(date '+%F %T')] OK  $FILE ($SIZE)" >> "$LOG"
    # 清理过期备份
    find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete
  else
    echo "[$(date '+%F %T')] FAIL 导出文件为空，已删除 $FILE" >> "$LOG"
    rm -f "$FILE"
    exit 1
  fi
else
  echo "[$(date '+%F %T')] FAIL pg_dump 执行失败（容器是否在运行？）" >> "$LOG"
  rm -f "$FILE"
  exit 1
fi
