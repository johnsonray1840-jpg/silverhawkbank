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
DB_PORT="${DB_PORT:-5432}"

mkdir -p "${BACKUP_DIR}"

BACKUP_FILE="${BACKUP_DIR}/silverhawk_backup_${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_DIR}/silverhawk_backup_${TIMESTAMP}.sha256"

echo "======================================================"
echo "🏦 SILVERHAWK BANKING DB BACKUP: Starting..."
echo "Target File: ${BACKUP_FILE}"
echo "======================================================"

# Execute pg_dump with gzip compression
PGPASSWORD="${DB_PASSWORD:-SilverhawkSecPass2026!}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --compress=9 \
  --file="${BACKUP_FILE}"

# Generate SHA-256 integrity checksum
sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"

echo "✅ Backup completed successfully!"
echo "📦 Archive:  ${BACKUP_FILE} ($(du -sh "${BACKUP_FILE}" | cut -f1))"
echo "🔒 Checksum: $(cat "${CHECKSUM_FILE}")"
echo "======================================================"

