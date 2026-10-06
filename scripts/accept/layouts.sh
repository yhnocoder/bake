#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init layouts
LAYOUTS="$ROOT/scripts/accept/layouts.mjs"

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

run_step 2 node "$LAYOUTS" screenshots "$RESULTS_DIR/screenshots"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 2 '三篇文章在 1440px、1100px、600px、375px 下的整页截图' 通过 '12 张截图在 accept-results/layouts/screenshots/，版面需要人工查看'
else
  record 2 '三篇文章在 1440px、1100px、600px、375px 下的整页截图' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

run_step 3 node "$LAYOUTS" hover "$RESULTS_DIR/hover"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '1440px 下悬停 features.md 的每个旁注' 通过 '每个旁注都有高亮范围，截图在 accept-results/layouts/hover/，高亮范围和注释位置见 3.txt'
else
  record 3 '1440px 下悬停 features.md 的每个旁注' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$LAYOUTS" overflow
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '375px 下页面没有横向滚动条' 通过 '三篇文章的 scrollWidth 都不大于 clientWidth'
else
  record 4 '375px 下页面没有横向滚动条' 失败 "退出码 $LAST_STATUS，问题见 4.txt"
fi

run_step 5 node "$LAYOUTS" console
if [ "$LAST_STATUS" -eq 0 ]; then
  record 5 '控制台没有错误' 通过 '三篇文章在四种宽度下没有控制台错误、页面错误和失败的请求'
else
  record 5 '控制台没有错误' 失败 "退出码 $LAST_STATUS，问题见 5.txt"
fi

write_summary
