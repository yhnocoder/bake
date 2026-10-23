const QUOTE = String.raw`(?:[ \t]*>)*[ \t]*`;
const BLOCK_NAME = new RegExp(`^(${QUOTE})(:{3,})([A-Za-z][\\w-]*)?$`);
const BLOCK_ATTRIBUTES = new RegExp(`^${QUOTE}:{3,}([A-Za-z][\\w-]*)\\{([^}]*)$`);
const OPENING_LINE = new RegExp(`^${QUOTE}:{3,}[A-Za-z{]`);
const CLOSING_LINE = new RegExp(`^${QUOTE}:{3,}[ \\t]*$`);
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const ATTRIBUTE_VALUE = /([A-Za-z_][\w-]*)=("?)([^\s"]*)$/;
const ATTRIBUTE_START = /(?:^|\s)([A-Za-z_][\w-]*)?$/;
const WRITTEN_ATTRIBUTE = /(?:^|\s)([A-Za-z_][\w-]*)(?==|\s|$)/g;
const IMAGE_ATTRIBUTES = /!\[[^\]]*\]\([^)]*\)\{([^}]*)$/;
const HEADING_ATTRIBUTES = /^ {0,3}(#{1,6})[ \t].*\{([^{}]*)$/;
const FIELD_NAME = /^([A-Za-z_][\w-]*)?$/;
const FIELD_VALUE = /^([A-Za-z_][\w-]*):[ \t]*("?)([^"]*)$/;
const WRITTEN_FIELD = /^([A-Za-z_][\w-]*):/;
const CITATION = /\[@([^\]\s;]*)$/;
const FOOTNOTE = /\[\^([^\]\s]*)$/;
const EQREF = /\\eqref\{([^}]*)$/;
const REFERENCE_ENTRY = /^[ \t]*[-*+][ \t]+\[@([^\]\s]+)\][ \t]*(.*)$/gm;
const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm;
const LABEL = /\\label\{([^}]+)\}/g;
const SLASH_AT_LINE_START = new RegExp(`^(${QUOTE})\\/([\\w-]*)$`);
// why: a slash after a letter, a digit or the characters of an address belongs to a path or a URL, such as a/b or https://
const SLASH = /(?:^|[^\w:/.~\-\]\)])\/([\w-]*)$/;
const LINE_SNIPPETS = [
  { label: 'heading', detail: 'a section, ##', snippet: '## $0' },
  { label: 'subheading', detail: 'a subsection, ###', snippet: '### $0' },
  { label: 'math', detail: 'a display formula, $$', lines: ['$$', '$0', '$$'] },
  { label: 'code', detail: 'a code block', lines: ['```${1:text}', '$0', '```'] },
  { label: 'table', detail: 'a GFM table', lines: ['| $1 | $2 |', '| --- | --- |', '| $3 | $0 |'] },
  { label: 'image', detail: 'an image of the article folder', snippet: '![$1]($2)' },
  { label: 'width', detail: 'the width of the block inside, :::{width=…}', lines: [':::{width=${1|wide,page,body|}}', '$0', ':::'] },
];
const INLINE_SNIPPETS = [
  { label: 'citation', detail: 'a citation of :::references, [@key]', snippet: '[@$1]', suggest: true },
  { label: 'footnote', detail: 'a sidenote, [^name]', snippet: '[^$1]', suggest: true },
  { label: 'eqref', detail: 'a reference to an equation, \\eqref{label}', snippet: '\\\\eqref{$1}', suggest: true },
  { label: 'inline-math', detail: 'a formula in the text, $…$', snippet: '\\$$1\\$' },
  { label: 'highlight', detail: 'highlighted text, ==…==', snippet: '==$1==' },
  { label: 'link', detail: 'a link, [text](address)', snippet: '[$1]($2)' },
];

// Returns the completions at a position of an article: the fields of the front matter and their values, block names after :::, attributes inside the braces of a block line, an image or a heading, the citations, footnotes and equation labels of the article, and a menu of blocks and Markdown after /.
// Each completion replaces the characters of the line from `from` to the cursor with `snippet`, a VS Code snippet. VS Code matches what was typed against `filter`, or against `label` when there is no `filter`. `suggest` asks for the completions again after the snippet is inserted.
function completionsAt(text, line, character, { blocks, image, headings, frontMatter }) {
  const lines = text.split('\n');
  const before = lines[line].slice(0, character);
  const after = lines[line].slice(character);
  if (inFrontMatter(lines, line)) return fieldCompletions(frontMatter, lines, line, before, after, character);
  if (fenceAt(lines.slice(0, line)) !== null) return [];
  const name = BLOCK_NAME.exec(before);
  if (name !== null && after.trim() === '') {
    const [, quote, colons, typed = ''] = name;
    if (typed === '' && openBlocks(lines.slice(0, line)) > 0) return [];
    const closing = (lines[line + 1] ?? '').trim() === '' ? `\n${quote}$0\n${quote}${colons}` : '';
    return blocks
      .filter((block) => block.name !== '')
      .map((block) => ({ ...blockCompletion(block), from: character - typed.length, snippet: `${block.name}${braces(block)}${closing}` }));
  }
  const slash = SLASH_AT_LINE_START.exec(before);
  if (slash !== null && after.trim() === '') {
    const [, quote, typed] = slash;
    const from = character - typed.length - 1;
    const menu = [
      ...blocks.filter((block) => block.name !== '').map((block) => ({ ...blockCompletion(block), snippet: lineSnippet([`:::${block.name}${braces(block)}`, '$0', ':::'], quote) })),
      ...LINE_SNIPPETS.map(({ lines: snippetLines, snippet, ...item }) => ({ ...item, kind: 'snippet', snippet: snippetLines === undefined ? snippet : lineSnippet(snippetLines, quote) })),
      ...INLINE_SNIPPETS.map((item) => ({ ...item, kind: 'snippet' })),
    ];
    return menu.map((item) => ({ ...item, from, filter: `/${item.label}` }));
  }
  const attributes = BLOCK_ATTRIBUTES.exec(before);
  if (attributes !== null) {
    const block = blocks.find((candidate) => candidate.name === attributes[1]);
    return block === undefined ? [] : attributeCompletions(block.attributes, attributes[2], character);
  }
  const imageAttributes = IMAGE_ATTRIBUTES.exec(before);
  if (imageAttributes !== null) return attributeCompletions(image, imageAttributes[1], character);
  const heading = HEADING_ATTRIBUTES.exec(before);
  if (heading !== null) {
    const depth = heading[1].length;
    const declared = Object.entries(headings).filter(([, declaration]) => declaration.depth === undefined || declaration.depth === depth);
    return attributeCompletions(Object.fromEntries(declared), heading[2], character);
  }
  const citation = CITATION.exec(before);
  if (citation !== null) return entries(text, REFERENCE_ENTRY, 'citation', character - citation[1].length);
  const footnote = FOOTNOTE.exec(before);
  if (footnote !== null) return entries(text, FOOTNOTE_DEFINITION, 'footnote', character - footnote[1].length);
  const eqref = EQREF.exec(before);
  if (eqref !== null) return entries(text, LABEL, 'equation', character - eqref[1].length);
  const inline = SLASH.exec(before);
  if (inline !== null) return INLINE_SNIPPETS.map((item) => ({ ...item, kind: 'snippet', from: character - inline[1].length - 1, filter: `/${item.label}` }));
  return [];
}

function blockCompletion(block) {
  return { kind: 'block', label: block.name, detail: BLOCK_KINDS[block.kind], documentation: describeAttributes(block.attributes), suggest: Object.keys(block.attributes).length > 0 };
}

// why: the cursor goes into the braces, and the completions then list the attributes of the block
function braces(block) {
  return Object.keys(block.attributes).length > 0 ? '{$1}' : '';
}

function lineSnippet(snippetLines, quote) {
  return snippetLines.map((text, index) => (index === 0 ? text : `${quote}${text}`)).join('\n');
}

const BLOCK_KINDS = { 'built-in': 'block of Bake', theme: 'block of the theme', component: 'component' };

function openBlocks(lines) {
  let open = 0;
  let fence = null;
  for (const text of lines) {
    fence = nextFence(fence, text);
    if (fence !== null || FENCE.test(text)) continue;
    if (OPENING_LINE.test(text)) open += 1;
    else if (CLOSING_LINE.test(text) && open > 0) open -= 1;
  }
  return open;
}

function fenceAt(lines) {
  return lines.reduce(nextFence, null);
}

function nextFence(fence, text) {
  const marker = FENCE.exec(text)?.[1];
  if (marker === undefined) return fence;
  if (fence === null) return marker;
  return marker[0] === fence[0] && marker.length >= fence.length ? null : fence;
}

// why: while the closing --- line is not written yet, every line after the opening one is front matter
function inFrontMatter(lines, line) {
  if (lines[0] !== '---' || line === 0) return false;
  const close = lines.indexOf('---', 1);
  return close === -1 || line < close;
}

function fieldCompletions(declarations, lines, line, before, after, character) {
  const value = FIELD_VALUE.exec(before);
  if (value !== null) {
    const [, name, quote, typed] = value;
    return valueCompletions(declarations[name], character - typed.length - quote.length);
  }
  if (FIELD_NAME.exec(before) === null || after.trim() !== '') return [];
  const close = lines.indexOf('---', 1);
  const present = new Set(lines.slice(1, close === -1 ? undefined : close).filter((_, index) => index !== line - 1).map((text) => WRITTEN_FIELD.exec(text)?.[1]));
  return Object.entries(declarations)
    .filter(([name]) => !present.has(name))
    .map(([name, declaration]) => ({ kind: 'attribute', label: name, detail: declaration.label, documentation: describeDeclaration(declaration), from: 0, snippet: fieldSnippet(name, declaration), suggest: declaration.type === 'enum' || declaration.type === 'boolean' }));
}

function fieldSnippet(name, declaration) {
  if (declaration.type === 'date') return `${name}: \${1:\$CURRENT_YEAR-\$CURRENT_MONTH-\$CURRENT_DATE}`;
  if (declaration.type === 'list') return `${name}: [$1]`;
  if (declaration.type === 'text') return `${name}: $1`;
  return `${name}: ${valueSnippet(declaration)}`;
}

function attributeCompletions(declarations, written, character) {
  const value = ATTRIBUTE_VALUE.exec(written);
  if (value !== null) {
    const [, name, quote, typed] = value;
    return valueCompletions(declarations[name], character - typed.length - quote.length);
  }
  const start = ATTRIBUTE_START.exec(written);
  if (start === null) return [];
  const typed = start[1] ?? '';
  const present = new Set([...written.matchAll(WRITTEN_ATTRIBUTE)].map((match) => match[1]));
  return Object.entries(declarations)
    .filter(([name]) => !present.has(name) || name === typed)
    .map(([name, declaration]) => ({ kind: 'attribute', label: name, detail: declaration.label, documentation: describeDeclaration(declaration), from: character - typed.length, snippet: attributeSnippet(name, declaration) }));
}

function valueCompletions(declaration, from) {
  const choices = declaration?.type === 'enum' ? declaration.options : declaration?.type === 'boolean' ? ['true', 'false'] : [];
  return choices.map((choice) => ({ kind: 'value', label: String(choice), detail: declaration.label, from, snippet: String(choice) }));
}

function attributeSnippet(name, declaration) {
  return declaration.type === 'text' ? `${name}="$1"` : `${name}=${valueSnippet(declaration)}`;
}

function valueSnippet(declaration) {
  if (declaration.type === 'enum') return `\${1|${declaration.options.map(escapeChoice).join(',')}|}`;
  if (declaration.type === 'boolean') return '${1|true,false|}';
  return `\${1:${declaration.default ?? ''}}`;
}

function escapeChoice(choice) {
  return String(choice).replace(/[\\|,$}]/g, (character) => `\\${character}`);
}

function describeAttributes(attributes) {
  const names = Object.keys(attributes);
  return names.length === 0 ? 'No attributes' : names.map((name) => `${name}: ${describeDeclaration(attributes[name])}`).join('\n');
}

function describeDeclaration(declaration) {
  const parts = [declaration.type];
  if (declaration.type === 'enum') parts.push(`one of ${declaration.options.join(', ')}`);
  if (declaration.min !== undefined || declaration.max !== undefined) parts.push(`from ${declaration.min ?? '-∞'} to ${declaration.max ?? '∞'}`);
  if (declaration.default !== undefined) parts.push(`default ${JSON.stringify(declaration.default)}`);
  return parts.join(', ');
}

function entries(text, pattern, kind, from) {
  const seen = new Map();
  for (const [, label, detail = ''] of text.matchAll(pattern)) if (!seen.has(label)) seen.set(label, detail);
  return [...seen].map(([label, detail]) => ({ kind, label, detail, from, snippet: escapeSnippet(label) }));
}

function escapeSnippet(text) {
  return text.replace(/[\\$}]/g, (character) => `\\${character}`);
}

module.exports = { completionsAt };
