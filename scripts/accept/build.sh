#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init build
BAKE="$ROOT/src/cli.js"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

bake_in() {
  directory=$1
  shift
  (cd "$directory" && node "$BAKE" "$@")
}

snapshot() {
  (cd "$1" && find . -type f | sort | xargs sha256sum)
}

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
run_step 2 bake_in "$MINIMAL" build --out "$DIST"
build_status=$LAST_STATUS
run_step 2 find "$DIST" -type f
if [ "$build_status" -eq 0 ] && [ -f "$DIST/site.json" ]; then
  record 2 '对 examples/minimal 运行 bake build' 通过 "$(printf '%s\n' "$LAST_OUTPUT" | wc -l | tr -d ' ') 个文件，输出和文件列表见 2.txt"
else
  record 2 '对 examples/minimal 运行 bake build' 失败 "退出码 $build_status，见 2.txt"
fi

run_step 3 node "$ROOT/scripts/accept/build.mjs" "$DIST" "$RESULTS_DIR/screenshots"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 '静态服务器提供输出目录，每页在 1440px 和 375px 下截图' 通过 '没有控制台错误和 404，截图在 accept-results/build/screenshots/，版面需要人工查看'
else
  record 3 '静态服务器提供输出目录，每页在 1440px 和 375px 下截图' 失败 "退出码 $LAST_STATUS，问题见 3.txt"
fi

BROKEN="$WORK/broken"
cp -R "$ROOT/examples/minimal" "$BROKEN"
run_step 4 bake_in "$BROKEN" build
snapshot "$BROKEN/dist" > "$WORK/before.txt"
printf -- '---\ntitle: 断开的链接\nslug: broken\n---\n\n见[不存在的页面](/missing)和[不存在的标题](/features#missing)。\n' > "$BROKEN/content/broken.md"
note 4 "加入 content/broken.md：$(cat "$BROKEN/content/broken.md")"
run_step 4 bake_in "$BROKEN" build
broken_status=$LAST_STATUS
snapshot "$BROKEN/dist" > "$WORK/after.txt"
if [ "$broken_status" -eq 1 ] && cmp -s "$WORK/before.txt" "$WORK/after.txt" && printf '%s\n' "$LAST_OUTPUT" | grep -q '^2 errors, dist/ was not written$'; then
  note 4 '输出目录中每个文件的 SHA-256 在第二次构建前后相同。'
  record 4 '加入断开链接的文章后 bake build' 通过 '输出两行错误和汇总行，退出码 1，dist/ 的文件和内容不变'
else
  record 4 '加入断开链接的文章后 bake build' 失败 "退出码 $broken_status，见 4.txt"
fi

EMPTY="$WORK/empty"
mkdir -p "$EMPTY/themes"
printf "export default { title: 'Hello', theme: 'plain' };\n" > "$EMPTY/bake.config.js"
printf ':root {\n  --color-text: #222;\n  --color-bg: #fff;\n}\n' > "$EMPTY/themes/plain.css"
run_step 5 bake_in "$EMPTY" new hello/world
new_status=$LAST_STATUS
run_step 5 cat "$EMPTY/content/hello/world.md"
run_step 5 bake_in "$EMPTY" build
build_status=$LAST_STATUS
run_step 5 find "$EMPTY/dist" -type f
if [ "$new_status" -eq 0 ] && [ "$build_status" -eq 0 ] && [ -f "$EMPTY/dist/hello/world/index.html" ]; then
  record 5 '空目录中 bake new hello/world 后 bake build' 通过 '两个命令退出码 0，生成 dist/hello/world/index.html'
else
  record 5 '空目录中 bake new hello/world 后 bake build' 失败 "bake new 退出码 $new_status，bake build 退出码 $build_status，见 5.txt"
fi

write_summary
