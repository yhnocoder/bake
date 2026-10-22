import { chatBundle } from '../chat/bundle.js';

export function compileChat(site) {
  return site.memo.get('chat', null, () => chatBundle());
}

export function assetOutputs(themes, bundle, chat) {
  const outputs = new Map();
  const add = (files, owner) => {
    for (const file of files) {
      if (!outputs.has(file.path)) outputs.set(file.path, { path: file.path, render: () => file.source, owner });
    }
  };
  for (const [name, theme] of themes) add(theme?.files ?? [], `the ${name} theme`);
  add(bundle?.files ?? [], 'the components');
  add(chat.files, 'the AI chat');
  return [...outputs.values()];
}
