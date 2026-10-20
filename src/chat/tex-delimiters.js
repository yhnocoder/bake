import { markdownLineEnding } from 'micromark-util-character';

const BACKSLASH = 92;
const CLOSING = { 40: 41, 91: 93 };

export function texDelimiters() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text: { [BACKSLASH]: { name: 'texDelimiters', tokenize: tokenizeTex } } });
  (data.fromMarkdownExtensions ??= []).push(texFromMarkdown);
}

const texFromMarkdown = {
  enter: {
    texDelimited(token) {
      const source = this.sliceSerialize(token);
      this.enter({ type: 'inlineMath', value: source.slice(2, -2).trim(), data: { display: source[1] === '[' } }, token);
    },
  },
  exit: {
    texDelimited(token) {
      this.exit(token);
    },
  },
};

function tokenizeTex(effects, ok, nok) {
  let closing;
  let size = 0;
  return start;

  function start(code) {
    effects.enter('texDelimited');
    effects.enter('texDelimitedMarker');
    effects.consume(code);
    return open;
  }

  function open(code) {
    closing = CLOSING[code];
    if (closing === undefined) return nok(code);
    effects.consume(code);
    effects.exit('texDelimitedMarker');
    effects.enter('texDelimitedValue');
    return content;
  }

  function content(code) {
    if (code === null) return nok(code);
    if (markdownLineEnding(code)) {
      effects.exit('texDelimitedValue');
      effects.enter('lineEnding');
      effects.consume(code);
      effects.exit('lineEnding');
      effects.enter('texDelimitedValue');
      return content;
    }
    if (code === BACKSLASH) {
      effects.consume(code);
      return escaped;
    }
    effects.consume(code);
    size++;
    return content;
  }

  function escaped(code) {
    if (code === closing) {
      if (size === 0) return nok(code);
      effects.consume(code);
      effects.exit('texDelimitedValue');
      effects.exit('texDelimited');
      return ok;
    }
    if (code === null || markdownLineEnding(code)) return content(code);
    effects.consume(code);
    size += 2;
    return content;
  }
}
