#!/usr/bin/env bash
# Zoria lokali = CI: build + lint + test
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1/3 build (tsc --noEmit) ==="
npm run build

echo "=== 2/3 lint (oxlint) ==="
npm run lint

echo "=== 3/3 test (vitest) ==="
npm run test

echo ""
echo "✓ verify PASS"
