import { For, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { labelsFor } from '../labels.js';
import { READING_SETTINGS, storageKey } from '../settings.js';
import { closeOnEscape } from './escape.js';
import { requestLayout } from './layout.js';
import { reducedMotion } from './motion.js';

export const SETTING_EVENT = 'bk:setting';
const THEME_EVENT = 'bake:theme';
const CONTROLS = ['list', 'segmented', 'switch'];

function readingRows(labels) {
  return [
    { name: 'theme', label: labels.theme, text: (value) => labels.themes[value] },
    { name: 'font', fades: true, label: labels.font, text: (value) => labels.fonts[value], layout: { arrange: true } },
    { name: 'size', fades: true, label: labels.size, text: (value) => labels.sizes[value], glyph: 'A', layout: { arrange: true } },
    { name: 'weight', fades: true, label: labels.weight, text: (value) => labels.weights[value], layout: { arrange: true } },
    { name: 'spacing', fades: true, label: labels.spacing, text: (value) => labels.spacings[value], layout: { arrange: true } },
  ].map((row) => ({ ...row, values: READING_SETTINGS[row.name].values, control: 'segmented' }));
}

function themeRows(settings, labels) {
  return Object.entries(settings).map(([name, { values, control }]) => ({ name, values, control, label: labels[name].label, text: (value) => labels[name].values[value] }));
}

let rows = [];
let values = {};

function settingValue(name) {
  return values[name]?.[0]();
}

export function chooseSetting(name, value) {
  try {
    localStorage.setItem(storageKey(name), value);
  } catch {}
  values[name][1](value);
  if (name === 'theme') {
    switchTheme(value);
    return;
  }
  const row = rows.find((candidate) => candidate.name === name);
  const apply = (now) => {
    document.documentElement.dataset[name] = value;
    document.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: { name, value } }));
    if (row?.layout !== undefined) requestLayout({ ...row.layout, now });
    loadLightWenkai();
  };
  if (row?.fades) fadePage(() => apply(true));
  else apply(false);
}

function loadLightWenkai() {
  const { font, weight } = document.documentElement.dataset;
  if (font === 'wenkai' && weight === 'light') import('./wenkai-light.js');
}

const darkScheme = matchMedia('(prefers-color-scheme: dark)');

function switchTheme(value) {
  fadePage(() => {
    document.documentElement.dataset.theme = value;
    document.documentElement.dataset.scheme = value === 'system' ? systemScheme() : value;
    document.dispatchEvent(new CustomEvent(SETTING_EVENT, { detail: { name: 'theme', value } }));
    document.dispatchEvent(new CustomEvent(THEME_EVENT));
  });
}

function pageFades() {
  return document.startViewTransition !== undefined && !reducedMotion.matches && document.visibilityState === 'visible';
}

let fade = null;

function fadePage(apply) {
  if (!pageFades()) {
    apply();
    return;
  }
  const transition = document.startViewTransition(apply);
  fade = transition;
  transition.finished.finally(() => {
    if (fade === transition) fade = null;
  });
}

function systemScheme() {
  return darkScheme.matches ? 'dark' : 'light';
}

function endFadeOnPress() {
  addEventListener(
    'pointerdown',
    (event) => {
      if (fade === null || event.target !== document.documentElement) return;
      event.stopImmediatePropagation();
      fade.skipTransition();
    },
    true,
  );
}

function followSystemScheme() {
  if (settingValue('theme') !== 'system') return;
  fadePage(() => {
    document.documentElement.dataset.scheme = systemScheme();
    document.dispatchEvent(new CustomEvent(THEME_EVENT));
  });
}

export function startSettings(settings = {}, { labels: themeLabels = {}, drawings = {} } = {}) {
  const labels = labelsFor(document.documentElement.lang);
  const defaults = JSON.parse(document.querySelector('.bk-setting-defaults')?.textContent ?? '{}');
  // why: the panel opens upward from its button, so a tall list sits at the top and a switch at the bottom, whatever the order of the declarations
  rows = [...readingRows(labels), ...themeRows(settings, themeLabels)].sort((a, b) => CONTROLS.indexOf(a.control) - CONTROLS.indexOf(b.control));
  values = Object.fromEntries(rows.map((row) => [row.name, createSignal(document.documentElement.dataset[row.name])]));
  const host = document.createElement('div');
  document.querySelector('[data-edge="start"]').append(host);
  render(() => <Settings labels={labels} defaults={defaults} drawings={drawings} />, host);
  darkScheme.addEventListener('change', followSystemScheme);
  endFadeOnPress();
  loadLightWenkai();
}

function Settings(props) {
  const { labels, defaults, drawings } = props;
  const [open, setOpen] = createSignal(false);
  let root;
  let toggle;
  onMount(() =>
    closeOnEscape(root, () => {
      if (!open()) return false;
      setOpen(false);
      toggle.focus();
      return true;
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
        <For each={rows.filter((row) => settingValue(row.name) !== undefined)}>
          {(row) => (row.control === 'list' ? <ListRow row={row} initial={defaults[row.name]} drawings={drawings[row.name]} labels={labels} /> : row.control === 'switch' ? <SwitchRow row={row} /> : <OptionsRow row={row} />)}
        </For>
      </div>
    </div>
  );
}

function ListRow(props) {
  const { row, initial, drawings, labels } = props;
  return (
    <div class="bk-settings-row is-list" data-setting={row.name}>
      <span class="bk-settings-label" id={`bk-settings-${row.name}`}>
        {row.label}
      </span>
      <div class="bk-settings-list" role="radiogroup" aria-labelledby={`bk-settings-${row.name}`}>
        <For each={row.values}>
          {(value, index) => (
            <button type="button" class="bk-settings-choice" role="radio" data-value={value} aria-checked={String(settingValue(row.name) === value)} onClick={() => chooseSetting(row.name, value)}>
              <svg viewBox="0 0 28 28" aria-hidden="true" innerHTML={drawings?.[value]} />
              <span>
                <b>{row.text(value)}</b>
                <small>{value === initial ? `T${index() + 1} · ${labels.defaultValue}` : `T${index() + 1}`}</small>
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function OptionsRow(props) {
  const { row } = props;
  return (
    <div class="bk-settings-row" data-setting={row.name}>
      <span class="bk-settings-label">{row.label}</span>
      <div class="bk-kit-segmented bk-settings-options" role="group" aria-label={row.label}>
        <For each={row.values}>
          {(value) => (
            <button
              type="button"
              class="bk-kit-segment"
              data-value={value}
              aria-label={row.glyph === undefined ? undefined : row.text(value)}
              title={row.glyph === undefined ? undefined : row.text(value)}
              aria-pressed={String(settingValue(row.name) === value)}
              onClick={() => chooseSetting(row.name, value)}
            >
              {row.glyph ?? row.text(value)}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function SwitchRow(props) {
  const { row } = props;
  const [on, off] = row.values;
  const checked = () => settingValue(row.name) === on;
  return (
    <div class="bk-settings-row" data-setting={row.name}>
      <span class="bk-settings-label">{row.label}</span>
      <button type="button" class="bk-settings-switch" role="switch" aria-checked={String(checked())} onClick={() => chooseSetting(row.name, checked() ? off : on)}>
        <span>{row.text(on)}</span>
        <i class="bk-kit-switch" aria-hidden="true" />
      </button>
    </div>
  );
}
