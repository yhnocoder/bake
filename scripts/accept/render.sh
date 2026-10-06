#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init render
BROWSER=${BROWSER:-chromium}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

PAGE="$RESULTS_DIR/page/features.html"
SCREENSHOT="$RESULTS_DIR/features.png"
mkdir -p "$RESULTS_DIR/page"
run_step 2 node "$ROOT/scripts/accept/render-page.mjs" "$ROOT/examples/minimal" content/features.md "$PAGE"
render_status=$LAST_STATUS
run_step 2 uv run "$ROOT/scripts/accept/screenshot.py" "$PAGE" "$SCREENSHOT" --browser "$BROWSER"
screenshot_status=$LAST_STATUS
screenshot_output=$LAST_OUTPUT
if [ "$render_status" -eq 0 ] && [ -s "$SCREENSHOT" ]; then
  record 2 '渲染 features.md 并在 1440px 宽度下截取整页截图' 通过 "截图 accept-results/render/features.png"
else
  record 2 '渲染 features.md 并在 1440px 宽度下截取整页截图' 失败 "渲染退出码 $render_status"
fi

formulas=$(printf '%s\n' "$screenshot_output" | sed -n 's/^\([0-9]*\) formulas$/\1/p')
if [ "$screenshot_status" -eq 0 ]; then
  record 3 '每个公式显示为 SVG，没有 TeX 源码、错误提示和控制台错误' 通过 "$formulas 个公式，全部是 SVG，字形全部能找到，控制台没有错误；截图需要人工查看"
else
  record 3 '每个公式显示为 SVG，没有 TeX 源码、错误提示和控制台错误' 失败 "检查脚本退出码 $screenshot_status，问题见 3.txt"
  note 3 "$screenshot_output"
fi

cp -R "$ROOT/examples/minimal" "$WORK/blog"
cat > "$WORK/blog/content/broken.md" <<'MD'
---
title: 含错误的文章
---

## 链式法则 {#chain-rule}

梯度见式 $\eqref{eq:grad}$。

## 链式法则的推广 {#chain-rule}

公式 $\frac{a$ 没有闭合。
MD
run_step 4 node "$ROOT/scripts/accept/render-page.mjs" "$WORK/blog" content/broken.md
expected=$(printf '%s\n' \
  'content/broken.md:7:6 \eqref target eq:grad is not defined' \
  'content/broken.md:9:1 Duplicate id chain-rule' \
  'content/broken.md:11:4 Invalid TeX: Missing close brace')
if [ "$LAST_STATUS" -eq 1 ] && [ "$LAST_OUTPUT" = "$expected" ]; then
  record 4 '\eqref 指向不存在的标签、重复 id、TeX 语法错误' 通过 '输出三条带行列的英文错误，退出码 1'
else
  record 4 '\eqref 指向不存在的标签、重复 id、TeX 语法错误' 失败 "退出码 $LAST_STATUS"
fi

write_summary
