import { createComputed, createMemo, createSignal, For, Show } from 'solid-js';
import { Axes, Controls, Crosshair, Curve, Legend, Plot, Segmented, Slider, Tex, Toggle, createElementSize, createTween, formatNumber } from 'bake/kit';
import { gelu, geluSigmoid, geluTanh, relu, swish } from './lib/activations.js';
import './lib/act-fn-plot.css';

export const params = {
  fn: { label: '函数', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
  range: { label: '横轴范围', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  beta: { label: 'β 初始值', type: 'number', min: 0, max: 4, step: 0.1, default: 1 },
};

export const layout = {
  width: 'body',
  height: 340,
  narrowHeight: 560,
};

const FUNCTIONS = [
  { value: 'relu', label: 'ReLU' },
  { value: 'gelu', label: 'GELU' },
  { value: 'silu', label: 'SiLU' },
];
const PANEL_GAP = 16;
const TITLE_HEIGHT = 24;
const TARGET_ASPECT = 1.5;
const FIT_SAMPLES = 200;

function curvesFor(fn, beta, approximations) {
  if (fn === 'relu') return [{ label: 'ReLU', tex: '\\mathrm{ReLU}(x)', texWidth: '5.4em', color: 'var(--series-1)', ...relu }];
  if (fn === 'silu') return [{ label: 'SiLU', tex: 'x\\,\\sigma(\\beta x)', texWidth: '4.2em', color: 'var(--series-1)', ...swish(beta) }];
  const exact = { label: 'GELU', tex: '\\mathrm{GELU}(x)', texWidth: '5.6em', color: 'var(--series-1)', ...gelu };
  if (!approximations) return [exact];
  return [
    exact,
    { label: 'tanh 近似', color: 'var(--series-2)', dashed: true, ...geluTanh },
    { label: 'σ 近似', tex: 'x\\,\\sigma(1.702x)', texWidth: '6.4em', color: 'var(--series-3)', dashed: true, ...geluSigmoid },
  ];
}

function fitRange(curves, key, low, high) {
  let min = 0;
  let max = 0;
  for (const curve of curves) {
    for (let index = 0; index <= FIT_SAMPLES; index++) {
      const y = curve[key](low + ((high - low) * index) / FIT_SAMPLES);
      if (!Number.isFinite(y)) continue;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
  }
  const padding = Math.max((max - min) * 0.08, 0.05);
  return [min - padding, max + padding];
}

function arrange(width, height) {
  const columns = { columns: 2, width: (width - PANEL_GAP) / 2, height: height - TITLE_HEIGHT };
  const rows = { columns: 1, width, height: (height - PANEL_GAP) / 2 - TITLE_HEIGHT };
  const distance = (option) => Math.abs(Math.log(option.width / Math.max(1, option.height) / TARGET_ASPECT));
  const chosen = distance(columns) <= distance(rows) ? columns : rows;
  return { columns: chosen.columns, width: Math.floor(chosen.width), height: Math.max(0, Math.floor(chosen.height)) };
}

export default function ActFnPlot(props) {
  const [fn, setFn] = createSignal();
  const [span, setSpan] = createSignal();
  const [beta, setBeta] = createSignal();
  const [approximations, setApproximations] = createSignal(true);
  createComputed(() => setFn(props.fn));
  createComputed(() => setSpan(props.range));
  createComputed(() => setBeta(props.beta));
  const [pointer, setPointer] = createSignal(null);
  let panels;
  const size = createElementSize(() => panels);

  const curves = createMemo(() => curvesFor(fn(), beta(), approximations()));
  const target = createMemo(() => {
    const x = [-span(), span()];
    return [...x, ...fitRange(curves(), 'f', ...x), ...fitRange(curves(), 'd', ...x)];
  });
  const view = createTween(target);
  const box = createMemo(() => arrange(size().width, size().height));

  const panel = (key, title, label) => (
    <div class="act-plot-panel">
      <div class="act-plot-panel-title">
        <Tex tex={title} />
      </div>
      <Plot
        width={box().width}
        height={box().height}
        x={view().slice(0, 2)}
        y={key === 'f' ? view().slice(2, 4) : view().slice(4, 6)}
        label={label}
        pointer={pointer()}
        onPointer={setPointer}
      >
        <Axes />
        <For each={curves()}>{(curve) => <Curve f={curve[key]} breaks={key === 'd' ? curve.breaks : []} color={curve.color} dashed={curve.dashed} label={curve.label} />}</For>
        <Crosshair />
      </Plot>
    </div>
  );

  return (
    <div class="act-plot">
      <div class="act-plot-head">
        <Legend items={curves()} />
        <Controls>
          <Segmented label="函数" options={FUNCTIONS} value={fn()} onChange={setFn} />
          <Slider label="横轴范围" min={1} max={10} step={0.5} value={span()} onInput={setSpan} format={(value) => `±${value.toFixed(1)}`} />
          <Show when={fn() === 'silu'}>
            <Slider label="β" min={0} max={4} step={0.1} value={beta()} onInput={setBeta} format={(value) => formatNumber(value, 1)} />
          </Show>
          <Show when={fn() === 'gelu'}>
            <Toggle label="近似" checked={approximations()} onChange={setApproximations} />
          </Show>
        </Controls>
      </div>
      <div ref={panels} class="act-plot-panels" style={{ 'grid-template-columns': `repeat(${box().columns}, ${box().width}px)` }}>
        <Show when={size().width > 0 && box().height > 0}>
          {panel('f', 'f(x)', '函数曲线')}
          {panel('d', "f'(x)", '导数曲线')}
        </Show>
      </div>
    </div>
  );
}
