#!/bin/sh
# Run TypeScript type-check and ESLint on staged JS/TS files before commit.
# Install: pnpm install-hooks

set -e
cd "$(git rev-parse --show-toplevel)"
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.test.json --noEmit
pnpm exec eslint src tests scripts src-tauri/build-sidecar.js --max-warnings=0
