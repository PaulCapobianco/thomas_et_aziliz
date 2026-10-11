#!/usr/bin/env bash
# Install pinned dependencies first with npm ci. No CDN is used by guests.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/vendor.mjs
