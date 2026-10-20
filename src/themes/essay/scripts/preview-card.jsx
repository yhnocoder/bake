import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { closeOnEscape } from './escape.js';
import { CONTENT_EVENT } from './motion.js';
import { hoverWithFinePointer, notesColumnScreen } from './screens.js';

const SHOW_DELAY = 300;
const HIDE_DELAY = 200;
const WARM_WINDOW = 600;
const EDGE = 12;
const OFFSET = 8;

export function startPreviewCard(article) {
  const kinds = [
    { kind: 'reference', selector: 'a.citation', enabled: () => hoverWithFinePointer.matches && notesColumnScreen.matches, read: readReference },
    { kind: 'link', selector: 'a.internal-link[data-target]', enabled: () => hoverWithFinePointer.matches, read: readTemplate },
  ];
  const [entry, setEntry] = createSignal(null);
  const [shown, setShown] = createSignal(false);
  const [placed, setPlaced] = createSignal(0);
  let showTimer;
  let hideTimer;
  let warmUntil = 0;
  const show = (link, kind) => {
    clearTimeout(hideTimer);
    const read = kind.read(link);
    if (read === null) return;
    setEntry({ link, opens: kind.kind === 'link', ...read });
    setShown(true);
  };
  const close = () => {
    clearTimeout(hideTimer);
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
      if (link !== null && kind.enabled()) return { link, kind };
    }
    return null;
  };

  article.addEventListener('pointerover', (event) => {
    const trigger = triggerOf(event.target);
    if (trigger === null) return;
    keep();
    if (shown() && entry()?.link === trigger.link) return;
    clearTimeout(showTimer);
    if (shown() || performance.now() < warmUntil) show(trigger.link, trigger.kind);
    else showTimer = setTimeout(() => show(trigger.link, trigger.kind), SHOW_DELAY);
  });
  article.addEventListener('pointerout', (event) => {
    const trigger = triggerOf(event.target);
    if (trigger !== null && !trigger.link.contains(event.relatedTarget) && !trigger.link.matches(':focus-visible')) hide();
  });
  article.addEventListener('focusin', (event) => {
    const trigger = triggerOf(event.target);
    if (trigger === null || !trigger.link.matches(':focus-visible')) return;
    clearTimeout(showTimer);
    show(trigger.link, trigger.kind);
  });
  article.addEventListener('focusout', (event) => {
    if (triggerOf(event.target) !== null) hide();
  });
  document.addEventListener(CONTENT_EVENT, () => {
    clearTimeout(showTimer);
    close();
  });
  addEventListener(
    'scroll',
    () => {
      if (shown() && entry()?.link === document.activeElement) setPlaced(placed() + 1);
      else close();
    },
    { passive: true },
  );

  const host = document.createElement('div');
  document.body.append(host);
  render(() => <PreviewCard entry={entry()} shown={shown()} placed={placed()} onEnter={keep} onLeave={hide} />, host);
  closeOnEscape(host, () => {
    clearTimeout(showTimer);
    close();
  });
}

function readReference(link) {
  if (new URL(link.href).pathname !== location.pathname) return readTemplate(link);
  const item = document.getElementById(decodeURIComponent(link.hash.slice(1)));
  if (item === null) return null;
  const number = document.createElement('span');
  number.className = 'bk-preview-number';
  number.textContent = `[${item.getAttribute('value')}]`;
  const text = document.createElement('div');
  text.className = 'bk-preview-text';
  text.innerHTML = item.innerHTML;
  return { kind: 'reference', content: [number, text] };
}

function readTemplate(link) {
  const template = document.querySelector(`template.bk-preview-template[data-target="${CSS.escape(link.dataset.target)}"]`);
  return template === null ? null : { kind: template.dataset.kind, content: [...template.content.cloneNode(true).childNodes] };
}

function PreviewCard(props) {
  let card;
  createEffect(() => {
    props.placed;
    if (!props.shown || props.entry === null) return;
    const body = card.querySelector('.bk-preview-body');
    body?.toggleAttribute('data-clipped', body.scrollHeight > body.clientHeight + 1);
    place(card, props.entry.link);
  });
  const open = (event) => {
    if (props.entry?.opens !== true || event.target.closest('a') !== null) return;
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
