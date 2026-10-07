#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init site-followup
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

MINIMAL="$WORK/minimal"
cp -R "$ROOT/examples/minimal" "$MINIMAL"
DIST="$RESULTS_DIR/dist"
run_step 2 sh -c "cd '$MINIMAL' && node '$BAKE' build --out '$DIST'"
build_status=$LAST_STATUS
run_step 2 sh -c "grep -o '<svg id=\"math-defs\" style=\"display:none\"><defs>' '$DIST/features/index.html' | head -1; grep -o '<span class=\"sidenote-number\">[0-9]*</span><div class=\"sidenote-body\">' '$DIST/features/index.html'"
run_step 2 sh -c "ls -A '$MINIMAL'"
if [ "$build_status" -eq 0 ] && grep -q 'id="math-defs"' "$DIST/features/index.html" && grep -q 'class="sidenote-body"' "$DIST/features/index.html" && [ ! -e "$MINIMAL/.vite" ]; then
  record 2 '对 examples/minimal 运行 bake build' 通过 '构建成功；页面有 #math-defs 和 div.sidenote-body；博客目录中没有留下 .vite/'
else
  record 2 '对 examples/minimal 运行 bake build' 失败 "退出码 $build_status，见 2.txt"
fi

run_step 3 node "$ROOT/scripts/accept/site-followup.mjs" "$DIST" "$RESULTS_DIR/screenshots"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '含旁注的页面在 1440px 和 900px 下截图' 通过 '每条注释的结构正确，公式引用的字形都在 #math-defs 中，没有控制台错误，截图在 screenshots/'
else
  record 3 '含旁注的页面在 1440px 和 900px 下截图' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$ROOT/scripts/accept/site-followup-layout.mjs" "$ROOT/examples/minimal"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '不合格的版式由 renderPage 报错' 通过 '三种不合格的版式各报一条错误且不输出页面，内置 essay 正常输出'
else
  record 4 '不合格的版式由 renderPage 报错' 失败 "退出码 $LAST_STATUS，见 4.txt"
fi

write_summary
