#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v shellcheck >/dev/null 2>&1; then
  git ls-files -z '*.sh' | xargs -0 -r shellcheck
else
  echo "shellcheck not found, shell scripts were not linted"
fi
