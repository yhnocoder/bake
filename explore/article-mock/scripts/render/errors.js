import { relative } from 'node:path'

const errors = new Map()

export function report(file, place, message) {
  const point = place?.position?.start ?? place?.start ?? place ?? {}
  const line = point.line ?? 1
  const column = point.column ?? 1
  const text = `${relative(process.cwd(), file)}:${line}:${column} ${message}`
  errors.set(text, { file, line, column, text })
}

export function hasErrors() {
  return errors.size > 0
}

export function printErrors() {
  const sorted = [...errors.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)
  for (const error of sorted) console.error(error.text)
  console.error(`${sorted.length} error${sorted.length === 1 ? '' : 's'}, nothing was written`)
}
