import {
  TwoPreviousCode,
  classifyCharacter,
  classifyPrecedingCharacter,
  isCjk,
  isCodeHighSurrogate,
  isCodeLowSurrogate,
  isIvs,
  isNonCjkPunctuation,
  isUnicodeWhitespace,
  tryGetGenuineNextCode,
  tryGetGenuinePreviousCode,
} from 'micromark-extension-cjk-friendly-util';
import { splice } from 'micromark-util-chunked';
import { resolveAll } from 'micromark-util-resolve-all';

const EQUALS = 61;
const ATTENTION_SIDE_AFTER = 2;
const SEQUENCE = '==';
const CONSTRUCTS_WITHOUT_HIGHLIGHT = ['autolink', 'destinationLiteral', 'destinationRaw', 'reference', 'titleQuote', 'titleApostrophe'];

export function highlight() {
  const data = this.data();
  const construct = { name: 'highlight', tokenize: tokenizeHighlight, resolveAll: resolveAllHighlight };
  (data.micromarkExtensions ??= []).push({
    text: { [EQUALS]: construct },
    insideSpan: { null: [construct] },
    attentionMarkers: { null: [EQUALS] },
  });
  (data.fromMarkdownExtensions ??= []).push(highlightFromMarkdown);
}

export const highlightToMarkdown = {
  unsafe: [
    { character: '=', before: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
    { character: '=', after: '=', inConstruct: 'phrasing', notInConstruct: CONSTRUCTS_WITHOUT_HIGHLIGHT },
  ],
  handlers: { highlight: writeHighlight },
};

function writeHighlight(node, _, state, info) {
  const tracker = state.createTracker(info);
  const exit = state.enter('highlight');
  let value = tracker.move(SEQUENCE);
  value += tracker.move(state.containerPhrasing(node, { ...tracker.current(), before: value, after: SEQUENCE[0] }));
  value += tracker.move(SEQUENCE);
  exit();
  return value;
}
writeHighlight.peek = () => SEQUENCE[0];

const highlightFromMarkdown = {
  enter: {
    highlight(token) {
      this.enter({ type: 'highlight', children: [], data: { hName: 'mark' } }, token);
    },
  },
  exit: {
    highlight(token) {
      this.exit(token);
    },
  },
};

function resolveAllHighlight(events, context) {
  let index = -1;
  while (++index < events.length) {
    if (events[index][0] !== 'enter' || events[index][1].type !== 'highlightSequenceTemporary' || !events[index][1]._close) continue;
    let open = index;
    while (open--) {
      if (events[open][0] !== 'exit' || events[open][1].type !== 'highlightSequenceTemporary' || !events[open][1]._open) continue;
      events[index][1].type = 'highlightSequence';
      events[open][1].type = 'highlightSequence';
      const whole = { type: 'highlight', start: { ...events[open][1].start }, end: { ...events[index][1].end } };
      const text = { type: 'highlightText', start: { ...events[open][1].end }, end: { ...events[index][1].start } };
      const next = [
        ['enter', whole, context],
        ['enter', events[open][1], context],
        ['exit', events[open][1], context],
        ['enter', text, context],
      ];
      const insideSpan = context.parser.constructs.insideSpan.null;
      if (insideSpan) splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
      splice(next, next.length, 0, [
        ['exit', text, context],
        ['enter', events[index][1], context],
        ['exit', events[index][1], context],
        ['exit', whole, context],
      ]);
      splice(events, open - 1, index - open + 3, next);
      index = open + next.length - 2;
      break;
    }
  }
  for (const event of events) {
    if (event[1].type === 'highlightSequenceTemporary') event[1].type = 'data';
  }
  return events;
}

function tokenizeHighlight(effects, ok, nok) {
  const { now, sliceSerialize, previous: tentativePrevious, events } = this;
  const previous = isCodeLowSurrogate(tentativePrevious) ? tryGetGenuinePreviousCode(tentativePrevious, now(), sliceSerialize) : tentativePrevious;
  const before = classifyCharacter(previous);
  const twoPrevious = new TwoPreviousCode(previous, now(), sliceSerialize);
  const beforePrimary = classifyPrecedingCharacter(before, twoPrevious.value.bind(twoPrevious), previous);
  let size = 0;
  return start;

  function start(code) {
    if (previous === EQUALS && events.at(-1)[1].type !== 'characterEscape') return nok(code);
    effects.enter('highlightSequenceTemporary');
    return more(code);
  }

  function more(code) {
    if (code === EQUALS) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit('highlightSequenceTemporary');
    const after = classifyCharacter(isCodeHighSurrogate(code) ? tryGetGenuineNextCode(code, now(), sliceSerialize) : code);
    const beforeSpaceOrPunctuation = isNonCjkPunctuation(beforePrimary) || isUnicodeWhitespace(beforePrimary);
    const afterSpaceOrPunctuation = isNonCjkPunctuation(after) || isUnicodeWhitespace(after);
    const beforeCjk = isCjk(beforePrimary) || isIvs(before);
    token._open = !afterSpaceOrPunctuation || (after === ATTENTION_SIDE_AFTER && (beforeSpaceOrPunctuation || beforeCjk));
    token._close = !beforeSpaceOrPunctuation || (before === ATTENTION_SIDE_AFTER && (afterSpaceOrPunctuation || isCjk(after)));
    return ok(code);
  }
}
