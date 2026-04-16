#!/bin/sh
# Install git hooks from scripts/. Run once after cloning.
set -e
if [ -d .git ]; then
  cp scripts/pre-commit.sh .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  echo "Installed .git/hooks/pre-commit"
fi
