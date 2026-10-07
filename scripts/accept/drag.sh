#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init drag
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
run_step 2 node "$ROOT/scripts/accept/drag.mjs" "$ORIGIN" "$BLOG" "$RESULTS_DIR/steps"
STEPS_STATUS=$LAST_STATUS
if [ -n "$ORIGIN" ] && [ "$STEPS_STATUS" -eq 0 ]; then
  record 2 '在 bake dev 中依次执行拖动、旁注、块菜单、键盘四组操作' 通过 '每一步的截图和文件 diff 在 accept-results/drag/steps/，录屏是 steps/session.webm，拖动中的截图以 -dragging.png 结尾；控制台没有错误'
else
  record 2 '在 bake dev 中依次执行拖动、旁注、块菜单、键盘四组操作' 失败 "退出码 $STEPS_STATUS，问题见 2.txt"
fi

note 3 '场景 2 的脚本在每一步之后用 parse 校验文件，最后逐次按 Mod-Z，直到文件与 blocks.md 原文相同，并比较按键次数与操作对应的撤销步数。'
if [ "$STEPS_STATUS" -eq 0 ] && printf '%s\n' "$LAST_OUTPUT" | grep -q 'byte-for-byte equal'; then
  undo=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^undo: pressed Mod-Z \([0-9]*\) times.*/\1/p')
  record 3 '每一步 parse 没有错误；撤销全部操作后文件与原文逐字节相同' 通过 "每一步 parse 的结果为空；按 $undo 次 Mod-Z 后文件与 blocks.md 原文逐字节相同"
else
  record 3 '每一步 parse 没有错误；撤销全部操作后文件与原文逐字节相同' 失败 '见 2.txt'
fi

write_summary
