import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

const SHOW_DELAY = 300;
const HIDE_DELAY = 200;
const WARM_WINDOW = 600;
const EDGE = 12;
const OFFSET = 8;

export function startPreviewCard(article) {
  const templates = new Map([...document.querySelectorAll('template.bk-preview-template')].map((template) => [template.dataset.target, template]));
  const kinds = [
    { kind: 'reference', selector: 'a.citation', screen: matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1000px)'), read: readReference },
    { kind: 'link', selector: 'a.internal-link[data-target]', screen: matchMedia('(hover: hover) and (pointer: fine)'), read: (link) => readLink(templates, link) },
  ].filter(({ selector }) => article.querySelector(selector) !== null);
  if (kinds.length === 0) return;
  const [entry, setEntry] = createSignal(null);
  const [shown, setShown] = createSignal(false);
  let showTimer;
  let hideTimer;
  let warmUntil = 0;
  const show = (link, kind) => {
    clearTimeout(hideTimer);
    const content = kind.read(link);
    if (content === null) return;
    setEntry({ link, kind: kind.kind, content });
    setShown(true);
  };
  const close = () => {
    if (shown()) warmUntil = performance.now() + WARM_WINDOW;
    setShown(false);
  };
  const hide = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(close, HIDE_DELAY);
  };
  const keep = () => clearTimeout(hideTimer);
  const triggerOf = (target) => {
    for (const kind of kinds) {
      const link = target instanceof Element ? target.closest(kind.selector) : null;
      if (link !== null) return { link, kind };
    }
    return null;
  };

  article.addEventListener('pointerover', (event) => {
    const trigger = triggerOf(event.target);
    if (trigger === null || !trigger.kind.screen.matches) return;
    keep();
    if (shown() && entry()?.link === trigger.link) return;
    clearTimeout(showTimer);
    if (shown() || performance.now() < warmUntil) show(trigger.link, trigger.kind);
    else showTimer = setTimeout(() => show(trigger.link, trigger.kind), SHOW_DELAY);
  });
  article.addEventListener('pointerout', (event) => {
    const trigger = triggerOf(event.target);
    if (trigger !== null && !trigger.link.contains(event.relatedTarget)) hide();
  });
  addEventListener('scroll', close, { passive: true });

  const host = document.createElement('div');
  document.body.append(host);
  render(() => <PreviewCard entry={entry()} shown={shown()} onEnter={keep} onLeave={hide} />, host);
}

function readReference(link) {
  const item = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (item === null) return null;
  const number = document.createElement('span');
  number.className = 'bk-preview-number';
  number.textContent = `[${item.getAttribute('value')}]`;
  const text = document.createElement('div');
  text.className = 'bk-preview-text';
  text.innerHTML = item.innerHTML;
  return [number, text];
}

function readLink(templates, link) {
  const template = templates.get(link.dataset.target);
  return template === undefined ? null : [...template.content.cloneNode(true).childNodes];
}

function PreviewCard(props) {
  let card;
  createEffect(() => {
    if (!props.shown || props.entry === null) return;
    const body = card.querySelector('.bk-preview-body');
    body?.toggleAttribute('data-clipped', body.scrollHeight > body.clientHeight + 1);
    place(card, props.entry.link);
  });
  const open = (event) => {
    if (props.entry?.kind !== 'link' || event.target.closest('a') !== null) return;
    location.href = props.entry.link.href;
  };
  return (
    <div
      class="bk-preview"
      data-kind={props.entry?.kind}
      classList={{ 'is-on': props.shown }}
      aria-hidden={String(!props.shown)}
      ref={card}
      onPointerEnter={props.onEnter}
      onPointerLeave={props.onLeave}
      onClick={open}
    >
      {props.entry?.content}
    </div>
  );
}

function place(card, link) {
  const anchor = link.getClientRects()[0] ?? link.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const left = Math.max(EDGE, Math.min(anchor.left, innerWidth - width - EDGE));
  const below = anchor.bottom + OFFSET;
  const above = anchor.top - height - OFFSET;
  const top = below + height > innerHeight - EDGE && above > EDGE ? above : below;
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}
