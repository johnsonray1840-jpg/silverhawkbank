#!/usr/bin/env bash
# ==============================================================================
# SILVERHAWK DIGITAL BANKING — AUTOMATED DATABASE BACKUP SCRIPT
# Creates a compressed, timestamped, checksummed database snapshot
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME="${DB_NAME:-silverhawk_db}"
DB_USER="${DB_USER:-silverhawk_admin}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"

mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/silverhawk_backup_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_DIR}/silverhawk_backup_${TIMESTAMP}.sha256"

echo "======================================================"
echo "🏦 SILVERHAWK BANKING DB BACKUP: Starting..."
echo "Target File: ${BACKUP_FILE}"
echo "======================================================"

# Execute mysqldump with gzip compression
MYSQL_PWD="${DB_PASSWORD:-silverhawkpass}" mysqldump \
  -h "${DB_HOST}" \
  -P "${DB_PORT}" \
  -u "${DB_USER}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  "${DB_NAME}" | gzip -9 > "${BACKUP_FILE}"

# Generate SHA-256 integrity checksum
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
else
  shasum -a 256 "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
fi

echo "✅ Backup completed successfully!"
echo "📦 Archive:  ${BACKUP_FILE} ($(du -sh "${BACKUP_FILE}" | cut -f1))"
echo "🔒 Checksum: $(cat "${CHECKSUM_FILE}")"
echo "======================================================"

