import { escapeAttribute, escapeHtml, hrefFor, locationLabel, renderFlow, renderInlineNodes } from './html.js'

export const siteName = 'Learn by Visualization'

function firstParagraph(children, start) {
  for (let index = start + 1; index < children.length; index++) {
    const node = children[index]
    if (node.type === 'heading') return null
    if (node.type === 'paragraph' && !node.children.every((child) => child.type === 'image')) return node
  }
  return null
}

function tocData(article, ctx) {
  const children = article.tree.children
  const inlineCtx = { ...ctx, mode: 'preview', sink: [] }
  const lead = (index) => {
    const paragraph = firstParagraph(children, index)
    return paragraph ? renderInlineNodes(paragraph.children, inlineCtx) : ''
  }
  const title = (node) => (node.attributes?.toc ? escapeHtml(node.attributes.toc) : renderInlineNodes(node.children, inlineCtx))
  return article.chapters.map((chapter) => ({
    id: chapter.node.id,
    number: chapter.number,
    title: title(chapter.node),
    fullTitle: renderInlineNodes(chapter.node.children, inlineCtx),
    lead: lead(chapter.index),
    sections: chapter.sections.map((section) => ({
      id: section.node.id,
      title: title(section.node),
      lead: lead(section.index),
      recap: section.recap ? renderFlow(section.recap.children, inlineCtx) : '',
    })),
  }))
}

function previewBlocks(target) {
  const { article, entry } = target
  const children = article.tree.children
  if (!entry) return []
  if (entry.kind === 'paragraph' && !entry.topLevel) return [entry.node]
  const blocks = []
  let index = entry.kind === 'heading' ? entry.index + 1 : entry.index
  if (index < 0) return [entry.node]
  while (index < children.length && blocks.length < 3) {
    const node = children[index]
    if (node.type === 'heading') {
      if (entry.kind !== 'heading' || node.depth <= entry.node.depth || blocks.length > 0) break
      index++
      continue
    }
    if (!(node.type === 'containerDirective' && ['recap', 'references', 'embed'].includes(node.name))) blocks.push(node)
    index++
  }
  return blocks
}

function previewHtml(key, target, ctx) {
  const { article, entry } = target
  const inner = { ...ctx, article, mode: 'preview', sink: [], width: undefined, fail: (node, message) => ctx.failIn(article.file, node, message) }
  const chapter = entry?.chapter
  const location = chapter ? ` · ${chapter.number} ${escapeHtml(chapter.node.text)}` : ''
  let title = ''
  let body = ''
  if (!entry) {
    title = escapeHtml(article.title)
    body = `<p>${escapeHtml(article.summary)}</p>`
  } else {
    if (entry.kind === 'heading') title = renderInlineNodes(entry.node.children, inner)
    body = renderFlow(previewBlocks(target), inner)
  }
  const head = `<div class="bk-pv-from">${escapeHtml(article.title)}${location}</div>`
  const titleHtml = title ? `<div class="bk-pv-title">${title}</div>` : ''
  return `<template data-preview="${escapeAttribute(key)}">${head}${titleHtml}<div class="bk-pv-body">${body}</div><div class="bk-pv-foot">点击跳转到原文</div></template>`
}

function formatWords(count) {
  if (count >= 1000) return `约 ${Math.round(count / 100) * 100} 字`
  return `约 ${count} 字`
}

const themeScript = `try{var t=localStorage.getItem('bk-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;var s=localStorage.getItem('bk-toc');if(['notes','tabs','dots','ticks'].includes(s))document.documentElement.dataset.toc=s}catch(e){}`

export function articlePage(article, ctx) {
  const body = renderFlow(article.tree.children, ctx)
  const toc = JSON.stringify(tocData(article, ctx)).replaceAll('<', '\\u003c')
  const previews = [...ctx.state.previews].map(([key, target]) => previewHtml(key, target, ctx)).join('')
  const root = '../../'
  const content = `${body}${previews}${toc}`
  const meta = [article.date, formatWords(article.words)].filter(Boolean).join(' · ')
  return {
    content,
    html: (defs, assets) => `<!doctype html>
<html lang="zh-CN" data-toc="${article.toc}" data-default-toc="${article.toc}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${escapeHtml(article.title)} · ${siteName}</title>
<meta name="description" content="${escapeAttribute(article.summary)}">
<script>${themeScript}</script>
${assets.css.map((href) => `<link rel="stylesheet" href="${root}${href}">`).join('\n')}
<script type="module" src="${root}${assets.js}"></script>
</head>
<body class="bk-page">
${defs}
<div class="bk-shell">
<header class="bk-header">
<a class="bk-site" href="${root}">${siteName}</a>
<h1 class="bk-title">${escapeHtml(article.title)}</h1>
${article.summary ? `<p class="bk-summary">${escapeHtml(article.summary)}</p>` : ''}
<div class="bk-meta">${escapeHtml(meta)}</div>
</header>
<nav class="bk-toc" aria-label="目录"></nav>
<article class="bk-article">
${body}
</article>
</div>
<script type="application/json" id="bk-toc-data">${toc}</script>
<div id="bk-previews" hidden>${previews}</div>
</body>
</html>
`,
  }
}

export function indexPage(articles, assets) {
  const items = articles
    .map(
      (article) =>
        `<li><a href="${article.path}/"><span class="bk-index-title">${escapeHtml(article.title)}</span></a><div class="bk-index-meta">${escapeHtml(article.date)} · ${formatWords(article.words)}</div>${article.summary ? `<p>${escapeHtml(article.summary)}</p>` : ''}</li>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${siteName}</title>
<script>${themeScript}</script>
${assets.css.map((href) => `<link rel="stylesheet" href="./${href}">`).join('\n')}
<script type="module" src="./${assets.js}"></script>
</head>
<body class="bk-page bk-index-page">
<main class="bk-index">
<div class="bk-site">${siteName}</div>
<ul class="bk-index-list">
${items}
</ul>
</main>
</body>
</html>
`
}

export { hrefFor, locationLabel }
