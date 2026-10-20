import { defaultHandlers } from 'mdast-util-to-hast';
import { toString } from 'mdast-util-to-string';
import { escapeMarkup } from '../escape.js';
import { fragmentOf, percentDecode } from '../fragments.js';
import { catalogEntry, catalogLines } from './context.js';
import { instructionLines } from './instructions.js';
import { markdownHtml, markdownTree, paragraphElement } from './reply.js';

export const MAX_NOTE_SOURCES = 4;

const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const OPEN_SCHEMES = new Set(['http', 'https', 'mailto']);
const MARKDOWN_SYNTAX = /[\\`*_[\]<>#!|~=$]/g;
const FILE_NAME = /[\\/:*?"<>|\u0000-\u001f]+/g;

export function citedEntries(root, catalog, rounds, own) {
  const urls = [];
  const add = (url) => url !== null && url !== undefined && url !== own && !urls.includes(url) && urls.push(url);
  for (const round of rounds) {
    for (const scope of round.ask.scopes) if (scope.kind === 'article') scope.urls.forEach(add);
    for (const read of round.reads) if (!read.failed) add(read.url);
    for (const link of links(markdownTree(round.content))) add(blogLink(link.url, { root, catalog })?.entry.url);
  }
  return urls.map((url) => catalog.articles.find((entry) => entry.url === url)).filter((entry) => entry !== undefined);
}

export function notePrompt({ catalog, own, sources, rounds, labels, previous = null, request = null, instructions = '' }) {
  const articles = [...(own === null ? [] : [own]), ...sources];
  const system = [
    `You write a study note from a conversation between a reader and the reading assistant of the blog "${catalog.title}".`,
    'Write the note in Markdown, in the language of the conversation, and answer with the note only.',
    'Start with one line "# " followed by a short title that names the topic.',
    'Leave out the questions and answers. Organize what the conversation established by topic, under "## " headings, as list items.',
    'After each point that comes from an article, link its source with the article title and the section number, such as [Rope §3](/2026-10/rope/#angles). Use only the addresses and section ids listed below.',
    `Where a short passage of an article supports a point, quote it word for word as a blockquote, and end the blockquote with a line that starts with "${labels.citedFrom}" and links the section, such as > ${labels.citedFrom}[Rope §3 Angles](/2026-10/rope/#angles).`,
    `List the questions that the conversation left open under a last heading "## ${labels.openQuestions}", and leave this heading out when no question is left open.`,
    'Write formulas in TeX, between $ and $ inline and between $$ and $$ on their own lines.',
    'Write nothing that neither the conversation nor the articles say.',
    ...(articles.length === 0 ? [] : ['The articles, one JSON object per line:', ...catalogLines(articles.map(({ entry }) => entry))]),
    ...articles.map(({ entry, source }) => [`<article address="${escapeMarkup(`/${entry.url}`)}" title="${escapeMarkup(entry.title)}">`, source, '</article>'].join('\n')),
    ...instructionLines(instructions),
  ].join('\n');
  const conversation = ['<conversation>', ...rounds.flatMap((round) => [`<reader>\n${round.ask.content}\n</reader>`, `<assistant>\n${round.content}\n</assistant>`]), '</conversation>'];
  const rewrite = previous === null ? [] : ['<note>', previous, '</note>', `Rewrite this note as the reader asks: ${request}`, 'Keep what the request does not ask to change.'];
  return [
    { role: 'system', content: system },
    { role: 'user', content: [...conversation, ...rewrite].join('\n') },
  ];
}

export function checkNote(markdown, { root, catalog, base }) {
  const articles = new Set();
  const text = rewriteLinks(markdown, (link) => {
    const target = blogLink(link.url, { root, catalog, base });
    if (target === 'external') return null;
    if (target === null) return labelOf(markdown, link);
    articles.add(target.entry.url);
    return `[${labelOf(markdown, link)}](${target.address})`;
  });
  return { markdown: text.trim(), articles: articles.size };
}

export function exportMarkdown(markdown, { root, intro }) {
  const { text } = withIntro(markdown, [intro]);
  const absolute = rewriteLinks(text, (link) => (link.url.startsWith('/') && !link.url.startsWith('//') ? `[${labelOf(text, link)}](${new URL(link.url.slice(1), root).href})` : null));
  return `${absolute.trimEnd()}\n`;
}

export function noteHtml(markdown, { root, citedFrom, intro }) {
  const { text, from, to } = withIntro(markdown, intro);
  const inIntro = (node) => node.position !== undefined && node.position.start.offset >= from && node.position.start.offset < to;
  return markdownHtml(markdownTree(text), {
    root,
    handlers: {
      heading: (state, node) => ({ type: 'element', tagName: node.depth === 1 ? 'h4' : 'h5', properties: {}, children: state.all(node) }),
      paragraph: (state, node) => {
        const element = paragraphElement(state, node);
        if (element.tagName === 'p' && inIntro(node)) element.properties.className = ['bk-chat-note-intro'];
        return element;
      },
      blockquote: (state, node) => {
        const element = defaultHandlers.blockquote(state, node);
        const last = element.children.findLast((child) => child.type === 'element');
        if (last?.tagName === 'p' && hastText(last).trim().startsWith(citedFrom)) last.tagName = 'cite';
        return element;
      },
    },
  });
}

export function noteTitle(markdown) {
  const heading = markdownTree(markdown).children.find((node) => node.type === 'heading' && node.depth === 1);
  return heading === undefined ? null : toString(heading).trim();
}

export function noteFileName(title) {
  return `${title.replace(FILE_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'note'}.md`;
}

export function markdownText(text) {
  return text.replace(MARKDOWN_SYNTAX, '\\$&');
}

function withIntro(markdown, intro) {
  const lines = intro.filter((line) => line !== null && line !== undefined).join('\n\n');
  if (lines === '') return { text: markdown, from: 0, to: 0 };
  const heading = markdownTree(markdown).children.find((node) => node.type === 'heading' && node.depth === 1);
  const at = heading === undefined ? 0 : heading.position.end.offset;
  const before = heading === undefined ? '' : '\n\n';
  const after = heading === undefined ? '\n\n' : '';
  const from = at + before.length;
  return { text: `${markdown.slice(0, at)}${before}${lines}${after}${markdown.slice(at)}`, from, to: from + lines.length };
}

function rewriteLinks(markdown, replace) {
  let text = markdown;
  for (const link of links(markdownTree(markdown)).reverse()) {
    const replacement = replace(link);
    if (replacement !== null) text = text.slice(0, link.position.start.offset) + replacement + text.slice(link.position.end.offset);
  }
  return text;
}

function blogLink(href, { root, catalog, base }) {
  const scheme = SCHEME.exec(href)?.[1].toLowerCase();
  if (scheme !== undefined && !href.startsWith(root)) return OPEN_SCHEMES.has(scheme) ? 'external' : null;
  if (href.startsWith('//') || (href.startsWith('#') && base === undefined)) return null;
  let url;
  try {
    url = new URL(href.startsWith('#') ? `${base.replace(/^\/+/, '')}${href}` : href.replace(/^\/+/, ''), root);
  } catch {
    return null;
  }
  if (!url.href.startsWith(root)) return null;
  const entry = catalogEntry(root, catalog, url.href.slice(0, url.href.length - url.hash.length));
  if (entry === null) return null;
  if (url.hash === '') return { entry, address: `/${entry.url}` };
  const id = percentDecode(url.hash.slice(1));
  const ids = entry.sections.flatMap((section) => [section.id, ...section.subsections.map((subsection) => subsection.id)]);
  return ids.includes(id) ? { entry, address: `/${entry.url}${fragmentOf(id)}` } : null;
}

function links(tree) {
  const found = [];
  const walk = (node) => {
    if (node.type === 'link') found.push(node);
    else node.children?.forEach(walk);
  };
  walk(tree);
  return found;
}

function labelOf(markdown, link) {
  if (link.children.length === 0) return '';
  return markdown.slice(link.children[0].position.start.offset, link.children.at(-1).position.end.offset);
}

function hastText(node) {
  return node.type === 'text' ? node.value : (node.children ?? []).map(hastText).join('');
}
