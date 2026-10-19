import { bundledLanguages, createCssVariablesTheme, createHighlighter } from 'shiki'

const plainLanguages = new Set(['', 'text', 'txt', 'plain'])

const theme = createCssVariablesTheme({ name: 'bake', variablePrefix: '--code-', fontStyle: true })

let highlighterPromise

function highlighter() {
  highlighterPromise ??= createHighlighter({ themes: [theme], langs: [] })
  return highlighterPromise
}

export function isKnownLanguage(lang) {
  return plainLanguages.has(lang ?? '') || Object.hasOwn(bundledLanguages, lang)
}

export async function highlight(code, lang) {
  if (plainLanguages.has(lang ?? '')) return null
  const shiki = await highlighter()
  await shiki.loadLanguage(lang)
  const html = shiki.codeToHtml(code, { lang, theme: 'bake', tokenizeTimeLimit: 0 })
  return html.slice(html.indexOf('<code>') + 6, html.lastIndexOf('</code>'))
}
