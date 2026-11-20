#!/usr/bin/env bash
# Corre las pruebas en Docker (no hace falta PHP local). Monta la raiz del repo para ver docs/sso/vectores.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"
docker run --rm -v "$RAIZ":/app:ro -w /app/kit/php php:8.3-cli php -d error_reporting=-1 -d display_errors=1 tests/run.php
