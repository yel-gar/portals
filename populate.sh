#!/usr/bin/env bash
# Seed the database with demo portals (idempotent) — see backend/populate.py.
# Usage: ./populate.sh  (Linux/macOS)
set -euo pipefail
cd "$(dirname "$0")"
docker compose exec backend /app/.venv/bin/python populate.py
