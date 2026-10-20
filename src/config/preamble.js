import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { errorAt } from '../report.js';

export const PREAMBLE_FILE = 'preamble.sty';

const MATH_PACKAGES = Object.freeze(['amsmath', 'amssymb', 'amsfonts', 'mathtools', 'braket', 'cancel', 'cases', 'color', 'xcolor', 'gensymb', 'upgreek']);

const GRAMMARS = {
  newcommand: ['star', 'name', 'optional', 'optional', 'group'],
  renewcommand: ['star', 'name', 'optional', 'optional', 'group'],
  DeclareMathOperator: ['star', 'name', 'group'],
  def: ['command', 'parameters', 'group'],
  let: ['command', 'equals', 'token'],
  newenvironment: ['group', 'optional', 'optional', 'group', 'group'],
  renewenvironment: ['group', 'optional', 'optional', 'group', 'group'],
};
const PACKAGE_COMMANDS = {
  ProvidesPackage: ['group', 'optional'],
  RequirePackage: ['optional', 'group', 'optional'],
};
const ACCEPTED = [...Object.keys(GRAMMARS), ...Object.keys(PACKAGE_COMMANDS)].map((name) => `\\${name}`);
const LETTER = /[A-Za-z@]/;

export function readPreamble(root, errors) {
  let source;
  try {
    source = readFileSync(join(root, PREAMBLE_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return parsePreamble(source, errors);
}

export function parsePreamble(source, errors) {
  const reader = new Reader(source);
  const definitions = [];
  const report = (offset, message) => errors.push(errorAt(PREAMBLE_FILE, reader.positionAt(offset), message));
  while (reader.skipBlank()) {
    const start = reader.index;
    if (reader.peek() !== '\\') {
      report(start, `unexpected text ${JSON.stringify(reader.lineRest())}; preamble.sty may only contain macro definitions`);
      reader.skipLine();
      continue;
    }
    const name = reader.commandName();
    const grammar = GRAMMARS[name] ?? PACKAGE_COMMANDS[name];
    if (grammar === undefined) {
      report(start, `\\${name} cannot be used in preamble.sty, which accepts ${andList(ACCEPTED)}`);
      reader.skipLine();
      continue;
    }
    const parts = reader.readParts(grammar);
    if (parts === null) {
      report(start, `cannot read \\${name}; check its braces and arguments`);
      reader.skipLine();
      continue;
    }
    if (name === 'RequirePackage') {
      for (const pack of parts.groups[0].split(',').map((item) => item.trim())) {
        if (!MATH_PACKAGES.includes(pack)) report(start, `package "${pack}" is not loaded by Bake; \\RequirePackage accepts only the packages Bake always loads: ${andList(MATH_PACKAGES)}`);
      }
    } else if (Object.hasOwn(GRAMMARS, name)) {
      definitions.push({ tex: source.slice(start, reader.index), position: reader.positionAt(start) });
    }
  }
  return definitions;
}

function andList(items) {
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

class Reader {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  peek() {
    return this.source[this.index];
  }

  skipBlank() {
    while (this.index < this.source.length) {
      if (/\s/.test(this.peek())) this.index++;
      else if (this.peek() === '%') this.skipLine();
      else return true;
    }
    return false;
  }

  skipLine() {
    const end = this.source.indexOf('\n', this.index);
    this.index = end === -1 ? this.source.length : end + 1;
  }

  lineRest() {
    const end = this.source.indexOf('\n', this.index);
    return this.source.slice(this.index, end === -1 ? undefined : end).trimEnd();
  }

  commandName() {
    this.index++;
    const start = this.index;
    if (LETTER.test(this.peek() ?? '')) {
      while (LETTER.test(this.peek() ?? '')) this.index++;
    } else {
      this.index++;
    }
    return this.source.slice(start, this.index);
  }

  readParts(grammar) {
    const groups = [];
    for (const part of grammar) {
      this.skipBlank();
      const character = this.peek();
      if (part === 'star') {
        if (character === '*') this.index++;
      } else if (part === 'optional') {
        if (character === '[' && this.balanced('[', ']') === null) return null;
      } else if (part === 'equals') {
        if (character === '=') this.index++;
      } else if (part === 'parameters') {
        while (this.index < this.source.length && this.peek() !== '{') this.index++;
      } else if (part === 'command') {
        if (character !== '\\') return null;
        this.commandName();
      } else if (part === 'token') {
        if (character === undefined) return null;
        if (character === '\\') this.commandName();
        else this.index++;
      } else if (part === 'name') {
        if (character === '\\') this.commandName();
        else if (character !== '{' || this.balanced('{', '}') === null) return null;
      } else {
        if (character !== '{') return null;
        const group = this.balanced('{', '}');
        if (group === null) return null;
        groups.push(group);
      }
    }
    return { groups };
  }

  balanced(open, close) {
    const start = this.index;
    let depth = 0;
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '\\') {
        this.index += 2;
        continue;
      }
      this.index++;
      if (character === open) depth++;
      if (character === close && --depth === 0) return this.source.slice(start + 1, this.index - 1);
    }
    this.index = start;
    return null;
  }

  positionAt(offset) {
    const before = this.source.slice(0, offset);
    return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
  }
}
