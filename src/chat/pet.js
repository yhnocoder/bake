import { readerPetSheet, storedReaderPet } from './reader-pet.js';

const PET_ROWS = {
  idle: { row: 0, frames: 6 },
  waving: { row: 3, frames: 4 },
  jumping: { row: 4, frames: 5 },
  failed: { row: 5, frames: 8 },
  waiting: { row: 6, frames: 6 },
  running: { row: 7, frames: 6 },
  review: { row: 8, frames: 6 },
};

const PET_STATES = {
  idle: { animation: 'idle', play: 'still' },
  greet: { animation: 'waving', play: 'once' },
  open: { animation: 'idle', play: 'once' },
  answering: { animation: 'running', play: 'loop' },
  reading: { animation: 'review', play: 'loop' },
  unlocking: { animation: 'waiting', play: 'loop' },
  answered: { animation: 'jumping', play: 'once' },
  failed: { animation: 'failed', play: 'hold' },
};

export function petSource(root) {
  const site = { frame: `${root}_bake/pet/frame.webp`, sheet: `${root}_bake/pet/spritesheet.webp`, rows: 9 };
  const reader = storedReaderPet();
  let sheet = null;
  return {
    frame: reader?.frame ?? site.frame,
    reader: reader !== null,
    sheet: () =>
      (sheet ??=
        reader === null
          ? Promise.resolve(site)
          : readerPetSheet(reader.url).catch((error) => {
              console.warn(`bake chat: the chosen pet cannot be loaded, showing the pet of the site: ${error.message}`);
              return site;
            })),
  };
}

export function createPet(initial) {
  let source = initial;
  const element = document.createElement('span');
  element.className = 'bk-chat-pet';
  element.setAttribute('aria-hidden', 'true');
  const frame = image('bk-chat-pet-frame', source.frame);
  const sheet = image('bk-chat-pet-sheet', null);
  element.append(frame, sheet);
  let cycle = 0;
  let loading = null;

  const setState = (name) => {
    const state = PET_STATES[name] ?? PET_STATES.idle;
    const { row, frames } = PET_ROWS[state.animation];
    cycle = 1 - cycle;
    element.dataset.state = Object.hasOwn(PET_STATES, name) ? name : 'idle';
    element.dataset.play = `${state.play}-${cycle}`;
    element.style.setProperty('--bk-chat-pet-row', row);
    element.style.setProperty('--bk-chat-pet-frames', frames);
  };
  const load = () =>
    (loading ??= source
      .sheet()
      .then(async ({ sheet: url, rows }) => {
        sheet.src = url;
        await sheet.decode();
        element.style.setProperty('--bk-chat-pet-sheet-rows', rows);
        element.toggleAttribute('data-ready', true);
      })
      .catch((error) => console.warn(`bake chat: the pet spritesheet cannot be loaded: ${error.message}`)));

  sheet.addEventListener('animationend', () => {
    if (PET_STATES[element.dataset.state].play === 'once') setState('idle');
  });
  const setSource = (next) => {
    const wasLoading = loading !== null;
    source = next;
    loading = null;
    element.toggleAttribute('data-ready', false);
    frame.src = source.frame;
    if (sheet.src.startsWith('blob:')) URL.revokeObjectURL(sheet.src);
    sheet.removeAttribute('src');
    if (wasLoading) load();
  };

  setState('idle');
  return { element, setState, load, setSource };
}

function image(className, src) {
  const element = document.createElement('img');
  element.className = className;
  element.alt = '';
  element.draggable = false;
  element.decoding = 'async';
  if (src !== null) element.src = src;
  return element;
}
