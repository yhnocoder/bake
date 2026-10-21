const PIPE = '|';
const BACKSLASH = '\\';
const BACKTICK = '`';
const DOLLAR = '$';
// why: a lone surrogate never occurs in text decoded from UTF-8, so it stands for a | inside $…$ that the table parser must not read as a cell border
const SENTINEL = '\uDFFF';

export function parseWithPipesInMath(processor, source) {
  const lines = source.split('\n');
  const pipes = lines.map((line) => (line.includes(PIPE) && line.includes(DOLLAR) ? pipesInMath([...line]) : []));
  if (pipes.every((indexes) => indexes.length === 0)) return processor.parse(source);
  const text = lines
    .map((line, index) => {
      const characters = [...line];
      for (const pipe of pipes[index]) characters[pipe] = SENTINEL;
      return characters.join('');
    })
    .join('\n');
  return restorePipes(processor.parse(text));
}

function restorePipes(value) {
  if (typeof value === 'string') return value.replaceAll(SENTINEL, PIPE);
  if (Array.isArray(value)) return value.map(restorePipes);
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value)) {
    if (key !== 'position') value[key] = restorePipes(value[key]);
  }
  return value;
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
