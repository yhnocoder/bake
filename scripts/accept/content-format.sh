#!/bin/sh
set -eu
# shellcheck source=scripts/accept/lib.sh
. "$(dirname "$0")/lib.sh"

accept_init content-format
BAKE="node $ROOT/src/cli.js"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

run_step 1 "$ROOT/scripts/test.sh"
if [ "$LAST_STATUS" -eq 0 ]; then
  passed=$(printf '%s\n' "$LAST_OUTPUT" | sed -n 's/^# pass //p')
  record 1 'scripts/test.sh 全部通过' 通过 "$passed 个测试通过，退出码 0"
else
  record 1 'scripts/test.sh 全部通过' 失败 "退出码 $LAST_STATUS"
fi

run_step 2 sh -c "cd '$ROOT/examples/minimal' && $BAKE format"
if [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_OUTPUT" = 'No files to rewrite' ]; then
  record 2 '对 examples/minimal 运行 bake format' 通过 '输出 No files to rewrite，退出码 0'
else
  record 2 '对 examples/minimal 运行 bake format' 失败 "退出码 $LAST_STATUS"
fi

mkdir -p "$WORK/blog3/content"
cat > "$WORK/blog3/content/post.md" <<'MD'
---
title: 不符合输出格式的文章
---

标题
====

* 第一项
* 第二项

_强调_ 与 __加粗__

| 函数   | 导数 |
|:-------|-----:|
| ReLU   | 1    |

正文[^a]。

:::callout{kind="tip"}
提示
:::

[^a]: 注释
MD
cp "$WORK/blog3/content/post.md" "$WORK/original.md"
run_step 3 sh -c "cd '$WORK/blog3' && $BAKE format"
first_status=$LAST_STATUS
first_output=$LAST_OUTPUT
run_step 3 diff "$WORK/original.md" "$WORK/blog3/content/post.md"
changed_status=$LAST_STATUS
run_step 3 sh -c "cd '$WORK/blog3' && $BAKE format"
if [ "$first_status" -eq 0 ] && [ "$first_output" = "$(printf 'content/post.md\nRewrote 1 file')" ] \
  && [ "$changed_status" -eq 1 ] && [ "$LAST_STATUS" -eq 0 ] && [ "$LAST_OUTPUT" = 'No files to rewrite' ]; then
  record 3 '不符合输出格式的文章被改写，第二次运行不再改写' 通过 '第一次输出 Rewrote 1 file，第二次输出 No files to rewrite'
else
  record 3 '不符合输出格式的文章被改写，第二次运行不再改写' 失败 "第一次退出码 $first_status，第二次退出码 $LAST_STATUS"
fi

mkdir -p "$WORK/blog4/content"
cat > "$WORK/blog4/content/broken.md" <<'MD'
---
title: [未闭合
---

:::callot
内容
:::

* 列表
MD
cp "$WORK/blog4/content/broken.md" "$WORK/broken-original.md"
run_step 4 sh -c "cd '$WORK/blog4' && $BAKE format"
format_status=$LAST_STATUS
format_output=$LAST_OUTPUT
run_step 4 cmp "$WORK/broken-original.md" "$WORK/blog4/content/broken.md"
note 4 'bake format 只检查语法和 frontmatter 的 YAML 语法，:::callot 由 bake build 报告，这里不报告。'
if [ "$format_status" -eq 1 ] && printf '%s\n' "$format_output" | grep -Eq '^content/broken\.md:[0-9]+:[0-9]+ ' \
  && [ "$LAST_STATUS" -eq 0 ]; then
  record 4 '含 :::callot 和 YAML 语法错误的文章' 通过 '输出带行号的错误，退出码 1，文件不变'
else
  record 4 '含 :::callot 和 YAML 语法错误的文章' 失败 "退出码 $format_status，文件比较退出码 $LAST_STATUS"
fi

note 5 'GitHub Actions 只在 PR 上运行，本脚本无法运行。结果见 PR 的检查。'
record 5 'PR 上的 GitHub Actions 通过' 未运行 '由 PR 检查'

write_summary
