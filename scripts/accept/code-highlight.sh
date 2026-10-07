#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init code-highlight
SCRIPT="$ROOT/scripts/accept/code-highlight.mjs"
BAKE="$ROOT/src/cli.js"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

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

BLOG="$WORK/typo"
cp -R "$ROOT/examples/minimal" "$BLOG"
printf -- '---\ntitle: 拼写错误\nslug: typo\n---\n\n段落\n\n```pyhton\nprint(1)\n```\n' > "$BLOG/content/typo.md"
note 4 "加入 content/typo.md：$(cat "$BLOG/content/typo.md")"
run_step 4 sh -c "cd '$BLOG' && node '$BAKE' build"
if [ "$LAST_STATUS" -eq 1 ] && printf '%s\n' "$LAST_OUTPUT" | grep -qx 'content/typo.md:8:1 Unknown code language pyhton' && [ ! -e "$BLOG/dist" ]; then
  record 4 '加入未知语言名的文章后 bake build' 通过 '输出 content/typo.md:8:1 Unknown code language pyhton 和汇总行，退出码 1，没有写出 dist/'
else
  record 4 '加入未知语言名的文章后 bake build' 失败 "退出码 $LAST_STATUS，输出见 4.txt"
fi

write_summary
