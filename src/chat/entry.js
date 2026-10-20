import styles from './entry.css?inline';
import { createFigure } from './figure.js';
import { chatLabels } from './labels.js';
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
  style.textContent = styles;
  const figure = createFigure();
  const launcher = button('bk-chat-launcher', labels.open);
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.prepend(figure.element);
  const ask = button('bk-chat-ask', labels.ask);
  ask.hidden = true;
  shadow.append(style, launcher, ask);
  document.body.append(host);

  let panel = null;
  const loadPanel = () => (panel ??= import('./panel.jsx').then((module) => module.createPanel({ shadow, root, labels, figure, launcher })));
  launcher.addEventListener('click', async () => (await loadPanel()).open());
  launcher.addEventListener('pointerenter', () => {
    if (figure.element.dataset.state === 'idle') figure.setState('greet');
  });

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
    (await loadPanel()).ask(chosen);
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
