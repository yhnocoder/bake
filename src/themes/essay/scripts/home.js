import { labelsFor } from '../labels.js';
import { storageKey } from '../settings.js';
import { oncePerFrame, reducedMotion } from './motion.js';

const LOAD_MARGIN = '300px 0px';
const MIDDLE_BAND = '-45% 0px -45% 0px';
const CURRENT_LINE = 0.15;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const noHover = matchMedia('(hover: none)');

export function startHome(home) {
  const root = document.documentElement;
  const labels = labelsFor(root.lang);
  const cards = [...home.querySelectorAll('.bk-card')];
  const previews = new Map(cards.map((card) => [card, cardPreview(card)]));
  const pauseAll = () => previews.forEach((preview) => preview.pause());
  const visibleCards = () => cards.filter((card) => card.closest('.bk-grouping').dataset.grouping === root.dataset.group && !card.closest('[hidden]'));

  const loader = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        loader.unobserve(entry.target);
        previews.get(entry.target).load();
      }
    },
    { rootMargin: LOAD_MARGIN },
  );
  cards.filter((card) => card.dataset.preview !== undefined).forEach((card) => loader.observe(card));

  const band = new IntersectionObserver(
    (entries) => {
      if (!noHover.matches) return;
      for (const entry of entries) {
        if (entry.isIntersecting) previews.get(entry.target).play();
        else previews.get(entry.target).pause();
      }
    },
    { rootMargin: MIDDLE_BAND },
  );
  for (const card of cards) {
    const preview = previews.get(card);
    band.observe(card);
    card.addEventListener('pointerenter', () => {
      if (!noHover.matches) preview.play();
    });
    card.addEventListener('pointerleave', () => {
      if (!noHover.matches) preview.pause();
    });
    card.addEventListener('focus', () => preview.play());
    card.addEventListener('blur', () => preview.pause());
  }
  reducedMotion.addEventListener('change', () => previews.forEach((preview) => preview.sync()));

  startCurrentChip(home);

  const switches = [...home.querySelectorAll('.bk-switch')];
  const showPressed = () => {
    for (const control of switches) {
      for (const button of control.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.value === root.dataset[control.dataset.control]));
    }
  };
  showPressed();
  for (const control of switches) {
    control.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (button === null || root.dataset[control.dataset.control] === button.dataset.value) return;
      if (control.dataset.control === 'group') chooseGroup(home, button.dataset.value, pauseAll);
      else moveCards(visibleCards(), () => choose('columns', button.dataset.value));
      showPressed();
    });
  }

  const tagChips = [...home.querySelectorAll('.bk-chips[data-for="month"] .bk-chip')];
  for (const chip of tagChips) {
    chip.addEventListener('click', () => {
      for (const other of tagChips) other.setAttribute('aria-pressed', String(other === chip));
      moveCards(visibleCards(), () => filterMonths(home, chip.dataset.tag, labels, previews));
    });
  }
}

function startCurrentChip(home) {
  const chips = [...home.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')];
  const groups = [...home.querySelectorAll('[data-grouping="category"] > .bk-group')];
  const bar = home.querySelector('.bk-home-bar');
  let pinned = null;
  const mark = (id) => chips.forEach((chip) => chip.classList.toggle('is-current', chip.dataset.target === id));
  const update = oncePerFrame(() => {
    if (pinned !== null || document.documentElement.dataset.group !== 'category') return;
    const line = bar.offsetHeight + innerHeight * CURRENT_LINE;
    const tops = groups.map((group) => [group, group.getBoundingClientRect().top]);
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    const reached = tops.filter(([, top]) => (atEnd ? top < innerHeight : top <= line));
    mark((reached.at(-1) ?? tops[0])?.[0].id);
  });
  const release = () => {
    pinned = null;
  };
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      pinned = chip.dataset.target;
      mark(pinned);
      addEventListener('scrollend', release, { once: true });
    });
  }
  for (const type of ['wheel', 'touchstart', 'keydown']) addEventListener(type, release, { passive: true });
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

function choose(name, value) {
  document.documentElement.dataset[name] = value;
  try {
    localStorage.setItem(storageKey(name), value);
  } catch {}
}

function chooseGroup(home, value, pauseAll) {
  pauseAll();
  choose('group', value);
  const bar = home.querySelector('.bk-home-bar');
  const main = home.querySelector('.bk-home-main');
  if (bar.getBoundingClientRect().top <= 0) scrollTo({ top: main.getBoundingClientRect().top + scrollY - bar.offsetHeight });
  const shown = home.querySelector(`[data-grouping="${value}"]`);
  if (!reducedMotion.matches) shown.animate([{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 240, easing: EASING });
}

function filterMonths(home, tag, labels, previews) {
  for (const group of home.querySelectorAll('[data-grouping="month"] > .bk-group')) {
    let count = 0;
    for (const card of group.querySelectorAll('.bk-card')) {
      const shown = tag === '' || JSON.parse(card.dataset.tags).includes(tag);
      card.hidden = !shown;
      if (shown) count += 1;
      else previews.get(card).pause();
    }
    group.hidden = count === 0;
    group.querySelector('.bk-group-count').textContent = labels.posts(count);
  }
}

function moveCards(before, change) {
  const from = new Map(before.map((card) => [card, card.getBoundingClientRect()]));
  change();
  if (reducedMotion.matches) return;
  const height = innerHeight;
  for (const card of document.querySelectorAll('.bk-card')) {
    if (card.offsetParent === null) continue;
    const to = card.getBoundingClientRect();
    const old = from.get(card);
    if (to.bottom < 0 || to.top > height) continue;
    if (old === undefined) {
      card.animate([{ opacity: 0, scale: '0.96' }, { opacity: 1, scale: '1' }], { duration: 220, easing: EASING });
      continue;
    }
    const keyframe = { translate: `${old.left - to.left}px ${old.top - to.top}px`, scale: `${old.width / to.width} ${old.height / to.height}`, transformOrigin: 'top left' };
    card.animate([keyframe, { translate: '0 0', scale: '1', transformOrigin: 'top left' }], { duration: 260, easing: EASING });
  }
}

function cardPreview(card) {
  let state = 'idle';
  let controller = null;
  let wanted = false;
  let running = false;
  const sync = () => {
    const play = wanted && controller !== null && !reducedMotion.matches;
    if (play === running) return;
    running = play;
    try {
      if (play) controller.start();
      else controller.stop();
    } catch (error) {
      console.error(`the preview ${card.dataset.preview} failed to ${play ? 'start' : 'stop'}`, error);
    }
  };
  return {
    sync,
    async load() {
      if (state !== 'idle') return;
      state = 'loading';
      const fallback = card.querySelector('.bk-card-fallback');
      const stage = document.createElement('div');
      stage.className = 'bk-card-preview';
      fallback.after(stage);
      try {
        const module = await import(new URL(card.dataset.preview, document.baseURI).href);
        const result = module.default(stage);
        if (typeof result?.start !== 'function' || typeof result?.stop !== 'function') throw new TypeError('the default export must return an object with start and stop functions');
        controller = result;
        fallback.remove();
        state = 'ready';
        sync();
      } catch (error) {
        stage.remove();
        state = 'failed';
        console.error(`the preview ${card.dataset.preview} cannot be shown`, error);
      }
    },
    play() {
      wanted = true;
      card.dataset.active = '';
      sync();
    },
    pause() {
      wanted = false;
      delete card.dataset.active;
      sync();
    },
  };
}
