#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init code-highlight
SCRIPT="$ROOT/scripts/accept/code-highlight.mjs"

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

run_step 2 node "$SCRIPT" full "$RESULTS_DIR/full"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 2 '用 renderPage 渲染 Python、JavaScript、Bash、JSON 和没有语言名的代码块' 通过 '四个代码块高亮，def 的颜色等于主题的 --code-token-keyword，截图 accept-results/code-highlight/full/code.png 需要人工查看'
else
  record 2 '用 renderPage 渲染 Python、JavaScript、Bash、JSON 和没有语言名的代码块' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

run_step 3 node "$SCRIPT" fallback "$RESULTS_DIR/fallback"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '去掉主题中的代码变量后再次渲染' 通过 'def 的颜色回退到 --color-accent，截图 accept-results/code-highlight/fallback/code.png 需要人工查看'
else
  record 3 '去掉主题中的代码变量后再次渲染' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$SCRIPT" unknown
if [ "$LAST_STATUS" -eq 1 ] && printf '%s\n' "$LAST_OUTPUT" | grep -qx 'content/typo.md:9:1 Unknown code language pyhton'; then
  record 4 '未知语言名报错' 通过 'render 的 messages 有一条错误 content/typo.md:9:1 Unknown code language pyhton，脚本以 1 退出；bake build 的场景在构建 Task 的 PR 合并后执行'
else
  record 4 '未知语言名报错' 失败 "退出码 $LAST_STATUS，输出见 4.txt"
fi

write_summary
