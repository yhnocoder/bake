#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init insert-menu
SCENES="$ROOT/scripts/accept/insert-menu.mjs"
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

(cd "$BLOG" && exec node "$ROOT/src/cli.js" dev) > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null || true; rm -rf "$BLOG"' EXIT
for _ in $(seq 50); do
  if grep -q '^Local: ' "$LOG"; then break; fi
  sleep 0.2
done
ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$LOG")
note 2 "\$ cd <examples/minimal 的副本> && node src/cli.js dev"
note 2 "$(cat "$LOG")"

scene() {
  number=$1
  name=$2
  content=$3
  success=$4
  run_step "$number" node "$SCENES" "$name" "$ORIGIN" "$BLOG" "$RESULTS_DIR/$name"
  if printf '%s\n' "$LAST_OUTPUT" | grep -q '^console \|^pageerror: '; then CONSOLE_PROBLEMS=1; fi
  if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
    record "$number" "$content" 通过 "$success"
  else
    record "$number" "$content" 失败 "退出码 $LAST_STATUS，问题见 $number.txt"
  fi
}

scene 2 menu '打开 features.md 进入编辑，在文末的空行输入 / 和 /cal' '菜单列出块和组件，/cal 只剩提示框；截图在 accept-results/insert-menu/menu/'
scene 3 insert '用插入菜单依次插入内置块、表格和 demo-plot' '每一步只增加插入的几行，导语、副标题、出处、卡片在 positions.md 中各自允许的位置插入；截图和 diff 在 accept-results/insert-menu/insert/'
scene 4 slider '拖动 demo-plot 的滑块' '拖动中没有保存，松开后保存一次；录屏、截图和 diff 在 accept-results/insert-menu/slider/'
scene 5 blocks '修改提示框的 kind、卡片的 span、标题的 id、图片的 float' 'span 输入 5x1 时显示错误说明，其他修改各自只改变一行；截图和 diff 在 accept-results/insert-menu/blocks/'
scene 6 page '标题区输入标题，页面属性中修改 title、toc、layout 和 slug' '每一步只改变对应的 frontmatter 行，页面外框随之更新，修改 slug 后地址变为 /all-features/；截图和 diff 在 accept-results/insert-menu/page/'

kill "$DEV_PID" 2>/dev/null || true
run_step 7 sh -c "cd '$BLOG' && node '$ROOT/src/cli.js' format"
if [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_OUTPUT" = 'No files to rewrite' ]; then
  record 7 '对修改后的博客运行 bake format' 通过 '输出 No files to rewrite，退出码 0'
else
  record 7 '对修改后的博客运行 bake format' 失败 "退出码 $LAST_STATUS，输出见 7.txt"
fi

note 8 '场景 2 到 6 的浏览器控制台错误、警告和页面异常由 insert-menu.mjs 收集，出现时以 console 或 pageerror: 开头写在各场景的输出中。'
if [ "$CONSOLE_PROBLEMS" -eq 0 ]; then
  record 8 '控制台没有错误' 通过 '场景 2 到 6 没有控制台错误、警告或页面异常'
else
  record 8 '控制台没有错误' 失败 '见场景 2 到 6 的输出'
fi

write_summary
