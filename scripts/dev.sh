#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "ERROR: .env.local not found. Copy .env.example and fill in values."
  exit 1
fi

pnpm dev
