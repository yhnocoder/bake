import { createUniqueId, For } from 'solid-js';
import { formatNumber, stepDigits } from './numbers.js';
import './controls.css';

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
        aria-valuetext={format(props.value)}
        style={{ '--bk-kit-fill': fill() }}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <span class="bk-kit-value" aria-hidden="true">
        {format(props.value)}
      </span>
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
            {option.label}
          </label>
        )}
      </For>
    </div>
  );
}

export function Toggle(props) {
  return (
    <label class="bk-kit-toggle">
      <span class="bk-kit-switch">
        <input type="checkbox" role="switch" checked={props.checked} onChange={(event) => props.onChange(event.currentTarget.checked)} />
      </span>
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
