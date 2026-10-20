#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ $# -gt 1 ]; then
  echo "Usage: scripts/screenshots.sh [base ref]" >&2
  exit 2
fi
base_ref=${1:-}
out=test-out/screenshots

rm -rf "$out"
git worktree prune
mkdir -p "$out"

(cd examples/blog && node ../../src/cli.js build)
node scripts/capture-pages.js examples/blog/dist "$out/head"

if [ -n "$base_ref" ]; then
  base_commit=$(git rev-parse --verify "$base_ref^{commit}")
  scratch=$(mktemp -d)
  tree=$scratch/base
  trap 'git worktree remove --force "$tree" 2>/dev/null || true; rm -rf "$scratch"; git worktree prune' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  git worktree add --quiet --detach "$tree" "$base_commit"
  if git diff --quiet "$base_commit" -- package-lock.json; then
    ln -s "$PWD/node_modules" "$tree/node_modules"
  else
    (cd "$tree" && npm ci --no-audit --no-fund)
  fi
  if (cd "$tree/examples/blog" && node ../../src/cli.js build); then
    node scripts/capture-pages.js "$tree/examples/blog/dist" "$out/base"
  else
    echo "The example blog at $base_ref did not build, so there are no base screenshots"
  fi
fi

node scripts/compare-screenshots.js "$out/base" "$out/head" "$out/report"
echo "Report: $out/report/summary.md"
