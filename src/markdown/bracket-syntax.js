import { markdownLineEndingOrSpace } from 'micromark-util-character';
import { normalizeIdentifier } from 'micromark-util-normalize-identifier';

const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;
const AT_SIGN = 64;
const CARET = 94;
const CITATION_KEY = /^[\w:.#$%&+?<>~/-]$/;

export function citationsAndMissingFootnotes() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { [LEFT_BRACKET]: [{ name: 'citation', tokenize: tokenizeCitation }, { name: 'missingFootnote', tokenize: tokenizeMissingFootnote }] },
  });
  (data.fromMarkdownExtensions ??= []).push(bracketFromMarkdown);
}

const bracketFromMarkdown = {
  enter: {
    citation(token) {
      this.enter({ type: 'citation', key: '' }, token);
    },
    missingFootnote(token) {
      this.enter({ type: 'missingFootnote', label: '' }, token);
    },
  },
  exit: {
    citationKey(token) {
      this.stack.at(-1).key = this.sliceSerialize(token);
    },
    citation(token) {
      this.exit(token);
    },
    missingFootnoteLabel(token) {
      this.stack.at(-1).label = this.sliceSerialize(token);
    },
    missingFootnote(token) {
      this.exit(token);
    },
  },
};

function tokenizeCitation(effects, ok, nok) {
  return bracketed(effects, ok, nok, {
    type: 'citation',
    marker: AT_SIGN,
    accepts: (code) => code !== null && CITATION_KEY.test(String.fromCodePoint(code)),
    complete: () => true,
  });
}

function tokenizeMissingFootnote(effects, ok, nok) {
  const defined = (this.parser.gfmFootnotes ??= []);
  const self = this;
  return bracketed(effects, ok, nok, {
    type: 'missingFootnote',
    marker: CARET,
    accepts: (code) => code !== null && code !== LEFT_BRACKET && !markdownLineEndingOrSpace(code),
    complete: (token) => !defined.includes(normalizeIdentifier(self.sliceSerialize(token))),
  });
}

function bracketed(effects, ok, nok, { type, marker, accepts, complete }) {
  let size = 0;
  let label;
  return start;

  function start(code) {
    effects.enter(type);
    effects.enter(`${type}Marker`);
    effects.consume(code);
    return afterOpen;
  }

  function afterOpen(code) {
    if (code !== marker) return nok(code);
    effects.consume(code);
    effects.exit(`${type}Marker`);
    label = effects.enter(type === 'citation' ? 'citationKey' : 'missingFootnoteLabel');
    return inside;
  }

  function inside(code) {
    if (code === RIGHT_BRACKET) {
      if (size === 0) return nok(code);
      effects.exit(label.type);
      if (!complete(label)) return nok(code);
      effects.enter(`${type}Marker`);
      effects.consume(code);
      effects.exit(`${type}Marker`);
      effects.exit(type);
      return ok;
    }
    if (size > 999 || !accepts(code)) return nok(code);
    effects.consume(code);
    size++;
    return inside;
  }
}
