const PIPE = '|';
const BACKSLASH = '\\';
const BACKTICK = '`';
const DOLLAR = '$';
const PRIVATE_USE_START = 0xe000;
const PRIVATE_USE_END = 0xf8ff;

export function protectPipesInMath(source) {
  const lines = source.split('\n');
  const pipes = lines.map((line) => (line.includes(PIPE) && line.includes(DOLLAR) ? pipesInMath([...line]) : []));
  const first = pipes.findIndex((indexes) => indexes.length > 0);
  if (first === -1) return { text: source, sentinel: null };
  const sentinel = unusedPrivateUseCharacter(source);
  if (sentinel === null) return { text: source, sentinel: null, unreadLine: first + 1 };
  const text = lines
    .map((line, index) => {
      const characters = [...line];
      for (const pipe of pipes[index]) characters[pipe] = sentinel;
      return characters.join('');
    })
    .join('\n');
  return { text, sentinel };
}

export function restorePipesInMath(value, sentinel) {
  if (sentinel === null) return value;
  if (typeof value === 'string') return value.replaceAll(sentinel, PIPE);
  if (Array.isArray(value)) return value.map((item) => restorePipesInMath(item, sentinel));
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (key !== 'position') value[key] = restorePipesInMath(value[key], sentinel);
  }
  return value;
}

function unusedPrivateUseCharacter(source) {
  for (let code = PRIVATE_USE_START; code <= PRIVATE_USE_END; code++) {
    const character = String.fromCharCode(code);
    if (!source.includes(character)) return character;
  }
  return null;
}

function pipesInMath(characters) {
  const pipes = [];
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
          if (characters[inner] === PIPE) pipes.push(inner);
        }
      }
      index = close + size;
    } else {
      index++;
    }
  }
  return pipes;
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
