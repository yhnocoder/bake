import { createUniqueId, For } from 'solid-js';
import { formatNumber, stepDigits } from './numbers.js';

const optionOf = (option) => (typeof option === 'string' ? { value: option, label: option } : option);

export function Controls(props) {
  return <div class="bk-kit-controls">{props.children}</div>;
}

export function Slider(props) {
  const step = () => props.step ?? 1;
  const format = (value) => (props.format ?? ((number) => formatNumber(number, stepDigits(step()))))(value);
  const fill = () => `${((props.value - props.min) / (props.max - props.min)) * 100}%`;
  return (
    <label class="bk-kit-slider">
      <span class="bk-kit-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={step()}
        value={props.value}
        style={{ '--bk-kit-fill': fill() }}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <span class="bk-kit-value">{format(props.value)}</span>
    </label>
  );
}

export function Segmented(props) {
  const name = `bk-kit-segmented-${createUniqueId()}`;
  return (
    <div class="bk-kit-segmented" role="radiogroup" aria-label={props.label}>
      <For each={props.options.map(optionOf)}>
        {(option) => (
          <label class="bk-kit-segment">
            <input type="radio" name={name} value={option.value} checked={props.value === option.value} onChange={() => props.onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        )}
      </For>
    </div>
  );
}

export function Toggle(props) {
  return (
    <label class="bk-kit-toggle">
      <input type="checkbox" role="switch" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      <span class="bk-kit-toggle-track" aria-hidden="true" />
      <span class="bk-kit-label">{props.label}</span>
    </label>
  );
}

export function Button(props) {
  return (
    <button type="button" class="bk-kit-button" disabled={props.disabled} onClick={() => props.onClick()}>
      {props.children}
    </button>
  );
}
