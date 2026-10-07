#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init sidenotes
SCRIPT="$ROOT/scripts/accept/sidenotes.mjs"
BLOG=$(mktemp -d)
cp -R "$ROOT/examples/minimal/." "$BLOG"
LOG="$RESULTS_DIR/dev.log"
CONSOLE_OK=1

console_check() {
  if printf '%s\n' "$LAST_OUTPUT" | grep -q -e '^console ' -e '^pageerror: '; then CONSOLE_OK=0; fi
}

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
run_step 2 node "$SCRIPT" layout "$ORIGIN" "$BLOG" "$RESULTS_DIR/layout"
console_check
if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 '1440px 下阅读模式与编辑模式的旁注和边注位置' 通过 '两种模式下每条注释的编号、右侧栏中的横向位置和相对编号所在行的纵向位置相同（差值不超过 1px）；位置记录在 2.txt，截图在 accept-results/sidenotes/layout/'
else
  record 2 '1440px 下阅读模式与编辑模式的旁注和边注位置' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

run_step 3 env BAKE_TEST_OUTPUT="$RESULTS_DIR/scenes" node --test "$ROOT/test/editor/sidenotes.test.js"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '逐个执行插入、输入、删除、撤销、复制、按键场景' 通过 "每一步的截图、文件 diff 和 bake format 的输出在 accept-results/sidenotes/scenes/sidenotes/"
else
  record 3 '逐个执行插入、输入、删除、撤销、复制、按键场景' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$SCRIPT" renumber "$ORIGIN" "$BLOG" "$RESULTS_DIR/renumber"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '在第一条旁注之前插入一条旁注' 通过 '后面的编号全部加 1，右侧栏重新对齐；截图在 accept-results/sidenotes/renumber/'
else
  record 4 '在第一条旁注之前插入一条旁注' 失败 "退出码 $LAST_STATUS，问题见 4.txt"
fi

if [ -f "$RESULTS_DIR/scenes/sidenotes/hover-note.png" ] && [ -f "$RESULTS_DIR/scenes/sidenotes/hover-reference.png" ]; then
  note 5 '截图由场景 3 的测试「悬停」生成：hover-note.png（鼠标在 :span 旁注上，高亮范围文字等于方括号里的文字）、hover-reference.png（鼠标在编号上，对应注释有 active class）。'
  record 5 '悬停 :span 旁注和编号' 通过 '截图在 accept-results/sidenotes/scenes/sidenotes/hover-note.png 和 hover-reference.png'
else
  note 5 '场景 3 没有生成悬停截图。'
  record 5 '悬停 :span 旁注和编号' 失败 '没有截图，见场景 3'
fi

run_step 6 node "$SCRIPT" narrow "$ORIGIN" "$BLOG" "$RESULTS_DIR/narrow"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 6 '1100px、1099px 和 375px 下打开编辑器' 通过 '1100px 有右侧栏；1099px 和 375px 下注释显示在所在块之后；三种宽度都没有横向滚动条；截图在 accept-results/sidenotes/narrow/'
else
  record 6 '1100px、1099px 和 375px 下打开编辑器' 失败 "退出码 $LAST_STATUS，问题见 6.txt"
fi

note 7 '场景 2、4、6 的脚本记录浏览器控制台的 error、warning 和页面异常；场景 3 的测试在结束时断言没有这些消息。'
if [ "$CONSOLE_OK" -eq 1 ]; then
  record 7 '控制台没有错误' 通过 '场景 2、3、4、6 都没有控制台错误或页面异常'
else
  record 7 '控制台没有错误' 失败 '有控制台错误，见场景 2、3、4、6 的输出'
fi

write_summary
