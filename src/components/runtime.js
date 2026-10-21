import { files, loaders } from 'bake:component-loaders';
import { livePage } from '../live.js';

const FRAME = 'figure.component[data-component]';
const BOX = '.component-box';
const NEAR_DISTANCE = 800;
const NEAR_SCREENS = 1.5;
const definitions = new Map();
const SLOW_CONNECTIONS = ['slow-2g', '2g'];
const prefetchQueue = [];
let prefetching = null;
let starting = 0;
const prefetched = new Set();

function define(name) {
  if (!definitions.has(name)) {
    definitions.set(
      name,
      loaders[name]().then(
        async (module) => {
          const Component = module.default;
          if (Component.prototype instanceof HTMLElement) customElements.define(name, Component);
          else customElements.define(name, (await import('./solid-element.js')).solidElement(Component));
        },
        (error) => {
          definitions.delete(name);
          throw error;
        },
      ),
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
  starting += 1;
  pausePrefetch(name);
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
  } finally {
    starting -= 1;
    prefetchNext();
  }
}

function nearMargin() {
  return `${Math.max(NEAR_DISTANCE, innerHeight * NEAR_SCREENS)}px 0px`;
}
function createObserver(margin) {
  const created = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        created.unobserve(entry.target);
        start(entry.target);
      }
    },
    { rootMargin: margin },
  );
  return created;
}
let margin = nearMargin();
let observer = createObserver(margin);
function observeFrames() {
  const frames = [...document.querySelectorAll(FRAME)].filter((frame) => frame.dataset.state === undefined);
  for (const frame of frames) observer.observe(frame);
  return frames;
}
function distanceFromViewport(frame) {
  const { top, bottom } = frame.getBoundingClientRect();
  return Math.max(0, top - innerHeight, -bottom);
}
function queuePrefetch(frames) {
  const connection = navigator.connection;
  if (connection?.saveData || SLOW_CONNECTIONS.includes(connection?.effectiveType)) return;
  const waiting = frames.filter((frame) => frame.dataset.state === undefined);
  const distances = new Map(waiting.map((frame) => [frame, distanceFromViewport(frame)]));
  waiting.sort((a, b) => distances.get(a) - distances.get(b));
  for (const name of new Set(waiting.map((frame) => frame.dataset.component))) {
    if (Object.hasOwn(files, name) && !prefetchQueue.includes(name) && prefetching?.name !== name) prefetchQueue.push(name);
  }
  prefetchNext();
}
function prefetchNext() {
  if (prefetching !== null || starting > 0) return;
  const name = prefetchQueue.shift();
  if (name === undefined) return;
  if (definitions.has(name)) return prefetchNext();
  const controller = new AbortController();
  prefetching = { name, controller };
  const addresses = files[name].map((file) => new URL(file, import.meta.url).href).filter((address) => !prefetched.has(address) && !requestedByPage(address));
  const download = (address) =>
    fetch(address, { signal: controller.signal, priority: 'low' })
      .then((response) => response.arrayBuffer())
      .then(() => prefetched.add(address));
  Promise.allSettled(addresses.map(download)).then(() => {
    if (prefetching?.controller !== controller) return;
    prefetching = null;
    prefetchNext();
  });
}

function requestedByPage(address) {
  return performance.getEntriesByName(address).some((entry) => entry.initiatorType !== 'fetch');
}
function pausePrefetch(name) {
  if (prefetching === null || prefetching.name === name) return;
  prefetching.controller.abort();
  prefetchQueue.unshift(prefetching.name);
  prefetching = null;
}

livePage(() => {
  const frames = observeFrames();
  if (document.readyState === 'complete') queuePrefetch(frames);
  else addEventListener('load', () => queuePrefetch(frames), { once: true });
  return () => observer.disconnect();
});
addEventListener('resize', () => {
  if (nearMargin() === margin) return;
  margin = nearMargin();
  observer.disconnect();
  observer = createObserver(margin);
  observeFrames();
});
addEventListener('beforeprint', () => document.querySelectorAll(FRAME).forEach(start));
