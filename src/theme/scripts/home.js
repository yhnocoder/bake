import { labelsFor } from '../labels.js';
import { storageKey } from '../settings.js';
import { markCurrent } from './current.js';
import { EASING, oncePerFrame, reducedMotion } from './motion.js';
import { withoutHover } from './screens.js';

const LOAD_MARGIN = '300px 0px';
const MIDDLE_BAND = '-45% 0px -45% 0px';
const CURRENT_LINE = 0.15;
const SCROLL_REST = 150;

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
      if (!withoutHover.matches) return;
      for (const entry of entries) {
        previews.get(entry.target).want('middle', entry.isIntersecting);
      }
    },
    { rootMargin: MIDDLE_BAND },
  );
  const screen = new IntersectionObserver((entries) => {
    for (const entry of entries) previews.get(entry.target).show(entry.isIntersecting);
  });
  for (const card of cards) {
    const preview = previews.get(card);
    band.observe(card);
    screen.observe(card);
    card.addEventListener('pointerenter', () => {
      if (!withoutHover.matches) preview.want('pointer', true);
    });
    card.addEventListener('pointerleave', () => {
      if (!withoutHover.matches) preview.want('pointer', false);
    });
    card.addEventListener('focus', () => preview.want('focus', true));
    card.addEventListener('blur', () => preview.want('focus', false));
  }
  reducedMotion.addEventListener('change', () => previews.forEach((preview) => preview.sync()));
  addEventListener('scroll', scrollHold(previews), { passive: true });

  if (home.querySelector('.bk-chips[data-for="category"]') !== null) startCurrentChip(home);
  startStuckBar(home);

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

function scrollHold(previews) {
  let timer = null;
  const hold = (held) => previews.forEach((preview) => preview.hold(held));
  return () => {
    if (!withoutHover.matches) return;
    if (timer === null) hold(true);
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      hold(false);
    }, SCROLL_REST);
  };
}

function startStuckBar(home) {
  const bar = home.querySelector('.bk-home-bar');
  if (bar === null) return;
  const watch = new IntersectionObserver(([entry]) => bar.toggleAttribute('data-stuck', !entry.isIntersecting));
  watch.observe(home.querySelector('.bk-home-header'));
}

function startCurrentChip(home) {
  const chips = [...home.querySelectorAll('.bk-chips[data-for="category"] .bk-chip')];
  const groups = [...home.querySelectorAll('[data-grouping="category"] > .bk-group')];
  const bar = home.querySelector('.bk-home-bar');
  let pinned = null;
  const mark = (id) => chips.forEach((chip) => markCurrent(chip, chip.dataset.target === id));
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
    update();
  };
  const scrollsTo = (group) => {
    const root = document.documentElement;
    const padding = parseFloat(getComputedStyle(root).scrollPaddingTop) || 0;
    const target = Math.min(Math.max(group.getBoundingClientRect().top + scrollY - padding, 0), root.scrollHeight - innerHeight);
    return Math.abs(target - scrollY) >= 1;
  };
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      mark(chip.dataset.target);
      if (!scrollsTo(document.getElementById(chip.dataset.target))) return;
      pinned = chip.dataset.target;
      addEventListener('scrollend', release, { once: true });
    });
  }
  for (const type of ['wheel', 'touchstart', 'keydown']) addEventListener(type, release, { passive: true });
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
}

function choose(name, value) {
  const values = [...document.querySelectorAll(`.bk-switch[data-control="${name}"] button`)].map((button) => button.dataset.value);
  document.documentElement.dataset[name] = value;
  document.documentElement.style.setProperty(`--${name}-index`, values.indexOf(value));
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
  const moves = [];
  for (const card of document.querySelectorAll('.bk-card')) {
    if (card.offsetParent === null) continue;
    const to = card.getBoundingClientRect();
    if (to.bottom >= 0 && to.top <= height) moves.push([card, from.get(card), to]);
  }
  for (const [card, old, to] of moves) {
    if (old === undefined) {
      card.animate([{ opacity: 0, scale: '0.96' }, { opacity: 1, scale: '1' }], { duration: 220, easing: EASING });
      continue;
    }
    const keyframe = { translate: `${old.left - to.left}px ${old.top - to.top}px`, scale: `${old.width / to.width} ${old.height / to.height}` };
    card.animate([keyframe, { translate: '0 0', scale: '1' }], { duration: 260, easing: EASING });
  }
}

function cardPreview(card) {
  let state = 'idle';
  let controller = null;
  const reasons = new Set();
  let running = false;
  let onScreen = false;
  let held = false;
  const sync = () => {
    const play = reasons.size > 0 && onScreen && !held && controller !== null && !reducedMotion.matches;
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
    show(visible) {
      onScreen = visible;
      sync();
    },
    hold(scrolling) {
      held = scrolling;
      sync();
    },
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
        card.toggleAttribute('data-preview-failed', true);
        state = 'failed';
        console.error(`the preview ${card.dataset.preview} cannot be shown`, error);
      }
    },
    want(reason, wanted) {
      if (wanted) reasons.add(reason);
      else reasons.delete(reason);
      card.toggleAttribute('data-active', reasons.size > 0);
      sync();
    },
    pause() {
      reasons.clear();
      delete card.dataset.active;
      sync();
    },
  };
}
