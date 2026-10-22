import { notesColumnScreen } from './screens.js';
import { SETTING_EVENT } from './settings.jsx';

const TOP_ZONE = 40;
const TRAVEL = 8;

let edges = [];
let travel = 0;
let jumping = false;
let scrolledAway = false;
let held = false;

// Below 1000 pixels the edge areas cover the text, so the named ones slide out of view while the reader scrolls down and return when the reader scrolls up.
export function startEdges({ names = ['start', 'end'], enabled = () => true } = {}) {
  edges = names;
  let lastTop = scrollY;
  const scroll = () => {
    const top = scrollY;
    const delta = top - lastTop;
    lastTop = top;
    if (jumping) return;
    if (notesColumnScreen.matches || !enabled() || held || document.querySelector('.bk-settings.is-open') !== null || top < TOP_ZONE) {
      showEdges();
      return;
    }
    travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
    if (travel > TRAVEL) setScrolledAway(true);
    else if (travel < -TRAVEL) showEdges();
  };
  const setting = () => {
    if (!enabled()) showEdges();
  };
  const controller = new AbortController();
  const { signal } = controller;
  addEventListener('scroll', scroll, { passive: true, signal });
  notesColumnScreen.addEventListener('change', showEdges, { signal });
  document.addEventListener(SETTING_EVENT, setting, { signal });
  return () => {
    controller.abort();
    showEdges();
  };
}

export function showEdgesDuring(jump) {
  jumping = true;
  showEdges();
  jump.then(() => requestAnimationFrame(() => (jumping = false)));
}

// A drawer that covers the page hides every edge area while it is open.
export function hideEdgesWhile(open) {
  held = open;
  syncEdges();
}

function showEdges() {
  travel = 0;
  setScrolledAway(false);
}

function setScrolledAway(away) {
  scrolledAway = away;
  syncEdges();
}

function syncEdges() {
  for (const edge of document.querySelectorAll('[data-edge]')) edge.toggleAttribute('data-hidden', held || (scrolledAway && edges.includes(edge.dataset.edge)));
}
