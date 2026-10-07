#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init editor-core
EDITOR="$ROOT/scripts/accept/editor-core.mjs"
BLOG=$(mktemp -d)
cp -R "$ROOT/examples/minimal/." "$BLOG"
LOG="$RESULTS_DIR/dev.log"

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

(cd "$BLOG" && exec node "$ROOT/src/cli.js" dev) > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null; rm -rf "$BLOG"' EXIT
for _ in $(seq 50); do
  if grep -q '^Local: ' "$LOG"; then break; fi
  sleep 0.2
done
ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$LOG")
note 2 "\$ cd <examples/minimal 的副本> && node src/cli.js dev"
note 2 "$(cat "$LOG")"
run_step 2 node "$EDITOR" layout "$ORIGIN" "$BLOG" "$RESULTS_DIR/layout"
if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 'features.md 阅读模式与编辑模式的排版对比' 通过 "两种模式下共有的块尺寸相同，截图在 accept-results/editor-core/layout/"
else
  record 2 'features.md 阅读模式与编辑模式的排版对比' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

run_step 3 env BAKE_TEST_OUTPUT="$RESULTS_DIR/scenes" node --test "$ROOT/test/editor/editing.test.js"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '逐个执行编辑场景，截图并记录文件的 diff' 通过 "每个场景的截图和 diff 在 accept-results/editor-core/scenes/editing/"
else
  record 3 '逐个执行编辑场景，截图并记录文件的 diff' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$EDITOR" conflict "$ORIGIN" "$BLOG" "$RESULTS_DIR/conflict"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '有未保存修改时在外部修改文件（冲突）' 通过 '状态栏显示冲突和两个按钮，保留我的修改后文件只含编辑器的内容；录屏在 accept-results/editor-core/conflict/'
else
  record 4 '有未保存修改时在外部修改文件（冲突）' 失败 "退出码 $LAST_STATUS，问题见 4.txt"
fi

run_step 5 node "$EDITOR" reload "$ORIGIN" "$BLOG" "$RESULTS_DIR/reload"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 5 '没有未保存修改时在外部修改文件（重新载入）' 通过 '编辑器显示外部修改，光标仍在原来的块；录屏在 accept-results/editor-core/reload/'
else
  record 5 '没有未保存修改时在外部修改文件（重新载入）' 失败 "退出码 $LAST_STATUS，问题见 5.txt"
fi

run_step 6 node "$EDITOR" structure "$ORIGIN" "$BLOG" "$RESULTS_DIR/structure"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 6 '打开有结构错误的文章' 通过 '编辑器没有打开，状态栏显示「文章有结构错误，修正后才能编辑」；截图在 accept-results/editor-core/structure/'
else
  record 6 '打开有结构错误的文章' 失败 "退出码 $LAST_STATUS，问题见 6.txt"
fi

write_summary
