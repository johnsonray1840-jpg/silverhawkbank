#!/usr/bin/env bash
# ==============================================================================
# SILVERHAWK DIGITAL BANKING — DATABASE RESTORATION SCRIPT
# Restores database from a compressed snapshot with checksum verification
# ==============================================================================

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path-to-backup-file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"
DB_NAME="${DB_NAME:-silverhawk_db}"
DB_USER="${DB_USER:-silverhawk_admin}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ Error: Backup file ${BACKUP_FILE} does not exist!"
  exit 1
fi

echo "======================================================"
echo "⚠️  SILVERHAWK BANKING DB RESTORE"
echo "Target DB:   ${DB_NAME}"
echo "Source File: ${BACKUP_FILE}"
echo "======================================================"

# Verify checksum if .sha256 file exists alongside backup
CHECKSUM_FILE="${BACKUP_FILE%.sql.gz}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "🔍 Verifying SHA-256 integrity checksum..."
  sha256sum -c "${CHECKSUM_FILE}"
  echo "✅ Checksum verified!"
fi

echo "🔄 Restoring database snapshot..."
PGPASSWORD="${DB_PASSWORD:-SilverhawkSecPass2026!}" pg_restore \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "${BACKUP_FILE}"

echo "✅ Database restored successfully!"
echo "======================================================"

