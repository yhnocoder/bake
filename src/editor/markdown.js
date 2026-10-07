import { remarkCtx, schemaCtx } from '@milkdown/core';
import { SerializerState } from '@milkdown/transformer';
import { placeFootnoteDefinitions } from '../format/footnotes.js';

export function docToMarkdown(ctx, doc) {
  const state = new SerializerState(ctx.get(schemaCtx));
  state.run(doc);
  const tree = state.build();
  placeFootnoteDefinitions(tree);
  return ctx.get(remarkCtx).stringify(tree);
}
