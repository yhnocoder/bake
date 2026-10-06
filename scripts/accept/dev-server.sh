#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init dev-server
DEV="$ROOT/scripts/accept/dev-server.mjs"
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
run_step 2 node "$DEV" pages "$ORIGIN" "$BLOG" "$RESULTS_DIR/pages"
if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 'bake dev 的启动输出，三篇文章的截图' 通过 "启动输出 $(head -n 1 "$LOG")，截图在 accept-results/dev-server/pages/"
else
  record 2 'bake dev 的启动输出，三篇文章的截图' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi

run_step 3 node "$DEV" markdown "$ORIGIN" "$BLOG" "$RESULTS_DIR/markdown"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '在编辑器之外修改 features.md 的一段文字' 通过 '页面就地更新，标记变量仍在，滚动位置不变；录屏和前后截图在 accept-results/dev-server/markdown/'
else
  record 3 '在编辑器之外修改 features.md 的一段文字' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$DEV" component "$ORIGIN" "$BLOG" "$RESULTS_DIR/component"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '修改 components/demo-plot.js 的颜色' 通过 '组件换成红色路径，属性不变，标记变量仍在；前后截图在 accept-results/dev-server/component/'
else
  record 4 '修改 components/demo-plot.js 的颜色' 失败 "退出码 $LAST_STATUS，问题见 4.txt"
fi

request() {
  printf '$ curl %s\n' "$*" >> "$RESULTS_DIR/5.txt"
  curl -sS -w '\n[HTTP %{http_code}]\n\n' "$@" >> "$RESULTS_DIR/5.txt"
}
json() {
  request -X POST -H 'content-type: application/json' --data "$2" "$ORIGIN$1"
}
SOURCE=$(curl -sS "$ORIGIN/__bake/source?page=/paper/")
HASH=$(printf '%s' "$SOURCE" | node -e 'process.stdin.on("data", (d) => process.stdout.write(JSON.parse(d).hash))')
MARKDOWN=$(printf '%s' "$SOURCE" | node -e 'process.stdin.on("data", (d) => process.stdout.write(JSON.stringify(JSON.parse(d).markdown.replace("沿负梯度方向移动", "沿负梯度方向前进"))))')
request "$ORIGIN/__bake/source?page=/paper/"
json /__bake/save "{\"page\":\"/paper/\",\"markdown\":$MARKDOWN,\"hash\":\"$HASH\"}"
json /__bake/save "{\"page\":\"/paper/\",\"markdown\":$MARKDOWN,\"hash\":\"$HASH\"}"
json /__bake/save "{\"page\":\"/../../outside/\",\"markdown\":\"x\",\"hash\":\"$HASH\"}"
json /__bake/asset '{"page":"/features/","data":"PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=","ext":"svg"}'
json /__bake/asset '{"page":"/features/","data":"AAAA","ext":"js"}'
json /__bake/asset '{"page":"/../","data":"AAAA","ext":"png"}'
codes=$(sed -n 's/^\[HTTP \([0-9]*\)\]$/\1/p' "$RESULTS_DIR/5.txt" | tr '\n' ' ')
if [ "$codes" = '200 200 409 403 200 400 403 ' ]; then
  record 5 '用 curl 调用三个接口，包括 409 和 403' 通过 "状态码依次为 $codes，请求和返回见 5.txt"
else
  record 5 '用 curl 调用三个接口，包括 409 和 403' 失败 "状态码依次为 $codes，请求和返回见 5.txt"
fi

write_summary
