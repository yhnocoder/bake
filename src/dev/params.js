import { createHash } from 'node:crypto';
import { folderFile } from '../config/rules.js';
import { convertAttribute, valueProblem } from '../components/declarations.js';
import { BARE_VALUE, attributeTokens } from '../markdown/attributes.js';
import { describeValue } from '../report.js';

const DIRECTIVE = /^((?:[ \t]*>)*[ \t]*)(:{3,})([A-Za-z][\w-]*)/;
const DIRECTIVE_REST = /^(\{.*\})?([ \t]*)$/;

export function sourceVersion(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function rewriteSource(source, line, name, declarations, values, files) {
  const lines = source.split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return { error: `the file has no line ${describeValue(line)}` };
  const text = lines[line - 1];
  const ending = text.endsWith('\r') ? '\r' : '';
  const result = rewriteLine(text.slice(0, text.length - ending.length), name, declarations, values, files);
  if (result.error !== undefined) return result;
  lines[line - 1] = `${result.line}${ending}`;
  return { line: result.line, source: lines.join('\n') };
}

export function rewriteLine(text, name, declarations, values, files) {
  const directive = DIRECTIVE.exec(text);
  if (directive === null || directive[3] !== name) return { error: `the line does not start a :::${name} block: ${text}` };
  const rest = DIRECTIVE_REST.exec(text.slice(directive[0].length));
  if (rest === null) return { error: `cannot read the attributes of :::${name}: ${text}` };
  const [, attributeText = '', trailing] = rest;
  const { tokens, error } = attributeText === '' ? { tokens: [] } : attributeTokens(attributeText);
  if (error !== undefined) return { error };
  const written = new Map();
  for (const token of tokens) {
    if (written.has(token.key)) return { error: `attribute "${token.key}" is written twice` };
    written.set(token.key, token);
  }
  const edits = new Map();
  for (const [param, value] of Object.entries(values)) {
    const edit = paramEdit(name, param, declarations[param], value, written.get(param), files);
    if (edit.error !== undefined) return edit;
    if (edit.text !== undefined) edits.set(param, edit.text);
  }
  return { line: `${directive[0]}${joinAttributes(attributeText, tokens, edits)}${trailing}` };
}

function paramEdit(name, param, declaration, value, token, files) {
  if (declaration === undefined) return { error: `unknown parameter "${param}" for ${name}` };
  const problem = valueProblem(declaration, value) ?? fileProblem(declaration, value, files);
  if (problem !== null) return { error: `parameter "${param}" of ${name} ${problem}` };
  const current = token === undefined ? declaration.default : convertAttribute(declaration, token.value).value;
  if (current === value) return {};
  if (value === declaration.default) return { text: null };
  const text = attributeText(param, declaration, value);
  return text === null ? { error: `parameter "${param}" of ${name} cannot be written as an attribute, because its text contains both " and '` } : { text };
}

function fileProblem(declaration, value, files) {
  if (declaration.type !== 'file' || value === '' || folderFile(value, files) !== null) return null;
  return `must be a file in the article folder, got ${describeValue(value)}`;
}

function attributeText(param, declaration, value) {
  if (declaration.type === 'boolean') return value ? param : `${param}=false`;
  if (declaration.type === 'number') return `${param}=${String(value)}`;
  if (BARE_VALUE.test(value)) return `${param}=${value}`;
  if (!value.includes('"')) return `${param}="${value}"`;
  if (!value.includes("'")) return `${param}='${value}'`;
  return null;
}

function joinAttributes(text, tokens, edits) {
  const kept = [];
  let end = 1;
  for (const token of tokens) {
    const gap = text.slice(end, token.start);
    end = token.end;
    if (!edits.has(token.key)) kept.push({ gap, body: text.slice(token.start, token.end) });
    else if (edits.get(token.key) !== null) kept.push({ gap, body: edits.get(token.key) });
  }
  const added = new Set(tokens.map((token) => token.key));
  for (const [key, body] of edits) {
    if (!added.has(key) && body !== null) kept.push({ gap: ' ', body });
  }
  if (kept.length === 0) return '';
  kept[0].gap = tokens.length === 0 ? '' : text.slice(1, tokens[0].start);
  const closing = text === '' ? '' : text.slice(end, -1);
  return `{${kept.map(({ gap, body }) => `${gap}${body}`).join('')}${closing}}`;
}
