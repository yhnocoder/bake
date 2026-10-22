import { livePage } from '../shared/live.js';
import { REGIONS, regionSelector } from '../shared/regions.js';
import { oncePerFrame } from '../theme-kit/scripts/motion.js';
import styles from './entry.css?inline';
import { chatLabels } from './labels.js';
import petStyles from './pet.css?inline';
import { createPet, petSource } from './pet.js';
import { selectedRange } from './selection.js';
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
  launcher.dataset.hint = labels.hint[document.querySelector(regionSelector(REGIONS.article)) === null ? 'blog' : 'article'];
  launcher.append(pet.element);
  shadow.append(style, launcher);
  const edge = document.querySelector('[data-edge="end"]');
  edge.append(host);
  const ask = button('bk-chat-ask', labels.ask);
  ask.hidden = true;
  const askHost = document.createElement('div');
  askHost.dataset.bakeChatAsk = '';
  const askShadow = askHost.attachShadow({ mode: 'open' });
  const askStyle = document.createElement('style');
  askStyle.textContent = styles;
  askShadow.append(askStyle, ask);
  // why: the ask button follows the selection, also while the theme hides the end area
  document.body.append(askHost);

  launcher.setAttribute('aria-expanded', 'false');
  let chat = null;
  const loadChat = () => (chat ??= import('./bubbles.jsx').then((module) => module.createChat({ shadow, root, labels, pet, petSource: () => petSource(root), launcher })));
  livePage(() => {
    chat?.then((controls) => controls.readPage());
    return () => {};
  });
  const greet = () => {
    pet.load();
    loadChat();
    if (launcher.getAttribute('aria-expanded') === 'false' && pet.element.dataset.state === 'idle') pet.setState('greet');
  };
  launcher.addEventListener('click', async () => (await loadChat()).toggle());
  launcher.addEventListener('pointerenter', greet);
  launcher.addEventListener('focus', greet);

  let range = null;
  const place = () => {
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = ask;
    const below = last.bottom + ASK_GAP;
    const top = below + height > innerHeight - EDGE ? last.top - height - ASK_GAP : below;
    ask.style.left = `${Math.round(Math.max(EDGE, Math.min(last.right - width, innerWidth - width - EDGE)))}px`;
    ask.style.top = `${Math.round(top)}px`;
  };
  const follow = oncePerFrame(() => {
    range = selectedRange(document.querySelector(regionSelector(REGIONS.article)));
    ask.hidden = range === null;
    if (range !== null) place();
  });
  document.addEventListener('selectionchange', follow);
  addEventListener('scroll', () => range !== null && place(), { passive: true });
  addEventListener('resize', follow);
  ask.addEventListener('pointerdown', (event) => event.preventDefault());
  ask.addEventListener('click', async () => {
    if (range === null) return;
    const chosen = range.cloneRange();
    ask.hidden = true;
    edge.removeAttribute('data-hidden');
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
