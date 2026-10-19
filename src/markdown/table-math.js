const PIPE = '|';
const BACKSLASH = '\\';
const BACKTICK = '`';
const DOLLAR = '$';
const PROTECTED_PIPE = '';
const VALUE_FIELDS = ['value', 'url', 'title', 'alt', 'label'];

export function protectPipesInMath(source) {
  return source
    .split('\n')
    .map((line) => (line.includes(PIPE) && line.includes(DOLLAR) ? protectLine(line) : line))
    .join('\n');
}

export function restorePipesInMath(node) {
  for (const field of VALUE_FIELDS) {
    if (typeof node[field] === 'string') node[field] = node[field].replaceAll(PROTECTED_PIPE, PIPE);
  }
  for (const child of node.children ?? []) restorePipesInMath(child);
}

function protectLine(line) {
  const characters = [...line];
  let index = 0;
  while (index < characters.length) {
    const character = characters[index];
    if (character === BACKSLASH) {
      index += 2;
    } else if (character === BACKTICK || character === DOLLAR) {
      const size = runLength(characters, index, character);
      const close = findRun(characters, index + size, character, size);
      if (close === -1) {
        index += size;
        continue;
      }
      if (character === DOLLAR) {
        for (let inner = index + size; inner < close; inner++) {
          if (characters[inner] === PIPE) characters[inner] = PROTECTED_PIPE;
        }
      }
      index = close + size;
    } else {
      index++;
    }
  }
  return characters.join('');
}

function runLength(characters, start, character) {
  let end = start;
  while (characters[end] === character) end++;
  return end - start;
}

function findRun(characters, from, character, size) {
  let index = from;
  while (index < characters.length) {
    if (characters[index] !== character) {
      index++;
      continue;
    }
    const length = runLength(characters, index, character);
    if (length === size) return index;
    index += length;
  }
  return -1;
}
