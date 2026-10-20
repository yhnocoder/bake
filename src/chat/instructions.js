export const INSTRUCTIONS_KEY = 'bk-chat-instructions';
export const RULES_KEYS = { chat: 'bk-chat-rules', note: 'bk-chat-note-rules' };
export const MAX_INSTRUCTIONS = 2000;
export const MAX_RULES = 8000;

export function readPrompts() {
  return { instructions: stored(INSTRUCTIONS_KEY) ?? '', chat: stored(RULES_KEYS.chat), note: stored(RULES_KEYS.note) };
}

export function savePrompts({ instructions, chat, note }, builtIn) {
  const prompts = { instructions: instructions.trim().slice(0, MAX_INSTRUCTIONS), chat: ownRules(chat, builtIn.chat), note: ownRules(note, builtIn.note) };
  const saved = store(INSTRUCTIONS_KEY, prompts.instructions === '' ? null : prompts.instructions) && store(RULES_KEYS.chat, prompts.chat) && store(RULES_KEYS.note, prompts.note);
  return saved ? prompts : null;
}

export function customPrompts(prompts) {
  return prompts.instructions !== '' || prompts.chat !== null || prompts.note !== null;
}

function ownRules(text, builtIn) {
  const value = text.trim().slice(0, MAX_RULES);
  return value === '' || value === builtIn ? null : value;
}

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function instructionLines(text) {
  return text === '' ? [] : ['The reader asks you to follow these instructions as well, unless they conflict with the rules above:', '<reader-instructions>', text, '</reader-instructions>'];
}
