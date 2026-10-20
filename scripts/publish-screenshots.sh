#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -ne 3 ]; then
  echo "Usage: scripts/publish-screenshots.sh <report dir> <pull request number> <commit>" >&2
  exit 2
fi
report=$1
folder=pr/$2
target=$folder/$3
branch=ci-screenshots

index=$(mktemp)
stage=$(mktemp -d)
trap 'rm -rf "$index" "$stage"' EXIT
mkdir -p "$stage/$(dirname "$target")"
cp -r "$report" "$stage/$target"

for attempt in 1 2 3 4 5; do
  if git fetch --quiet --depth 1 origin "$branch" 2>/dev/null; then old=$(git rev-parse FETCH_HEAD); else old=; fi
  rm -f "$index"
  if [ -n "$old" ]; then GIT_INDEX_FILE=$index git read-tree "$old"; else GIT_INDEX_FILE=$index git read-tree --empty; fi
  GIT_INDEX_FILE=$index git rm -r --quiet --cached --ignore-unmatch -- "$folder"
  if [ -n "$old" ]; then
    git ls-tree -r -d --name-only "$old" pr/ | while read -r path; do
      if [[ $path =~ ^pr/[^/]+/[^/]+/full$ ]]; then GIT_INDEX_FILE=$index git rm -r --quiet --cached -- "$path"; fi
    done
  fi
  GIT_INDEX_FILE=$index git --work-tree="$stage" add --force --all -- "$target"
  tree=$(GIT_INDEX_FILE=$index git write-tree)
  commit=$(git commit-tree "$tree" -m "Screenshots for $target")
  if git push --quiet --force-with-lease="$branch:$old" origin "$commit:refs/heads/$branch"; then
    echo "Published $report to $branch:$target"
    exit 0
  fi
  sleep $((2 ** attempt))
done
echo "Could not push $branch after 5 attempts" >&2
exit 1
