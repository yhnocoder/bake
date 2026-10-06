# shellcheck shell=sh
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

accept_init() {
  TASK_NAME=$1
  RESULTS_DIR="$ROOT/accept-results/$TASK_NAME"
  rm -rf "$RESULTS_DIR"
  mkdir -p "$RESULTS_DIR"
  : > "$RESULTS_DIR/.rows"
  FAILED=0
}

run_step() {
  scenario_file="$RESULTS_DIR/$1.txt"
  shift
  printf '$ %s\n' "$*" >> "$scenario_file"
  set +e
  LAST_OUTPUT=$("$@" 2>&1)
  LAST_STATUS=$?
  set -e
  printf '%s\n[退出码 %s]\n\n' "$LAST_OUTPUT" "$LAST_STATUS" >> "$scenario_file"
}

note() {
  printf '%s\n\n' "$2" >> "$RESULTS_DIR/$1.txt"
}

record() {
  printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$4" >> "$RESULTS_DIR/.rows"
  printf '结果：%s。%s\n' "$3" "$4" >> "$RESULTS_DIR/$1.txt"
  if [ "$3" = "失败" ]; then FAILED=1; fi
}

write_summary() {
  summary="$RESULTS_DIR/summary.md"
  {
    printf '# 验收结果：%s\n\n' "$TASK_NAME"
    printf -- '- 时间：%s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    printf -- '- 提交：%s\n' "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 未知)"
    printf -- '- 工作区有未提交的修改：%s\n' "$(if [ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]; then echo 是; else echo 否; fi)"
    printf -- '- Node：%s\n' "$(node --version)"
    printf -- '- 系统：%s\n\n' "$(uname -sr)"
    printf '| 场景 | 内容 | 结果 | 说明 |\n'
    printf '| - | - | - | - |\n'
    cat "$RESULTS_DIR/.rows"
    printf '\n每个场景的命令、输出和退出码见同一目录下以场景编号命名的文件。\n'
  } > "$summary"
  rm "$RESULTS_DIR/.rows"
  cat "$summary"
  return "$FAILED"
}
