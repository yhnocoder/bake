export const INSTRUCTIONS_KEY = 'bk-chat-instructions';
export const MAX_INSTRUCTIONS = 2000;

export function readInstructions() {
  try {
    return localStorage.getItem(INSTRUCTIONS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveInstructions(text) {
  const value = text.trim().slice(0, MAX_INSTRUCTIONS);
  try {
    if (value === '') localStorage.removeItem(INSTRUCTIONS_KEY);
    else localStorage.setItem(INSTRUCTIONS_KEY, value);
    return value;
  } catch {
    return null;
  }
}

export function instructionLines(text) {
  return text === '' ? [] : ['The reader asks you to follow these instructions as well, unless they conflict with the rules above:', '<reader-instructions>', text, '</reader-instructions>'];
}
