#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init copy-paste
SCRIPT="$ROOT/scripts/accept/copy-paste.mjs"
BLOG=$(mktemp -d)
BUILD_BLOG=$(mktemp -d)
cp -R "$ROOT/examples/minimal/." "$BLOG"
cp -R "$ROOT/examples/minimal/." "$BUILD_BLOG"
printf '%s\n' "export default { title: 'bake minimal', theme: 'default', base: '/blog/', math: { macros: { R: '\\\\mathbb{R}' } } };" > "$BUILD_BLOG/bake.config.js"
LOG="$RESULTS_DIR/dev.log"
CONSOLE_OK=1

console_check() {
  if printf '%s\n' "$LAST_OUTPUT" | grep -q -e '^console ' -e '^pageerror: '; then CONSOLE_OK=0; fi
}

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS，失败的测试见 1.txt"
fi

(cd "$BLOG" && exec node "$ROOT/src/cli.js" dev) > "$LOG" 2>&1 &
DEV_PID=$!
trap 'kill "$DEV_PID" 2>/dev/null; rm -rf "$BLOG" "$BUILD_BLOG"' EXIT
for _ in $(seq 50); do
  if grep -q '^Local: ' "$LOG"; then break; fi
  sleep 0.2
done
ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$LOG")
note 2 "\$ cd <examples/minimal 的副本> && node src/cli.js dev"
note 2 "$(cat "$LOG")"
run_step 2 node "$SCRIPT" samples "$ORIGIN" "$BLOG" "$RESULTS_DIR/samples"
console_check
missing=$(tr '\n' ' ' < "$RESULTS_DIR/samples/missing.txt")
if [ -n "$ORIGIN" ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 '回放 AI 采集的网页剪贴板样本' 通过 '每个样本粘贴后的正文等于 .expected.md；剪贴板类型和文件 diff 见 2.txt，截图在 accept-results/copy-paste/samples/'
else
  record 2 '回放 AI 采集的网页剪贴板样本' 失败 "退出码 $LAST_STATUS，问题见 2.txt"
fi
record 2 '回放用户采集的桌面应用样本' 未执行 "样本尚未提交：$missing"

note 3 "\$ cd <examples/minimal 的副本，bake.config.js 加 base: '/blog/'> && node src/cli.js build"
run_step 3 sh -c "cd '$BUILD_BLOG' && node '$ROOT/src/cli.js' build"
if [ "$LAST_STATUS" -eq 0 ]; then
  run_step 3 node "$SCRIPT" page-copy "$BUILD_BLOG/dist" "$RESULTS_DIR/page-copy"
  console_check
fi
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '从构建后的页面复制全文和三个部分选区' 通过 '纯文本和 HTML 在 accept-results/copy-paste/page-copy/，HTML 都以 data-bake-markdown 标记开头'
else
  record 3 '从构建后的页面复制全文和三个部分选区' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

run_step 4 node "$SCRIPT" page-paste "$BUILD_BLOG/dist" "$ORIGIN" "$BLOG" "$RESULTS_DIR/page-paste"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '把复制的全文粘贴进空文章' 通过 'HTML 块按渲染后的 DOM 比较、站内链接按构建输出的带末尾 / 的写法比较时，与 features.md 正文没有差异；原始 diff 和比较后的 diff 见 4.txt'
else
  record 4 '把复制的全文粘贴进空文章' 失败 "退出码 $LAST_STATUS，diff 见 4.txt"
fi

run_step 5 node "$SCRIPT" editor-copy "$ORIGIN" "$BLOG" "$RESULTS_DIR/editor-copy"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 5 '编辑器中复制带旁注和公式的段落并粘贴' 通过 '剪贴板纯文本带旁注定义和公式；粘贴到「旁注」一节最后一段的末尾，同名旁注改用新名字，文件 diff 见 5.txt'
else
  record 5 '编辑器中复制带旁注和公式的段落并粘贴' 失败 "退出码 $LAST_STATUS，问题见 5.txt"
fi

run_step 6 node "$SCRIPT" image-twice "$ORIGIN" "$BLOG" "$RESULTS_DIR/image-twice"
console_check
if [ "$LAST_STATUS" -eq 0 ]; then
  record 6 '同一张截图粘贴两次' 通过 'assets/ 只多一个文件，文章引用它两次；文件列表和 diff 见 6.txt'
else
  record 6 '同一张截图粘贴两次' 失败 "退出码 $LAST_STATUS，问题见 6.txt"
fi

run_step 7 node "$SCRIPT" size "$BUILD_BLOG/dist" 16384
if [ "$LAST_STATUS" -eq 0 ]; then
  record 7 'copy-markdown.js 的大小' 通过 "$(printf '%s\n' "$LAST_OUTPUT" | head -n 1)"
else
  record 7 'copy-markdown.js 的大小' 失败 "$(printf '%s\n' "$LAST_OUTPUT" | head -n 1)"
fi

note 8 '场景 2 到 6 的脚本记录浏览器控制台的 error、warning 和页面异常。'
if [ "$CONSOLE_OK" -eq 1 ]; then
  record 8 '控制台没有错误' 通过 '场景 2 到 6 都没有控制台错误或页面异常'
else
  record 8 '控制台没有错误' 失败 '有控制台错误，见场景 2 到 6 的输出'
fi

write_summary
