const skipped = new Set(['ProvidesPackage', 'NeedsTeXFormat'])
const mathjaxPackages = new Set(['amsmath', 'amssymb', 'amsfonts', 'mathtools', 'bm', 'boldsymbol', 'cancel', 'color', 'xcolor', 'newcommand'])
const definitions = new Set(['newcommand', 'renewcommand', 'def', 'let', 'DeclareMathOperator'])

function lineOf(text, offset) {
  return text.slice(0, offset).split('\n').length
}

function stripComments(text) {
  return text
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') i++
        else if (line[i] === '%') return line.slice(0, i) + ' '.repeat(line.length - i)
      }
      return line
    })
    .join('\n')
}

function readGroup(text, start) {
  if (text[start] !== '{') return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i + 1
  }
  return null
}

function skipSpace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index++
  return index
}

function readArguments(text, index) {
  for (;;) {
    index = skipSpace(text, index)
    if (text[index] === '*') index++
    else if (text[index] === '[') index = text.indexOf(']', index) + 1
    else if (text[index] === '{') {
      const end = readGroup(text, index)
      if (end === null) return { index: text.length, error: 'unbalanced braces' }
      index = end
    } else return { index }
  }
}

function readControl(text, index) {
  index = skipSpace(text, index)
  const match = /^\\(?:[A-Za-z@]+|.)/.exec(text.slice(index))
  return match ? index + match[0].length : index
}

export function parsePreamble(text) {
  const clean = stripComments(text)
  const statements = []
  const errors = []
  let index = skipSpace(clean, 0)
  while (index < clean.length) {
    const match = /^\\([A-Za-z@]+)/.exec(clean.slice(index))
    const line = lineOf(clean, index)
    if (!match) {
      errors.push({ line, message: `unexpected text "${clean.slice(index, index + 20).trim()}"` })
      break
    }
    const name = match[1]
    const start = index
    index += match[0].length
    if (name === 'let') {
      index = readControl(clean, index)
      index = skipSpace(clean, index)
      if (clean[index] === '=') index++
      index = readControl(clean, index)
    } else if (name === 'def') {
      index = readControl(clean, index)
      while (index < clean.length && clean[index] !== '{') index++
      const end = readGroup(clean, index)
      if (end === null) {
        errors.push({ line, message: 'unbalanced braces in \\def' })
        break
      }
      index = end
    } else {
      if (name === 'newcommand' || name === 'renewcommand') {
        index = skipSpace(clean, index)
        if (clean[index] === '*') index++
        index = skipSpace(clean, index)
        if (clean[index] !== '{') index = readControl(clean, index)
      }
      const result = readArguments(clean, index)
      if (result.error) {
        errors.push({ line, message: result.error })
        break
      }
      index = result.index
    }
    const statement = clean.slice(start, index)
    if (skipped.has(name)) {
      index = skipSpace(clean, index)
      continue
    }
    if (name === 'RequirePackage' || name === 'usepackage') {
      const packages =
        /\{([^}]*)\}/
          .exec(statement)?.[1]
          .split(',')
          .map((item) => item.trim()) ?? []
      const unknown = packages.filter((item) => !mathjaxPackages.has(item))
      if (unknown.length) errors.push({ line, message: `\\${name}{${unknown.join(',')}} is not a MathJax package` })
    } else if (definitions.has(name)) {
      statements.push({ line, tex: statement })
    } else {
      errors.push({ line, message: `\\${name} is not allowed in preamble.sty; use \\newcommand, \\renewcommand, \\def, \\let or \\DeclareMathOperator` })
    }
    index = skipSpace(clean, index)
  }
  return { statements, errors }
}
