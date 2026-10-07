#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init link-preview
SCENES="$ROOT/scripts/accept/link-preview.mjs"
BLOG=$(mktemp -d)
cp -R "$ROOT/examples/minimal/." "$BLOG"
LOG="$RESULTS_DIR/dev.log"
CONSOLE_PROBLEMS=0
DEV_PID=
trap 'if [ -n "$DEV_PID" ]; then kill "$DEV_PID" 2>/dev/null || true; fi; rm -rf "$BLOG"' EXIT

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

scene() {
  number=$1
  name=$2
  origin=$3
  content=$4
  success=$5
  run_step "$number" node "$SCENES" "$name" "$origin" "$BLOG" "$RESULTS_DIR/$name"
  if printf '%s\n' "$LAST_OUTPUT" | grep -q '^console \|^pageerror: '; then CONSOLE_PROBLEMS=1; fi
  if [ "$LAST_STATUS" -eq 0 ]; then
    record "$number" "$content" 通过 "$success"
  else
    record "$number" "$content" 失败 "退出码 $LAST_STATUS，问题见 $number.txt"
  fi
}

run_step 2 sh -c "cd '$BLOG' && node '$ROOT/src/cli.js' build"
BUILD_STATUS=$LAST_STATUS
if [ "$BUILD_STATUS" -eq 0 ]; then
  scene 2 kinds - '构建 examples/minimal，在 features.md 上悬停整篇文章、标题、段落、同页 #id 四类链接' '四类卡片内容正确，features 和 paper 的 sections.json 各请求一次；截图在 accept-results/link-preview/kinds/'
  scene 3 cross - '在 bento.md 上悬停 /features#math 和 /features#components' '字形加入 #math-defs，公式宽度大于 0，没有重复 id；悬停前没有请求组件脚本，悬停后请求一次并画出 SVG；截图在 accept-results/link-preview/cross/'
  scene 4 recording - '录屏：经过链接不足 300ms、停留、移入卡片、离开' '经过时没有卡片，停留后出现，移入卡片保持，离开后关闭；录屏 accept-results/link-preview/recording/hover.webm'
else
  for number in 2 3 4; do record "$number" '构建后的预览' 失败 "构建失败，退出码 $BUILD_STATUS，见 2.txt"; done
fi

(cd "$BLOG" && exec node "$ROOT/src/cli.js" dev) > "$LOG" 2>&1 &
DEV_PID=$!
for _ in $(seq 50); do
  if grep -q '^Local: ' "$LOG"; then break; fi
  sleep 0.2
done
ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$LOG")
note 5 "\$ cd <examples/minimal 的副本> && node src/cli.js dev"
note 5 "$(cat "$LOG")"

json() {
  run_step 5 curl -sS -w '\n[HTTP %{http_code}]' "$ORIGIN$1"
}

if [ -n "$ORIGIN" ]; then
  scene 5 dev "$ORIGIN" '对 examples/minimal 运行 bake dev，阅读模式和编辑模式各悬停一个链接，用 curl 调用两个接口' '两种模式都显示卡片，截图在 accept-results/link-preview/dev/'
  json /__bake/sections
  json '/__bake/preview?href=%2Fpaper%23step-size'
  json '/__bake/preview?href=%2Ffeatures%2F'
  json '/__bake/preview?href=%2Fmissing'
  json '/__bake/preview?href=%2Fpaper%23missing'
  codes=$(sed -n 's/^\[HTTP \([0-9]*\)\]$/\1/p' "$RESULTS_DIR/5.txt" | tr '\n' ' ')
  if [ "$codes" != '200 200 200 404 404 ' ]; then
    record 5 'curl 调用 /__bake/sections 和 /__bake/preview' 失败 "状态码依次为 $codes，见 5.txt"
  else
    note 5 "curl 的状态码依次为 $codes"
  fi
  scene 6 picker "$ORIGIN" '编辑模式下用 Mod-K 插入站内链接、同页链接和外部链接' '每一步只改变一行；截图和 diff 在 accept-results/link-preview/picker/'
else
  record 5 '对 examples/minimal 运行 bake dev' 失败 '开发服务器没有启动，见 dev.log'
  record 6 '编辑模式下用 Mod-K 插入链接' 失败 '开发服务器没有启动，见 dev.log'
fi
kill "$DEV_PID" 2>/dev/null || true

note 7 '场景 2 到 6 的浏览器控制台错误、警告和页面异常由 link-preview.mjs 收集，出现时以 console 或 pageerror: 开头写在各场景的输出中。'
if [ "$CONSOLE_PROBLEMS" -eq 0 ]; then
  record 7 '控制台没有错误' 通过 '场景 2 到 6 没有控制台错误、警告或页面异常'
else
  record 7 '控制台没有错误' 失败 '见场景 2 到 6 的输出'
fi

set +e
write_summary
STATUS=$?
set -e
{
  printf '\n## 截图与录屏\n\n'
  for image in "$RESULTS_DIR"/*/*.png; do
    relative=${image#"$RESULTS_DIR"/}
    printf '### %s\n\n![%s](%s)\n\n' "$relative" "$relative" "$relative"
  done
  printf '录屏：[recording/hover.webm](recording/hover.webm)\n'
} >> "$RESULTS_DIR/summary.md"
exit "$STATUS"
