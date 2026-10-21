import { For, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { labelsFor } from '../labels.js';
import { FONT_KEY, READING_SETTINGS, fontFamilies, storageKey } from '../settings.js';
import { closeOnEscape } from './escape.js';
import { requestLayout } from './layout.js';
import { reducedMotion } from './motion.js';

export const SETTING_EVENT = 'bk:setting';
const THEME_EVENT = 'bake:theme';
const CONTROLS = ['list', 'segmented', 'font', 'switch'];
const FONT_TYPING_PAUSE = 300;

function readingRows(labels) {
  return [
    { name: 'theme', label: labels.theme, text: (value) => labels.themes[value] },
    { name: 'size', fades: true, label: labels.size, text: (value) => labels.sizes[value], glyph: 'A', layout: { arrange: true } },
    { name: 'weight', fades: true, label: labels.weight, text: (value) => labels.weights[value], layout: { arrange: true } },
    { name: 'spacing', fades: true, label: labels.spacing, text: (value) => labels.spacings[value], layout: { arrange: true } },
  ]
    .map((row) => ({ ...row, values: READING_SETTINGS[row.name].values, control: 'segmented' }))
    .concat({ name: 'font', label: labels.font, control: 'font' });
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
  };
  if (row?.fades) fadePage(() => apply(true));
  else apply(false);
}

function chooseFont(families) {
  try {
    if (families === '') localStorage.removeItem(FONT_KEY);
    else localStorage.setItem(FONT_KEY, families);
  } catch {}
  fadePage(() => {
    if (families === '') document.documentElement.style.removeProperty('--reader-font');
    else document.documentElement.style.setProperty('--reader-font', `${families}, var(--font-sans)`);
    requestLayout({ arrange: true, now: true });
  });
}

function storedFont() {
  try {
    return (localStorage.getItem(FONT_KEY) ?? '').replaceAll('"', '');
  } catch {
    return '';
  }
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
  // why: the panel opens upward from its button, so a tall list sits at the top and a switch at the bottom, whatever the order of the declarations
  rows = [...readingRows(labels), ...themeRows(settings, themeLabels)].sort((a, b) => CONTROLS.indexOf(a.control) - CONTROLS.indexOf(b.control));
  values = Object.fromEntries(rows.map((row) => [row.name, createSignal(document.documentElement.dataset[row.name])]));
  const host = document.createElement('div');
  document.querySelector('[data-edge="start"]').append(host);
  render(() => <Settings labels={labels} drawings={drawings} />, host);
  darkScheme.addEventListener('change', followSystemScheme);
  endFadeOnPress();
}

function Settings(props) {
  const { labels, drawings } = props;
  const [open, setOpen] = createSignal(false);
  let root;
  let toggle;
  const home = document.querySelector('.bk-site')?.getAttribute('href');
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
      <div class="bk-settings-buttons">
        {home === undefined ? null : (
          <a class="bk-settings-home" href={home} aria-label={labels.home} title={labels.home}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" d="M3.5 9.2 10 3.6l6.5 5.6v6.6a.7.7 0 0 1-.7.7h-3.6v-4.4H7.8v4.4H4.2a.7.7 0 0 1-.7-.7z" />
            </svg>
          </a>
        )}
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
      </div>
      <div class="bk-settings-panel" id="bk-settings-panel" role="group" aria-label={labels.settings}>
        <For each={rows.filter((row) => row.control === 'font' || settingValue(row.name) !== undefined)}>
          {(row) =>
            row.control === 'list' ? (
              <ListRow row={row} drawings={drawings[row.name]} />
            ) : row.control === 'switch' ? (
              <SwitchRow row={row} />
            ) : row.control === 'font' ? (
              <FontRow row={row} labels={labels} />
            ) : (
              <OptionsRow row={row} />
            )
          }
        </For>
      </div>
    </div>
  );
}

function ListRow(props) {
  const { row, drawings } = props;
  return (
    <div class="bk-settings-row is-list" data-setting={row.name}>
      <span class="bk-settings-label" id={`bk-settings-${row.name}`}>
        {row.label}
      </span>
      <div class="bk-settings-list" role="radiogroup" aria-labelledby={`bk-settings-${row.name}`}>
        <For each={row.values}>
          {(value) => (
            <button type="button" class="bk-settings-choice" role="radio" data-value={value} aria-checked={String(settingValue(row.name) === value)} onClick={() => chooseSetting(row.name, value)}>
              <svg viewBox="0 0 28 28" aria-hidden="true" innerHTML={drawings?.[value]} />
              <b>{row.text(value)}</b>
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

function FontRow(props) {
  const { row, labels } = props;
  const [name, setName] = createSignal(storedFont());
  let typing;
  const type = (event) => {
    setName(event.currentTarget.value);
    clearTimeout(typing);
    typing = setTimeout(() => chooseFont(fontFamilies(name())), FONT_TYPING_PAUSE);
  };
  return (
    <label class="bk-settings-row" data-setting={row.name}>
      <span class="bk-settings-label">{row.label}</span>
      <input
        type="text"
        class="bk-settings-font"
        value={name()}
        placeholder={labels.fontPlaceholder}
        spellcheck={false}
        autocomplete="off"
        style={{ 'font-family': [fontFamilies(name()), 'var(--font-ui)'].filter(Boolean).join(', ') }}
        onInput={type}
      />
    </label>
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
