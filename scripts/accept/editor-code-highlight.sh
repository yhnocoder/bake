#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init editor-code-highlight
SCRIPT="$ROOT/scripts/accept/editor-code-highlight.mjs"
BLOG=$(mktemp -d)
cp -R "$ROOT/examples/minimal/." "$BLOG"
LOG="$RESULTS_DIR/dev.log"
CONSOLE_PROBLEMS=0

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

node "$SCRIPT" prepare "" "$BLOG" ""
(cd "$BLOG" && exec node "$ROOT/src/cli.js" dev) > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null; rm -rf "$BLOG"' EXIT
for _ in $(seq 50); do
  if grep -q '^Local: ' "$LOG"; then break; fi
  sleep 0.2
done
ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$LOG")

scene() {
  mkdir -p "$RESULTS_DIR/$2"
  run_step "$1" node "$SCRIPT" "$2" "$ORIGIN" "$BLOG" "$RESULTS_DIR/$2"
  count=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^console errors and warnings: //p')
  CONSOLE_PROBLEMS=$((CONSOLE_PROBLEMS + ${count:-1}))
}

note 2 "\$ cd <examples/minimal 的副本，加入 content/code.md> && node src/cli.js dev"
note 2 "$(cat "$LOG")"
scene 2 colors
if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 'code.md 阅读模式与编辑模式的颜色对比' 通过 '两种模式下每个代码块的 span 文字和样式列表相同，截图在 accept-results/editor-code-highlight/colors/'
else
  record 2 'code.md 阅读模式与编辑模式的颜色对比' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

scene 3 requests
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '打开编辑器后的网络请求' 通过 'code.md 只请求 Shiki 的模块和五种语言的文件；paper.md 没有请求代码高亮相关的文件，列表见 3.txt'
else
  record 3 '打开编辑器后的网络请求' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

scene 4 timing
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '40 行与 200 行代码块和普通段落中输入的耗时' 通过 "$(printf '%s\n' "$LAST_OUTPUT" | grep 'transactions' | tr '\n' ' ')"
else
  record 4 '40 行与 200 行代码块和普通段落中输入的耗时' 失败 "退出码 $LAST_STATUS，问题见 4.txt"
fi

scene 5 unknownLanguage
if [ "$LAST_STATUS" -eq 0 ]; then
  record 5 '未知语言名的提示' 通过 '语言名有波浪下划线和 title「未知的语言名，构建时会报错」；无头 Chromium 的截图不包含浏览器原生的 title 提示框，提示文字见 5.txt；截图在 accept-results/editor-code-highlight/unknownLanguage/'
else
  record 5 '未知语言名的提示' 失败 "退出码 $LAST_STATUS，问题见 5.txt"
fi

scene 6 fallback
if [ "$LAST_STATUS" -eq 0 ]; then
  record 6 '删除主题中的代码变量后的回退颜色' 通过 '阅读模式与编辑模式中 def 的颜色都等于 --color-accent，截图在 accept-results/editor-code-highlight/fallback/'
else
  record 6 '删除主题中的代码变量后的回退颜色' 失败 "退出码 $LAST_STATUS，问题见 6.txt"
fi

note 7 "场景 2 到 6 中浏览器控制台的错误和警告数量之和：$CONSOLE_PROBLEMS"
if [ "$CONSOLE_PROBLEMS" -eq 0 ]; then
  record 7 '控制台没有错误' 通过 '场景 2 到 6 中没有控制台错误或警告'
else
  record 7 '控制台没有错误' 失败 "共 $CONSOLE_PROBLEMS 条，见场景 2 到 6 的输出"
fi

write_summary
