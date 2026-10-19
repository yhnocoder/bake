import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

const hoverScreen = matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1000px)');
const SHOW_DELAY = 300;
const HIDE_DELAY = 200;
const EDGE = 12;
const OFFSET = 8;

export function startCitations(article) {
  const [entry, setEntry] = createSignal(null);
  const [shown, setShown] = createSignal(false);
  let showTimer;
  let hideTimer;
  const show = (link) => {
    clearTimeout(hideTimer);
    const item = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (item === null) return;
    setEntry({ link, number: item.getAttribute('value'), html: item.innerHTML });
    setShown(true);
  };
  const hide = () => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setShown(false), HIDE_DELAY);
  };
  const keep = () => clearTimeout(hideTimer);

  article.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a.citation');
    if (link === null || !hoverScreen.matches) return;
    keep();
    if (shown() && entry()?.link === link) return;
    clearTimeout(showTimer);
    if (shown()) show(link);
    else showTimer = setTimeout(() => show(link), SHOW_DELAY);
  });
  article.addEventListener('pointerout', (event) => {
    const link = event.target.closest('a.citation');
    if (link !== null && !link.contains(event.relatedTarget)) hide();
  });
  addEventListener('scroll', () => setShown(false), { passive: true });

  const host = document.createElement('div');
  document.body.append(host);
  render(() => <CitationCard entry={entry()} shown={shown()} onEnter={keep} onLeave={hide} />, host);
}

function CitationCard(props) {
  let card;
  createEffect(() => {
    if (props.shown && props.entry !== null) place(card, props.entry.link);
  });
  return (
    <div class="bk-preview" data-kind="reference" classList={{ 'is-on': props.shown }} aria-hidden={String(!props.shown)} ref={card} onPointerEnter={props.onEnter} onPointerLeave={props.onLeave}>
      <span class="bk-preview-number">{props.entry === null ? '' : `[${props.entry.number}]`}</span>
      <div class="bk-preview-text" innerHTML={props.entry?.html ?? ''} />
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
