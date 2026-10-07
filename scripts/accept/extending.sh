#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init extending
BAKE="$ROOT/src/cli.js"
CHECK="$ROOT/scripts/accept/extending.mjs"
WORK=$(mktemp -d)
DEV_PID=
cleanup() {
  if [ -n "$DEV_PID" ]; then kill "$DEV_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

in_dir() {
  directory=$1
  shift
  (cd "$directory" && "$@")
}

bake_in() {
  directory=$1
  shift
  in_dir "$directory" node "$BAKE" "$@"
}

start_dev() {
  log=$2
  (cd "$1" && exec node "$3" dev) > "$log" 2>&1 &
  DEV_PID=$!
  for _ in $(seq 100); do
    if grep -q '^Local: ' "$log"; then break; fi
    sleep 0.2
  done
  DEV_ORIGIN=$(sed -n 's|^Local: \(http://localhost:[0-9]*\)/$|\1|p' "$log")
}

stop_dev() {
  kill "$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
  DEV_PID=
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
run_step 2 node "$CHECK" pages "$DIST" "$RESULTS_DIR/pages"
if [ "$build_status" -eq 0 ] && [ "$LAST_STATUS" -eq 0 ]; then
  record 2 'bake build 后打开首页和 extending 页面，1440px 和 375px 截图' 通过 '构建退出码 0，没有控制台错误和 404，截图在 accept-results/extending/pages/'
else
  record 2 'bake build 后打开首页和 extending 页面，1440px 和 375px 截图' 失败 "构建退出码 $build_status，检查退出码 $LAST_STATUS，见 2.txt"
fi

run_step 3 node "$CHECK" motion "$DIST" "$RESULTS_DIR/motion"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 3 'reducedMotion 为 reduce 时 wave-figure 的波形在终点' 通过 '减少动态效果时波形立即位于终点 -40px，默认时位于起点附近；截图在 accept-results/extending/motion/'
else
  record 3 'reducedMotion 为 reduce 时 wave-figure 的波形在终点' 失败 "退出码 $LAST_STATUS，见 3.txt"
fi

run_step 4 node "$CHECK" requests "$RESULTS_DIR/pages/requests.json"
if [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '首页和 extending 页面的网络请求' 通过 '只有首页请求 site.json（一次），只有 extending 页面请求 MathJax 的文件；请求列表见 4.txt'
else
  record 4 '首页和 extending 页面的网络请求' 失败 "退出码 $LAST_STATUS，见 4.txt"
fi

broken_case() {
  name=$1
  description=$2
  expected=$3
  directory="$WORK/broken-$name"
  rm -rf "$directory"
  cp -R "$ROOT/examples/minimal" "$directory"
  shift 3
  "$@"
  note 5 "错误：$description"
  run_step 5 bake_in "$directory" build
  if [ "$LAST_STATUS" -eq 1 ] && printf '%s\n' "$LAST_OUTPUT" | grep -qF "$expected" && [ ! -d "$directory/dist" ]; then
    printf '# %s\n$ bake build\n%s\n[exit code %s]\n\n' "$name" "$LAST_OUTPUT" "$LAST_STATUS" >> "$RESULTS_DIR/5-outputs.txt"
  else
    BROKEN_FAILED="$BROKEN_FAILED $name"
  fi
}

add_component_without_dash() {
  printf 'export default class extends HTMLElement {}\n' > "$directory/components/plot.js"
}
duplicate_topic_component() {
  cp "$directory/content/extending/components/wave-figure.js" "$directory/components/wave-figure.js"
}
add_builtin_block() {
  printf "export default { name: 'callout', form: 'container' };\n" > "$directory/blocks/callout.js"
}
add_common_field() {
  sed -i.orig "s|  series: { label: '系列', type: 'string' },|  series: { label: '系列', type: 'string' },\n  title: { label: '标题', type: 'string' },|" "$directory/layouts/note.js"
  rm "$directory/layouts/note.js.orig"
}
remove_theme_variable() {
  sed -i.orig '/--measure: 40rem;/d' "$directory/themes/warm.css"
  rm "$directory/themes/warm.css.orig"
}
use_component_in_other_topic() {
  mkdir -p "$directory/content/other"
  printf -- '---\ntitle: 另一个主题\nslug: other\n---\n\n::wave-figure\n' > "$directory/content/other/post.md"
}

BROKEN_FAILED=
: > "$RESULTS_DIR/5-outputs.txt"
broken_case name '组件文件名不含 -（components/plot.js）' 'components/plot.js:1:1 Component file name must' add_component_without_dash
broken_case duplicate '主题组件与全局组件重名（复制 wave-figure.js 到 components/）' 'Component wave-figure is also defined in' duplicate_topic_component
broken_case block '块类型与内置块类型重名（blocks/callout.js）' 'blocks/callout.js:1:1 Block type callout conflicts with a built-in block type' add_builtin_block
broken_case field '版式字段与通用字段同名（layouts/note.js 的 title）' 'layouts/note.js:1:1 Layout note field title conflicts with a common field' add_common_field
broken_case theme '主题缺少变量（themes/warm.css 删去 --measure）' 'themes/warm.css:1:1 Theme warm is missing variables --measure' remove_theme_variable
broken_case topic '另一个主题的文章使用 wave-figure（content/other/post.md）' 'content/other/post.md:6:1 Component ::wave-figure belongs to topic extending, move it to components/ to use it in other topics' use_component_in_other_topic
node "$CHECK" terminal "$RESULTS_DIR/5-outputs.txt" "$RESULTS_DIR/build-errors.png" > /dev/null
if [ -z "$BROKEN_FAILED" ]; then
  record 5 '依次加入 6 种扩展错误后 bake build' 通过 '每次输出对应的错误和汇总行，退出码 1，没有写入 dist/；输出见 5.txt，终端输出的截图是 build-errors.png'
else
  record 5 '依次加入 6 种扩展错误后 bake build' 失败 "未通过的场景：$BROKEN_FAILED，见 5.txt"
fi

DEV_BLOG="$WORK/dev"
cp -R "$ROOT/examples/minimal" "$DEV_BLOG"
start_dev "$DEV_BLOG" "$RESULTS_DIR/dev.log" "$BAKE"
note 6 "\$ cd <examples/minimal 的副本> && node src/cli.js dev"
run_step 6 node "$CHECK" dev "$DEV_ORIGIN" "$DEV_BLOG" "$RESULTS_DIR/dev"
dev_status=$LAST_STATUS
stop_dev
note 6 "bake dev 的终端输出：
$(cat "$RESULTS_DIR/dev.log")"
if [ -n "$DEV_ORIGIN" ] && [ "$dev_status" -eq 0 ]; then
  record 6 'bake dev 中修改 features.md 的 title，首页的 page-list 更新' 通过 'page-list 显示新标题，页面没有刷新；前后截图在 accept-results/extending/dev/'
else
  record 6 'bake dev 中修改 features.md 的 title，首页的 page-list 更新' 失败 "退出码 $dev_status，见 6.txt"
fi

PACKED="$WORK/packed"
mkdir -p "$PACKED/components" "$PACKED/content" "$PACKED/themes"
run_step 7 npm pack --silent --pack-destination "$WORK" "$ROOT"
TARBALL="$WORK/$(printf '%s\n' "$LAST_OUTPUT" | tail -n 1)"
printf '{ "name": "packed-blog", "private": true, "type": "module" }\n' > "$PACKED/package.json"
printf "export default { title: 'Packed', theme: 'plain' };\n" > "$PACKED/bake.config.js"
sed '1,2d' "$ROOT/examples/minimal/themes/warm.css" > "$PACKED/themes/plain.css"
printf -- '---\ntitle: 首页\nslug: /\n---\n\n::runtime-check\n' > "$PACKED/content/index.md"
cat > "$PACKED/components/runtime-check.js" <<'EOF'
import { layoutText, site } from 'bake/runtime';

export default class RuntimeCheck extends HTMLElement {
  connectedCallback() {
    const { lines } = layoutText({ text: 'bake/runtime 从 node_modules 中的 bake 解析', font: '16px sans-serif', width: 160, lineHeight: 20 });
    this.textContent = `${site.pages.length} pages, ${lines.length} lines`;
  }
}
EOF
note 7 "临时博客的组件 components/runtime-check.js：
$(cat "$PACKED/components/runtime-check.js")"
run_step 7 npm install --no-audit --no-fund --prefix "$PACKED" "$TARBALL"
install_status=$LAST_STATUS
run_step 7 ls "$PACKED/node_modules/bake/src/runtime"
run_step 7 in_dir "$PACKED" npx --no-install bake build
packed_build=$LAST_STATUS
start_dev "$PACKED" "$RESULTS_DIR/packed-dev.log" "$PACKED/node_modules/bake/src/cli.js"
run_step 7 node "$CHECK" packed "$PACKED/dist" "$DEV_ORIGIN" "$RESULTS_DIR/packed"
packed_check=$LAST_STATUS
stop_dev
note 7 "\$ cd <临时博客> && node node_modules/bake/src/cli.js dev
$(cat "$RESULTS_DIR/packed-dev.log")"
if [ "$install_status" -eq 0 ] && [ "$packed_build" -eq 0 ] && [ "$packed_check" -eq 0 ]; then
  record 7 'npm pack 后安装到临时博客，bake build 和 bake dev' 通过 '安装、构建退出码 0，构建结果和 bake dev 中组件都显示站点数据和断行结果；截图在 accept-results/extending/packed/'
else
  record 7 'npm pack 后安装到临时博客，bake build 和 bake dev' 失败 "安装退出码 $install_status，构建退出码 $packed_build，检查退出码 $packed_check，见 7.txt"
fi

write_summary
