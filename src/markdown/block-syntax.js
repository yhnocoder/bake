import { parse, postprocess, preprocess } from 'micromark';
import { factorySpace } from 'micromark-factory-space';
import { asciiAlpha, asciiAlphanumeric, markdownLineEnding } from 'micromark-util-character';

const COLON = 58;
const DASH = 45;
const UNDERSCORE = 95;
const LEFT_BRACE = 123;
const RIGHT_BRACE = 125;
const QUOTE = 34;
const APOSTROPHE = 39;
const CODE_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

const blockConstruct = { tokenize: tokenizeBlock, concrete: true };
const nonLazyLine = { tokenize: tokenizeNonLazyLine, partial: true };

function isCodeLine(lines, lineNumber) {
  const events = postprocess(parse().document().write(preprocess()(lines.join('\n'), undefined, true)));
  return events.some(([kind, token]) => kind === 'enter' && token.type === 'codeFlowValue' && token.start.line === lineNumber);
}

export function bakeBlocks() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({ flow: { [COLON]: [blockConstruct] } });
  (data.fromMarkdownExtensions ??= []).push(blockFromMarkdown);
}

const blockFromMarkdown = {
  enter: {
    bakeBlock(token) {
      this.enter({ type: 'bakeBlock', info: '', children: [] }, token);
    },
  },
  exit: {
    bakeBlockSequence(token) {
      this.stack.at(-1).colons ??= this.sliceSerialize(token).length;
    },
    bakeBlockInfo(token) {
      this.stack.at(-1).info = this.sliceSerialize(token);
    },
    bakeBlockClosingFence() {
      this.stack.at(-1).closed = true;
    },
    bakeBlock(token) {
      this.exit(token);
    },
  },
};

function tokenizeBlock(effects, ok, nok) {
  const self = this;
  const tail = self.events.at(-1);
  const initialSize = tail && tail[1].type === 'linePrefix' ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let sizeOpen = 0;
  let previous;
  let quote;
  let line = '';
  const lines = [];
  let codeFence = null;
  return start;

  function start(code) {
    effects.enter('bakeBlock');
    effects.enter('bakeBlockFence');
    effects.enter('bakeBlockSequence');
    return sequenceOpen(code);
  }

  function sequenceOpen(code) {
    if (code === COLON) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen < 3 || !(asciiAlpha(code) || code === LEFT_BRACE)) return nok(code);
    effects.exit('bakeBlockSequence');
    effects.enter('bakeBlockInfo');
    return asciiAlpha(code) ? name(code) : attributesStart(code);
  }

  function name(code) {
    if (asciiAlphanumeric(code) || code === DASH || code === UNDERSCORE) {
      effects.consume(code);
      return name;
    }
    return code === LEFT_BRACE ? attributesStart(code) : infoEnd(code);
  }

  function attributesStart(code) {
    effects.consume(code);
    return attributes;
  }

  function attributes(code) {
    if (code === null || markdownLineEnding(code)) return nok(code);
    effects.consume(code);
    if (code === RIGHT_BRACE) return infoEnd;
    if (code === QUOTE || code === APOSTROPHE) {
      quote = code;
      return quoted;
    }
    return attributes;
  }

  function quoted(code) {
    if (code === null || markdownLineEnding(code)) return nok(code);
    effects.consume(code);
    return code === quote ? attributes : quoted;
  }

  function infoEnd(code) {
    effects.exit('bakeBlockInfo');
    return factorySpace(effects, fenceEnd, 'whitespace')(code);
  }

  function fenceEnd(code) {
    if (code !== null && !markdownLineEnding(code)) return nok(code);
    effects.exit('bakeBlockFence');
    return openAfter(code);
  }

  function openAfter(code) {
    if (code === null) return after(code);
    if (self.interrupt) return ok(code);
    return effects.attempt(nonLazyLine, contentStart, after)(code);
  }

  function contentStart(code) {
    if (code === null) return after(code);
    if (markdownLineEnding(code)) return effects.check(nonLazyLine, emptyContentNonLazyLineAfter, after)(code);
    effects.enter('bakeBlockContent');
    return lineStart(code);
  }

  function lineStart(code) {
    const content = initialSize ? factorySpace(effects, chunkStart, 'linePrefix', initialSize + 1) : chunkStart;
    const closingFence = { tokenize: tokenizeClosingFence, partial: true };
    if (codeFence === null) return effects.attempt(closingFence, afterContent, content)(code);
    return effects.check(closingFence, closingFenceOutsideCode, content)(code);

    function closingFenceOutsideCode(code) {
      if (isCodeLine([...lines, ':'.repeat(sizeOpen)], lines.length + 1)) return content(code);
      return effects.attempt(closingFence, afterContent, content)(code);
    }
  }

  function trackCodeFence() {
    lines.push(line);
    const match = CODE_FENCE_LINE.exec(line);
    line = '';
    if (!match) return;
    const [, fence, rest] = match;
    if (codeFence === null) {
      if (!(fence[0] === '`' && rest.includes('`'))) codeFence = fence;
    } else if (fence[0] === codeFence[0] && fence.length >= codeFence.length && rest.trim() === '') {
      codeFence = null;
    }
  }

  function chunkStart(code) {
    if (code === null) return afterContent(code);
    if (markdownLineEnding(code)) return effects.check(nonLazyLine, chunkNonLazyStart, afterContent)(code);
    return chunkNonLazyStart(code);
  }

  function contentContinue(code) {
    if (code === null) {
      const token = effects.exit('chunkDocument');
      self.parser.lazy[token.start.line] = false;
      return afterContent(code);
    }
    if (markdownLineEnding(code)) {
      trackCodeFence();
      return effects.check(nonLazyLine, nonLazyLineAfter, lineAfter)(code);
    }
    line += code < 0 ? ' ' : String.fromCodePoint(code);
    effects.consume(code);
    return contentContinue;
  }

  function chunkNonLazyStart(code) {
    const token = effects.enter('chunkDocument', { contentType: 'document', previous });
    if (previous) previous.next = token;
    previous = token;
    return contentContinue(code);
  }

  function emptyContentNonLazyLineAfter(code) {
    effects.enter('bakeBlockContent');
    return lineStart(code);
  }

  function nonLazyLineAfter(code) {
    effects.consume(code);
    const token = effects.exit('chunkDocument');
    self.parser.lazy[token.start.line] = false;
    return lineStart;
  }

  function lineAfter(code) {
    const token = effects.exit('chunkDocument');
    self.parser.lazy[token.start.line] = false;
    return afterContent(code);
  }

  function afterContent(code) {
    effects.exit('bakeBlockContent');
    return after(code);
  }

  function after(code) {
    effects.exit('bakeBlock');
    return ok(code);
  }

  function tokenizeClosingFence(effects, ok, nok) {
    let size = 0;
    const indentLimit = self.parser.constructs.disable.null.includes('codeIndented') ? undefined : 4;
    return factorySpace(effects, closingPrefixAfter, 'linePrefix', indentLimit);

    function closingPrefixAfter(code) {
      effects.enter('bakeBlockClosingFence');
      effects.enter('bakeBlockSequence');
      return closingSequence(code);
    }

    function closingSequence(code) {
      if (code === COLON) {
        effects.consume(code);
        size++;
        return closingSequence;
      }
      if (size < sizeOpen) return nok(code);
      effects.exit('bakeBlockSequence');
      return factorySpace(effects, closingSequenceEnd, 'whitespace')(code);
    }

    function closingSequenceEnd(code) {
      if (code === null || markdownLineEnding(code)) {
        effects.exit('bakeBlockClosingFence');
        return ok(code);
      }
      return nok(code);
    }
  }
}

function tokenizeNonLazyLine(effects, ok, nok) {
  const self = this;
  return start;

  function start(code) {
    effects.enter('lineEnding');
    effects.consume(code);
    effects.exit('lineEnding');
    return lineStart;
  }

  function lineStart(code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
  }
}
