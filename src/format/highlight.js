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
import { codes, constants, types } from 'micromark-util-symbol';

const sequenceSize = 2;

const constructsWithoutHighlight = [
  'autolink',
  'destinationLiteral',
  'destinationRaw',
  'reference',
  'titleQuote',
  'titleApostrophe',
];

export function highlightSyntax() {
  const tokenizer = { name: 'highlight', tokenize: tokenizeHighlight, resolveAll: resolveAllHighlight };
  return {
    text: { [codes.equalsTo]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.equalsTo] },
  };
}

function resolveAllHighlight(events, context) {
  let index = -1;
  while (++index < events.length) {
    const event = events[index];
    if (event[0] !== 'enter' || event[1].type !== 'highlightSequenceTemporary' || !event[1]._close) continue;
    let open = index;
    while (open--) {
      const candidate = events[open];
      if (candidate[0] !== 'exit' || candidate[1].type !== 'highlightSequenceTemporary' || !candidate[1]._open) continue;
      event[1].type = 'highlightSequence';
      candidate[1].type = 'highlightSequence';
      const highlight = { type: 'highlight', start: { ...candidate[1].start }, end: { ...event[1].end } };
      const text = { type: 'highlightText', start: { ...candidate[1].end }, end: { ...event[1].start } };
      const nextEvents = [
        ['enter', highlight, context],
        ['enter', candidate[1], context],
        ['exit', candidate[1], context],
        ['enter', text, context],
      ];
      const insideSpan = context.parser.constructs.insideSpan.null;
      if (insideSpan) splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
      splice(nextEvents, nextEvents.length, 0, [
        ['exit', text, context],
        ['enter', event[1], context],
        ['exit', event[1], context],
        ['exit', highlight, context],
      ]);
      splice(events, open - 1, index - open + 3, nextEvents);
      index = open + nextEvents.length - 2;
      break;
    }
  }
  for (const event of events) {
    if (event[1].type === 'highlightSequenceTemporary') event[1].type = types.data;
  }
  return events;
}

function tokenizeHighlight(effects, ok, nok) {
  const { now, sliceSerialize, previous: tentativePrevious } = this;
  const previous = isCodeLowSurrogate(tentativePrevious)
    ? tryGetGenuinePreviousCode(tentativePrevious, now(), sliceSerialize)
    : tentativePrevious;
  const before = classifyCharacter(previous);
  const twoPrevious = new TwoPreviousCode(previous, now(), sliceSerialize);
  const beforePrimary = classifyPrecedingCharacter(before, twoPrevious.value.bind(twoPrevious), previous);
  const events = this.events;
  let size = 0;
  return start;

  function start(code) {
    if (previous === codes.equalsTo && events[events.length - 1][1].type !== types.characterEscape) return nok(code);
    effects.enter('highlightSequenceTemporary');
    return more(code);
  }

  function more(code) {
    if (code === codes.equalsTo) {
      if (size === sequenceSize) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < sequenceSize) return nok(code);
    const token = effects.exit('highlightSequenceTemporary');
    const after = classifyCharacter(isCodeHighSurrogate(code) ? tryGetGenuineNextCode(code, now(), sliceSerialize) : code);
    const beforeSpaceOrNonCjkPunctuation = isNonCjkPunctuation(beforePrimary) || isUnicodeWhitespace(beforePrimary);
    const afterSpaceOrNonCjkPunctuation = isNonCjkPunctuation(after) || isUnicodeWhitespace(after);
    const beforeCjkOrIvs = isCjk(beforePrimary) || isIvs(before);
    token._open =
      !afterSpaceOrNonCjkPunctuation ||
      (after === constants.attentionSideAfter && (beforeSpaceOrNonCjkPunctuation || beforeCjkOrIvs));
    token._close =
      !beforeSpaceOrNonCjkPunctuation ||
      (before === constants.attentionSideAfter && (afterSpaceOrNonCjkPunctuation || isCjk(after)));
    return ok(code);
  }
}

export function highlightFromMarkdown() {
  return {
    canContainEols: ['mark'],
    enter: {
      highlight(token) {
        this.enter({ type: 'mark', children: [] }, token);
      },
    },
    exit: {
      highlight(token) {
        this.exit(token);
      },
    },
  };
}

function handleMark(node, _, state, info) {
  const tracker = state.createTracker(info);
  const exit = state.enter('mark');
  let value = tracker.move('==');
  value += state.containerPhrasing(node, { ...tracker.current(), before: value, after: '=' });
  value += tracker.move('==');
  exit();
  return value;
}

handleMark.peek = () => '=';

export function highlightToMarkdown() {
  return {
    handlers: { mark: handleMark },
    unsafe: [
      { character: '=', after: '=\\S', inConstruct: 'phrasing', notInConstruct: constructsWithoutHighlight },
      { character: '=', before: '\\S', after: '=', inConstruct: 'phrasing', notInConstruct: constructsWithoutHighlight },
    ],
  };
}

export default function remarkHighlight() {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(highlightSyntax());
  (data.fromMarkdownExtensions ??= []).push(highlightFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(highlightToMarkdown());
}
