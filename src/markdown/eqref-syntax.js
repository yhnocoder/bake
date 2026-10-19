import { markdownLineEndingOrSpace } from 'micromark-util-character';

const BACKSLASH = 92;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;
const COMMAND = 'eqref';

export function equationReferences() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ text: { [BACKSLASH]: { name: 'eqref', tokenize: tokenizeEqref } } });
  (data.fromMarkdownExtensions ??= []).push(eqrefFromMarkdown);
}

const eqrefFromMarkdown = {
  enter: {
    eqref(token) {
      this.enter({ type: 'eqref', label: '', value: this.sliceSerialize(token) }, token);
    },
  },
  exit: {
    eqrefLabel(token) {
      this.stack.at(-1).label = this.sliceSerialize(token);
    },
    eqref(token) {
      this.stack.at(-1).value = this.sliceSerialize(token);
      this.exit(token);
    },
  },
};

function tokenizeEqref(effects, ok, nok) {
  let matched = 0;
  let size = 0;
  return start;

  function start(code) {
    effects.enter('eqref');
    effects.enter('eqrefMarker');
    effects.consume(code);
    return command;
  }

  function command(code) {
    if (matched < COMMAND.length) {
      if (code !== COMMAND.codePointAt(matched)) return nok(code);
      effects.consume(code);
      matched++;
      return command;
    }
    if (code !== LEFT_BRACE) return nok(code);
    effects.consume(code);
    effects.exit('eqrefMarker');
    effects.enter('eqrefLabel');
    return label;
  }

  function label(code) {
    if (code === RIGHT_BRACE && size > 0) {
      effects.exit('eqrefLabel');
      effects.enter('eqrefMarker');
      effects.consume(code);
      effects.exit('eqrefMarker');
      effects.exit('eqref');
      return ok;
    }
    if (code === null || code === LEFT_BRACE || code === RIGHT_BRACE || markdownLineEndingOrSpace(code) || size > 999) return nok(code);
    effects.consume(code);
    size++;
    return label;
  }
}
