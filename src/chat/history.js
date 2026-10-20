export const HISTORY_LIMIT = 50;
export const HISTORY_CHARACTERS = 1_000_000;
export const NOTE_VERSION_LIMIT = 10;

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
  let length = JSON.stringify(list).length;
  while (list.length > 1 && length > HISTORY_CHARACTERS) {
    length -= JSON.stringify(list.at(-1)).length + 1;
    list = list.slice(0, -1);
  }
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
    reads: message.reads.map(({ label, url, failed }) => ({ label, url, failed, done: true })),
  };
}

export function roundMessages(round) {
  return [
    { role: 'user', ...round.ask.bubble },
    { role: 'assistant', content: round.content, reasoning: '', reads: round.reads, error: null, done: true, ask: round.ask, sent: [{ role: 'assistant', content: round.content }] },
  ];
}

export function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isConversation(item) {
  return (
    isObject(item) &&
    typeof item.id === 'string' &&
    typeof item.date === 'string' &&
    (item.article === null || (isObject(item.article) && isAddress(item.article.address) && typeof item.article.title === 'string')) &&
    Array.isArray(item.rounds) &&
    item.rounds.length > 0 &&
    item.rounds.every(isRound) &&
    (item.note === null || isNote(item.note))
  );
}

function isRound(round) {
  return (
    isObject(round) &&
    isObject(round.ask) &&
    typeof round.ask.content === 'string' &&
    Array.isArray(round.ask.scopes) &&
    round.ask.scopes.every((scope) => isObject(scope) && typeof scope.kind === 'string' && Array.isArray(scope.urls) && scope.urls.every((url) => typeof url === 'string')) &&
    isObject(round.ask.bubble) &&
    typeof round.ask.bubble.text === 'string' &&
    (round.ask.bubble.quote === null || typeof round.ask.bubble.quote === 'string') &&
    Array.isArray(round.ask.bubble.scopes) &&
    round.ask.bubble.scopes.every((label) => typeof label === 'string') &&
    typeof round.content === 'string' &&
    Array.isArray(round.reads) &&
    round.reads.every((read) => isObject(read) && typeof read.label === 'string' && typeof read.url === 'string')
  );
}

function isNote(note) {
  return (
    isObject(note) &&
    Array.isArray(note.versions) &&
    note.versions.length > 0 &&
    note.versions.every((version) => isObject(version) && typeof version.markdown === 'string' && Number.isInteger(version.rounds) && Number.isInteger(version.articles) && typeof version.date === 'string' && (version.request === null || typeof version.request === 'string')) &&
    Number.isInteger(note.index) &&
    note.index >= 0 &&
    note.index < note.versions.length
  );
}

function isAddress(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
