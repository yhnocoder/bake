import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { labelsFor } from '../labels.js';
import { SETTINGS, storageKey } from '../settings.js';
import { layoutChanged } from './motion.js';

export const SETTING_EVENT = 'bk:setting';

export const settingRows = [
  { name: 'toc', label: (labels) => labels.tocStyle, option: (labels, value) => labels.tocStyles[value], changesLayout: true },
  { name: 'theme', label: (labels) => labels.theme, option: (labels, value) => labels.themes[value] },
  { name: 'font', label: (labels) => labels.font, option: (labels, value) => labels.fonts[value], changesLayout: true },
  { name: 'buttons', label: (labels) => labels.buttons, toggle: { on: 'autohide', off: 'always', text: (labels) => labels.hideButtons } },
];

const values = Object.fromEntries(Object.keys(SETTINGS).map((name) => [name, createSignal(document.documentElement.dataset[name])]));

export function settingValue(name) {
  return values[name][0]();
}

export function chooseSetting(name, value) {
  document.documentElement.dataset[name] = value;
  try {
    localStorage.setItem(storageKey(name), value);
  } catch {}
  values[name][1](value);
  document.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: { name, value } }));
  if (settingRows.find((row) => row.name === name)?.changesLayout) layoutChanged();
}

export function startSettings() {
  const labels = labelsFor(document.documentElement.lang);
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Settings labels={labels} />, host);
}

function Settings(props) {
  const { labels } = props;
  const [open, setOpen] = createSignal(false);
  let root;
  let toggle;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open()) return;
    setOpen(false);
    toggle.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (open() && !root.contains(event.target)) setOpen(false);
  });
  return (
    <div class="bk-settings" classList={{ 'is-open': open() }} ref={root}>
      <button type="button" class="bk-settings-toggle" aria-expanded={String(open())} aria-controls="bk-settings-panel" onClick={() => setOpen(!open())} ref={toggle}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h7M13 4h1M2 12h1M7 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <circle cx="11" cy="4" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />
          <circle cx="5" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <span>{labels.settings}</span>
      </button>
      <div class="bk-settings-panel" id="bk-settings-panel" role="group" aria-label={labels.settings}>
        <For each={settingRows}>{(row) => (row.toggle === undefined ? <OptionsRow row={row} labels={labels} /> : <ToggleRow row={row} labels={labels} />)}</For>
      </div>
    </div>
  );
}

function OptionsRow(props) {
  const { row, labels } = props;
  return (
    <div class="bk-settings-row" data-setting={row.name}>
      <span class="bk-settings-label">{row.label(labels)}</span>
      <div class="bk-settings-options" role="group" aria-label={row.label(labels)}>
        <For each={SETTINGS[row.name].values}>
          {(value) => (
            <button type="button" data-value={value} aria-pressed={String(settingValue(row.name) === value)} onClick={() => chooseSetting(row.name, value)}>
              {row.option(labels, value)}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function ToggleRow(props) {
  const { row, labels } = props;
  const { on, off, text } = row.toggle;
  const checked = () => settingValue(row.name) === on;
  return (
    <div class="bk-settings-row" data-setting={row.name}>
      <span class="bk-settings-label">{row.label(labels)}</span>
      <button type="button" class="bk-settings-switch" role="switch" aria-checked={String(checked())} onClick={() => chooseSetting(row.name, checked() ? off : on)}>
        <span>{text(labels)}</span>
        <i aria-hidden="true" />
      </button>
    </div>
  );
}
