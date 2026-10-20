import { loaders } from 'bake:component-loaders';

const FRAME = 'figure.component[data-component]';
const BOX = '.component-box';
const NEAR_VIEWPORT = '150% 0px';
const definitions = new Map();

function define(name) {
  if (!definitions.has(name)) {
    definitions.set(
      name,
      loaders[name]().then(async (module) => {
        const Component = module.default;
        if (customElements.get(name) !== undefined) return;
        if (Component.prototype instanceof HTMLElement) customElements.define(name, Component);
        else customElements.define(name, (await import('./solid-element.js')).solidElement(Component));
      }),
    );
  }
  return definitions.get(name);
}

function reportedErrors(action) {
  const errors = [];
  const record = (event) => {
    errors.push(event.error);
    event.preventDefault();
  };
  // why: the browser reports an exception thrown by a custom element constructor or connectedCallback as an error event on window, and createElement and append return normally
  addEventListener('error', record);
  try {
    action();
  } finally {
    removeEventListener('error', record);
  }
  return errors;
}

async function start(frame) {
  if (frame.dataset.state !== undefined) return;
  frame.dataset.state = 'loading';
  const name = frame.dataset.component;
  try {
    await define(name);
    const box = frame.querySelector(BOX);
    let element = null;
    const errors = reportedErrors(() => {
      element = document.createElement(name);
      element.params = JSON.parse(frame.dataset.params);
      box.append(element);
    });
    if (errors.length > 0) {
      reportedErrors(() => element?.remove());
      throw errors[0];
    }
    frame.dataset.state = 'ready';
  } catch (error) {
    frame.dataset.state = 'failed';
    console.error(`${name} cannot start`, error);
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      start(entry.target);
    }
  },
  { rootMargin: NEAR_VIEWPORT },
);
function observeFrames() {
  const frames = [...document.querySelectorAll(FRAME)].filter((frame) => frame.dataset.state === undefined);
  for (const frame of frames) observer.observe(frame);
  return frames;
}
function defineInTurn(names) {
  const [name, ...rest] = names;
  if (name === undefined) return;
  define(name)
    // why: a definition that fails is reported by start when its frame comes near the viewport
    .catch(() => {})
    .then(() => setTimeout(() => defineInTurn(rest)));
}
function defineAll(frames) {
  defineInTurn([...new Set(frames.map((frame) => frame.dataset.component))]);
}

const frames = observeFrames();
if (document.readyState === 'complete') defineAll(frames);
else addEventListener('load', () => defineAll(frames), { once: true });
document.addEventListener('bake:content', () => defineAll(observeFrames()));
addEventListener('beforeprint', () => document.querySelectorAll(FRAME).forEach(start));
