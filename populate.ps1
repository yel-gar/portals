#!/usr/bin/env pwsh
# Seed the database with demo portals (idempotent) — see backend/populate.py.
# Usage: .\populate.ps1  (PowerShell 7+, cross-platform)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
docker compose exec backend /app/.venv/bin/python populate.py
