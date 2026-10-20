#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
scripts/lint.sh
npm test
