import styles from './entry.css?inline';
import { chatLabels } from './labels.js';
import petStyles from './pet.css?inline';
import { createPet, petSource } from './pet.js';
import { ARTICLE_REGION, selectedRange } from './selection.js';
import { passkeysAvailable } from './vault.js';

const ASK_GAP = 8;
const EDGE = 12;

if (await passkeysAvailable()) startChat(new URL('../', import.meta.url).href);

function startChat(root) {
  const labels = chatLabels(document.documentElement.lang);
  const host = document.createElement('div');
  host.dataset.bakeChat = '';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${styles}\n${petStyles}`;
  const pet = createPet(petSource(root));
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'bk-chat-launcher';
  launcher.setAttribute('aria-label', labels.open);
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.append(pet.element);
  const ask = button('bk-chat-ask', labels.ask);
  ask.hidden = true;
  shadow.append(style, launcher, ask);
  document.body.append(host);

  launcher.setAttribute('aria-expanded', 'false');
  let chat = null;
  const loadChat = () => (chat ??= import('./bubbles.jsx').then((module) => module.createChat({ shadow, root, labels, pet, petSource: () => petSource(root), launcher })));
  const greet = () => {
    pet.load();
    loadChat();
    if (launcher.getAttribute('aria-expanded') === 'false' && pet.element.dataset.state === 'idle') pet.setState('greet');
  };
  launcher.addEventListener('click', async () => (await loadChat()).toggle());
  launcher.addEventListener('pointerenter', greet);
  launcher.addEventListener('focus', greet);

  let range = null;
  let frame = 0;
  const place = () => {
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = ask;
    const below = last.bottom + ASK_GAP;
    const top = below + height > innerHeight - EDGE ? last.top - height - ASK_GAP : below;
    ask.style.left = `${Math.round(Math.max(EDGE, Math.min(last.right - width, innerWidth - width - EDGE)))}px`;
    ask.style.top = `${Math.round(top)}px`;
  };
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      range = selectedRange(document.querySelector(ARTICLE_REGION));
      ask.hidden = range === null;
      if (range !== null) place();
    });
  };
  document.addEventListener('selectionchange', follow);
  addEventListener('scroll', () => range !== null && place(), { passive: true });
  addEventListener('resize', follow);
  ask.addEventListener('pointerdown', (event) => event.preventDefault());
  ask.addEventListener('click', async () => {
    if (range === null) return;
    const chosen = range.cloneRange();
    ask.hidden = true;
    (await loadChat()).ask(chosen);
  });
}

function button(className, text) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  const label = document.createElement('span');
  label.textContent = text;
  element.append(label);
  return element;
}
