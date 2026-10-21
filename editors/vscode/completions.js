const QUOTE = String.raw`(?:[ \t]*>)*[ \t]*`;
const BLOCK_NAME = new RegExp(`^(${QUOTE})(:{3,})([A-Za-z][\\w-]*)?$`);
const BLOCK_ATTRIBUTES = new RegExp(`^${QUOTE}:{3,}([A-Za-z][\\w-]*)\\{([^}]*)$`);
const OPENING_LINE = new RegExp(`^${QUOTE}:{3,}[A-Za-z{]`);
const CLOSING_LINE = new RegExp(`^${QUOTE}:{3,}[ \\t]*$`);
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const ATTRIBUTE_VALUE = /([A-Za-z_][\w-]*)=("?)([^\s"]*)$/;
const ATTRIBUTE_START = /(?:^|\s)([A-Za-z_][\w-]*)?$/;
const WRITTEN_ATTRIBUTE = /(?:^|\s)([A-Za-z_][\w-]*)(?==|\s|$)/g;
const CITATION = /\[@([^\]\s;]*)$/;
const FOOTNOTE = /\[\^([^\]\s]*)$/;
const EQREF = /\\eqref\{([^}]*)$/;
const REFERENCE_ENTRY = /^[ \t]*[-*+][ \t]+\[@([^\]\s]+)\][ \t]*(.*)$/gm;
const FOOTNOTE_DEFINITION = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/gm;
const LABEL = /\\label\{([^}]+)\}/g;

// Returns the completions at a position of an article: block names after :::, attributes inside the braces of a block line, and the citations, footnotes and equation labels of the article.
// Each completion replaces the characters of the line from `from` to the cursor with `snippet`, a VS Code snippet.
function completionsAt(text, line, character, blocks) {
  const lines = text.split('\n');
  const before = lines[line].slice(0, character);
  const after = lines[line].slice(character);
  const name = BLOCK_NAME.exec(before);
  if (name !== null && after.trim() === '') {
    const [, quote, colons, typed = ''] = name;
    if (typed === '' && openBlocks(lines.slice(0, line)) > 0) return [];
    const closing = (lines[line + 1] ?? '').trim() === '' ? `\n$0\n${quote}${colons}` : '';
    return blocks
      .filter((block) => block.name !== '')
      .map((block) => ({
        kind: 'block',
        label: block.name,
        detail: BLOCK_KINDS[block.kind],
        documentation: describeAttributes(block.attributes),
        from: character - typed.length,
        snippet: `${block.name}${closing}`,
      }));
  }
  const attributes = BLOCK_ATTRIBUTES.exec(before);
  if (attributes !== null) {
    const block = blocks.find((candidate) => candidate.name === attributes[1]);
    return block === undefined ? [] : attributeCompletions(block, attributes[2], character);
  }
  const citation = CITATION.exec(before);
  if (citation !== null) return entries(text, REFERENCE_ENTRY, 'citation', character - citation[1].length);
  const footnote = FOOTNOTE.exec(before);
  if (footnote !== null) return entries(text, FOOTNOTE_DEFINITION, 'footnote', character - footnote[1].length);
  const eqref = EQREF.exec(before);
  if (eqref !== null) return entries(text, LABEL, 'equation', character - eqref[1].length);
  return [];
}

const BLOCK_KINDS = { 'built-in': 'block of Bake', theme: 'block of the theme', component: 'component' };

function openBlocks(lines) {
  let open = 0;
  let fence = null;
  for (const text of lines) {
    const marker = FENCE.exec(text)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker !== undefined) {
      fence = marker;
    } else if (OPENING_LINE.test(text)) {
      open += 1;
    } else if (CLOSING_LINE.test(text) && open > 0) {
      open -= 1;
    }
  }
  return open;
}

function attributeCompletions(block, written, character) {
  const value = ATTRIBUTE_VALUE.exec(written);
  if (value !== null) {
    const [, name, quote, typed] = value;
    const declaration = block.attributes[name];
    const choices = declaration?.type === 'enum' ? declaration.options : declaration?.type === 'boolean' ? ['true', 'false'] : [];
    return choices.map((choice) => ({ kind: 'value', label: String(choice), detail: declaration.label, from: character - typed.length - quote.length, snippet: String(choice) }));
  }
  const start = ATTRIBUTE_START.exec(written);
  if (start === null) return [];
  const typed = start[1] ?? '';
  const present = new Set([...written.matchAll(WRITTEN_ATTRIBUTE)].map((match) => match[1]));
  return Object.entries(block.attributes)
    .filter(([name]) => !present.has(name) || name === typed)
    .map(([name, declaration]) => ({ kind: 'attribute', label: name, detail: declaration.label, documentation: describeDeclaration(declaration), from: character - typed.length, snippet: attributeSnippet(name, declaration) }));
}

function attributeSnippet(name, declaration) {
  if (declaration.type === 'enum') return `${name}=\${1|${declaration.options.map(escapeChoice).join(',')}|}`;
  if (declaration.type === 'boolean') return `${name}=\${1|true,false|}`;
  if (declaration.type === 'number') return `${name}=\${1:${declaration.default ?? ''}}`;
  return `${name}="$1"`;
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
