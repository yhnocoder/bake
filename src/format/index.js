import { VFile } from 'vfile';
import { placeFootnoteDefinitions } from './footnotes.js';
import { checkFrontmatter, readYaml } from './frontmatter.js';
import { createProcessor } from './processor.js';
import { validateContent } from './validate.js';

function toMessages(file, path) {
  return file.messages
    .map((message) => ({ path, line: message.line ?? 1, column: message.column ?? 1, text: message.reason }))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}

function load(source, { path, blocks, components }) {
  const processor = createProcessor({ blocks, components });
  const file = new VFile({ path, value: source });
  const tree = processor.runSync(processor.parse(file), file);
  const yaml = readYaml(tree, file);
  return { processor, file, tree, yaml };
}

export function parseSyntax(source, { path } = {}) {
  const { file, tree } = load(source, { path });
  return { tree, messages: toMessages(file, path) };
}

export function parse(source, { path, blocks, components, otherTopicComponents, layouts, themes } = {}) {
  const { processor, file, tree, yaml } = load(source, { path, blocks, components });
  validateContent(tree, file, { registry: processor.data('registry'), components: processor.data('components'), otherTopicComponents });
  const frontmatter = checkFrontmatter(file, yaml, { layouts, themes });
  return { tree, frontmatter, messages: toMessages(file, path) };
}

export function stringify(tree) {
  const copy = structuredClone(tree);
  placeFootnoteDefinitions(copy);
  return createProcessor().stringify(copy);
}

export function format(source) {
  return stringify(parse(source).tree);
}

export function formatMessage({ path, line, column, text }) {
  return `${path}:${line}:${column} ${text}`;
}
