import { errorAt } from '../report.js';
import { pageRoot } from '../urls.js';
import { embedParts, indexTargets, linkArticle } from './link.js';
import { parseArticle } from './parse.js';
import { articleStructure } from './structure.js';

export async function readArticle(file, source, errors, { folder = null, preamble = [], url = null, components = new Map() } = {}) {
  const article = new Article(file, source, errors, folder, preamble, url, components);
  await parseArticle(article);
  indexTargets(article);
  return article;
}

class Article {
  constructor(file, source, errors, folder, preamble, url, components) {
    this.file = file;
    this.source = source;
    this.errors = errors;
    this.folder = folder;
    this.preamble = preamble;
    this.components = components;
    this.url = url;
    this.tree = null;
    this.targets = new Map();
    this.places = new Map();
    this.linked = new Map();
    this.borrowed = new Set();
    this.equations = new Map();
    this.equationIds = new Map();
    this.glyphs = undefined;
    this.images = new Map();
    this.image = undefined;
    this.anchors = new Map();
    this.definitions = new Map();
    this.sidenotes = new Map();
    this.recapLines = new Map();
    this.citations = new Map();
    this.references = [];
    this.context = {
      sidenoteNumber: (identifier) => this.sidenotes.get(identifier).number,
      citationNumber: (key) => this.citations.get(key),
      references: () => this.references,
      equation: (label) => this.equations.get(label),
      highlighter: null,
      root: url === null ? '' : pageRoot(url),
      excerpt: undefined,
      linked: (target) => this.linked.set(target.address.text, target),
      embed: (node) => embedParts(this, node),
    };
  }

  report(position, message) {
    this.errors.push(errorAt(this.file, position, message));
  }

  positionAt(offset) {
    const before = this.source.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    return { line: before.split('\n').length, column: offset - lineStart + 1, offset };
  }

  hasTarget(anchor) {
    return this.targets.has(anchor);
  }

  link(site, errors) {
    linkArticle(this, site, errors);
  }

  structure() {
    return articleStructure(this);
  }
}
