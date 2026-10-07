import { editorStateTimerCtx, ParserReady, parserCtx, remarkCtx, schemaCtx } from '@milkdown/core';
import { createTimer } from '@milkdown/ctx';
import { ParserState } from '@milkdown/transformer';
import { checkOrder } from './structure.js';

function requireValid(type, attrs, content) {
  const node = type.createAndFill(attrs, content);
  if (!node || !checkOrder(node)) throw new Error(`Invalid content in ${type.name}`);
}

class StrictParserState extends ParserState {
  constructor(schema) {
    super(schema);
    const { closeNode, addNode } = this;
    this.closeNode = () => {
      const { type, attrs, content } = this.top();
      requireValid(type, attrs, content);
      return closeNode();
    };
    this.addNode = (type, attrs, content) => {
      requireValid(type, attrs, content);
      return addNode(type, attrs, content);
    };
  }
}

function strictParser(schema, remark) {
  return (markdown) => {
    const state = new StrictParserState(schema);
    state.run(remark, markdown);
    const doc = state.toDoc();
    if (!checkOrder(doc)) throw new Error('Invalid content in doc');
    return doc;
  };
}

const StrictParserReady = createTimer('StrictParserReady');

export function strictParsing(ctx) {
  ctx.record(StrictParserReady).update(editorStateTimerCtx, (timers) => [...timers, StrictParserReady]);
  return async () => {
    await ctx.wait(ParserReady);
    ctx.set(parserCtx, strictParser(ctx.get(schemaCtx), ctx.get(remarkCtx)));
    ctx.done(StrictParserReady);
    return () => ctx.clearTimer(StrictParserReady);
  };
}
