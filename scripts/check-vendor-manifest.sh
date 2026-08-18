#!/usr/bin/env bash
# Thin wrapper around the Node guard so cookbook commands keep working.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node_modules/.bin/tsx scripts/check-vendor-manifest.ts
