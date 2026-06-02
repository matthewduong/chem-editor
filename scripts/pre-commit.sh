#!/bin/sh
# Run TypeScript type-check and ESLint on staged JS/TS files before commit.
# Install: pnpm install-hooks

set -e
cd "$(git rev-parse --show-toplevel)"
npx tsc --noEmit
npx eslint src --max-warnings=0
