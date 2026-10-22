import { errorAt } from '../shared/report.js';
import { pageRoot } from '../shared/urls.js';
import { embedParts, indexTargets, linkArticle } from './link.js';
import { parseArticle } from './parse.js';
import { articleStructure } from './structure.js';

export async function readArticle(file, source, errors, options) {
  const article = new Article(file, source, errors, options);
  await parseArticle(article);
  indexTargets(article);
  return article;
}

class Article {
  constructor(file, source, errors, options) {
    const { folder = null, url = null } = options;
    // The input of the article.
    this.file = file;
    this.source = source;
    this.errors = errors;
    this.options = options;
    this.folder = folder;
    this.url = url;
    // parseArticle: the tree, once all its stages have run.
    this.tree = null;
    // The parse stage readBlocksAndAnchors.
    this.anchors = new Map();
    // The parse stage readFootnotes.
    this.definitions = new Map();
    this.sidenotes = new Map();
    // The parse stage readCitations.
    this.citations = new Map();
    this.references = [];
    // The parse stage renderMath.
    this.equations = new Map();
    this.equationIds = new Map();
    this.glyphs = undefined;
    // The parse stage readImages.
    this.images = new Map();
    this.image = undefined;
    // indexTargets, after parseArticle.
    this.targets = new Map();
    this.places = new Map();
    // articleStructure, which clears them first because it runs again when a linked article changes.
    this.linked = new Map();
    this.borrowed = new Set();
    this.recapLines = new Map();
    // What rendering reads; the parse stage loadCodeLanguages writes the highlighter.
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

  // The theme, the preamble and the components are read only by the parts of an article that use them, so that the build knows which articles depend on them.
  get theme() {
    return this.options.theme;
  }

  get preamble() {
    return this.options.preamble ?? [];
  }

  get components() {
    return this.options.components ?? new Map();
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
    return linkArticle(this, site, errors);
  }

  structure(errors) {
    this.errors = errors;
    return articleStructure(this);
  }
}
