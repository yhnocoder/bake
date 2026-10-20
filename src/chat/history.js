export const HISTORY_LIMIT = 50;

export function historyKey(root) {
  return `bk-chat-history:${new URL(root).pathname}`;
}

export function readHistory(root, { storage = globalThis.localStorage } = {}) {
  try {
    const value = JSON.parse(storage.getItem(historyKey(root)) ?? '[]');
    return Array.isArray(value) ? value.filter(isConversation) : [];
  } catch {
    return [];
  }
}

export function saveConversation(root, conversation, { storage = globalThis.localStorage } = {}) {
  let list = [conversation, ...readHistory(root, { storage }).filter((item) => item.id !== conversation.id)].slice(0, HISTORY_LIMIT);
  for (;;) {
    try {
      storage.setItem(historyKey(root), JSON.stringify(list));
      return true;
    } catch {
      if (list.length === 1) return false;
      list = list.slice(0, -1);
    }
  }
}

export function deleteConversation(root, id, { storage = globalThis.localStorage } = {}) {
  const list = readHistory(root, { storage }).filter((item) => item.id !== id);
  try {
    storage.setItem(historyKey(root), JSON.stringify(list));
  } catch {}
  return list;
}

export function historyGroups(list, { address, home }) {
  if (!home) return [{ article: null, items: list.filter((item) => item.article?.address === address) }].filter((group) => group.items.length > 0);
  const groups = new Map();
  for (const item of list) {
    const key = item.article?.address ?? null;
    if (!groups.has(key)) groups.set(key, { article: item.article, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

export function storedRound(message) {
  return {
    ask: message.ask,
    content: message.content,
    reasoning: message.reasoning,
    reads: message.reads.map(({ label, url, failed }) => ({ label, url, failed, done: true })),
  };
}

export function roundMessages(round) {
  return [
    { role: 'user', ...round.ask.bubble },
    { role: 'assistant', content: round.content, reasoning: round.reasoning, reads: round.reads, error: null, done: true, ask: round.ask, sent: [{ role: 'assistant', content: round.content }] },
  ];
}

export function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isConversation(item) {
  return item !== null && typeof item === 'object' && typeof item.id === 'string' && Array.isArray(item.rounds) && item.rounds.length > 0;
}
