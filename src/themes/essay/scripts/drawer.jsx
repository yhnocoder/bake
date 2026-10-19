import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

export function startDrawer(list, labels) {
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Drawer list={list} labels={labels} />, host);
}

function Drawer(props) {
  const { list, labels } = props;
  const [open, setOpen] = createSignal(false);
  let button;
  let panel;
  const change = (next) => {
    setOpen(next);
    document.documentElement.classList.toggle('bk-drawer-open', next);
    if (next) panel.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open()) return;
    change(false);
    button.focus();
  });
  return (
    <>
      <button type="button" class="bk-toc-button" aria-expanded={String(open())} aria-controls="bk-drawer" onClick={() => change(!open())} ref={button}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
        <span>{labels.toc}</span>
      </button>
      <div class="bk-drawer-scrim" classList={{ 'is-open': open() }} onClick={() => change(false)} />
      <div
        class="bk-drawer"
        id="bk-drawer"
        classList={{ 'is-open': open() }}
        role="dialog"
        aria-label={labels.toc}
        tabindex="-1"
        ref={panel}
        onClick={(event) => {
          if (event.target.closest('a') !== null) change(false);
        }}
      >
        <p class="bk-toc-label">{labels.notes}</p>
        <div class="bk-toc-scroll">{list}</div>
      </div>
    </>
  );
}
