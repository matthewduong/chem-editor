#!/bin/sh
# Run TypeScript type-check and ESLint on staged JS/TS files before commit.
# Install: pnpm run prepare  (or run this once: sh scripts/install-hooks.sh)

set -e
cd "$(git rev-parse --show-toplevel)"
npx tsc --noEmit
npx eslint src --max-warnings=0
