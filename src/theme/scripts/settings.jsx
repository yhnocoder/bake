import { For, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { labelsFor } from '../labels.js';
import { SETTINGS, storageKey } from '../settings.js';
import { closeOnEscape } from './escape.js';
import { requestLayout } from './layout.js';

export const SETTING_EVENT = 'bk:setting';
const THEME_EVENT = 'bake:theme';

export const settingRows = [
  { name: 'toc', label: (labels) => labels.tocStyle, option: (labels, value) => labels.tocStyles[value], list: true, changesLayout: true },
  { name: 'theme', label: (labels) => labels.theme, option: (labels, value) => labels.themes[value] },
  { name: 'font', label: (labels) => labels.font, option: (labels, value) => labels.fonts[value], changesLayout: true },
  { name: 'buttons', label: (labels) => labels.buttons, toggle: { on: 'autohide', off: 'always', text: (labels) => labels.hideButtons } },
];

const values = Object.fromEntries(Object.keys(SETTINGS).map((name) => [name, createSignal(document.documentElement.dataset[name])]));

function settingValue(name) {
  return values[name][0]();
}

export function chooseSetting(name, value) {
  document.documentElement.dataset[name] = value;
  try {
    localStorage.setItem(storageKey(name), value);
  } catch {}
  values[name][1](value);
  document.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: { name, value } }));
  if (name === 'theme') document.dispatchEvent(new CustomEvent(THEME_EVENT));
  if (settingRows.find((row) => row.name === name)?.changesLayout) requestLayout({ arrange: true });
}

export function startSettings() {
  const labels = labelsFor(document.documentElement.lang);
  const host = document.createElement('div');
  document.body.append(host);
  render(() => <Settings labels={labels} />, host);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settingValue('theme') === 'system') document.dispatchEvent(new CustomEvent(THEME_EVENT));
  });
}

function Settings(props) {
  const { labels } = props;
  const [open, setOpen] = createSignal(false);
  let root;
  let toggle;
  onMount(() =>
    closeOnEscape(root, () => {
      if (!open()) return;
      setOpen(false);
      toggle.focus();
    }),
  );
  document.addEventListener('pointerdown', (event) => {
    if (open() && !root.contains(event.target)) setOpen(false);
  });
  return (
    <div class="bk-settings" classList={{ 'is-open': open() }} ref={root}>
      <button
        type="button"
        class="bk-settings-toggle"
        aria-label={labels.settings}
        title={labels.settings}
        aria-expanded={String(open())}
        aria-controls="bk-settings-panel"
        onClick={() => setOpen(!open())}
        ref={toggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linejoin="round"
            d="M8.6 2.5h2.8l.4 2.1 1.5.9 2-.8 1.4 2.4-1.6 1.4v1.8l1.6 1.4-1.4 2.4-2-.8-1.5.9-.4 2.1H8.6l-.4-2.1-1.5-.9-2 .8-1.4-2.4 1.6-1.4V8.6L3.3 7.1l1.4-2.4 2 .8 1.5-.9z"
          />
          <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
      <div class="bk-settings-panel" id="bk-settings-panel" role="group" aria-label={labels.settings}>
        <For each={settingRows.filter((row) => settingValue(row.name) !== undefined)}>
          {(row) => (row.list ? <ListRow row={row} labels={labels} /> : row.toggle === undefined ? <OptionsRow row={row} labels={labels} /> : <ToggleRow row={row} labels={labels} />)}
        </For>
      </div>
    </div>
  );
}

const STYLE_GLYPHS = {
  notes: '<path d="M7 6v16" stroke="var(--line-2)" stroke-width="1"/><path d="M7 11v4" stroke="var(--accent)" stroke-width="1.6"/><path d="M10 7h10M10 12h8M10 16.5h11M10 19.5h7" stroke="var(--ink-3)" stroke-width="1.2" stroke-linecap="round"/>',
  tabs: '<rect x="0" y="5" width="8" height="3.5" rx="1.2" fill="var(--line-2)"/><rect x="0" y="10" width="11" height="3.5" rx="1.2" fill="var(--accent)"/><path d="M2 15.5v5" stroke="var(--ink-2)" stroke-width="1.2"/><rect x="0" y="22" width="8" height="3.5" rx="1.2" fill="var(--line-2)"/>',
  dots: '<circle cx="14" cy="5" r="1.6" fill="var(--ink-3)"/><rect x="11.5" y="8.5" width="5" height="11" rx="2.5" fill="var(--accent)"/><circle cx="14" cy="23" r="1.6" fill="var(--line-2)"/>',
  ticks: '<path d="M8 7h8M8 10h5M8 13h5M8 17h12M8 20h5M8 23h8" stroke="var(--line-2)" stroke-width="1.3" stroke-linecap="round"/><path d="M8 7h8M8 10h5M8 13h5" stroke="var(--ink-3)" stroke-width="1.3" stroke-linecap="round"/><path d="M8 17h12" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round"/>',
};

function ListRow(props) {
  const { row, labels } = props;
  const values = SETTINGS[row.name].values;
  const initial = document.documentElement.dataset.defaultToc;
  return (
    <div class="bk-settings-row is-list" data-setting={row.name}>
      <span class="bk-settings-label" id={`bk-settings-${row.name}`}>
        {row.label(labels)}
      </span>
      <div class="bk-settings-list" role="radiogroup" aria-labelledby={`bk-settings-${row.name}`}>
        <For each={values}>
          {(value, index) => (
            <button type="button" class="bk-settings-choice" role="radio" data-value={value} aria-checked={String(settingValue(row.name) === value)} onClick={() => chooseSetting(row.name, value)}>
              <svg viewBox="0 0 28 28" aria-hidden="true" innerHTML={STYLE_GLYPHS[value]} />
              <span>
                <b>{row.option(labels, value)}</b>
                <small>{value === initial ? `T${index() + 1} · ${labels.defaultStyle}` : `T${index() + 1}`}</small>
              </span>
            </button>
          )}
        </For>
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
