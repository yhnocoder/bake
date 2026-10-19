import { createComputed, createMemo, createResource, createSignal, createUniqueId, For, onCleanup, onMount, Show } from 'solid-js';
import { texToSvg } from 'bake/math';
import { gelu, geluSigmoid, geluTanh, relu, swish } from './lib/activations.js';
import { formatNumber, niceTicks } from './lib/ticks.js';
import { createTween } from './lib/tween.js';
import './lib/act-fn-plot.css';

export const params = {
  fn: { label: '函数', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
  range: { label: '横轴范围', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  beta: { label: 'β 初始值', type: 'number', min: 0, max: 4, step: 0.1, default: 1 },
};

export const layout = {
  width: 'body',
  height: 340,
  narrowHeight: (params) => (params.fn === 'relu' ? 470 : params.fn === 'gelu' ? 500 : 520),
};

const PANEL_GAP = 16;
const TITLE_HEIGHT = 24;
const TARGET_ASPECT = 1.5;
const MARGIN = { left: 34, right: 8, top: 8, bottom: 22 };
const SAMPLE_SPACING = 2;
const FIT_SAMPLES = 200;
const TWEEN_MS = 200;
const READOUT_OFFSET = 12;

function curvesFor(fn, beta) {
  if (fn === 'relu') return [{ name: 'ReLU', tex: '\\mathrm{ReLU}(x)', texWidth: '5.4em', color: 'var(--series-1)', ...relu }];
  if (fn === 'silu') return [{ name: 'SiLU', tex: 'x\\,\\sigma(\\beta x)', texWidth: '4.2em', color: 'var(--series-1)', ...swish(beta) }];
  return [
    { name: 'GELU', tex: '\\mathrm{GELU}(x)', texWidth: '5.6em', color: 'var(--series-1)', ...gelu },
    { name: 'tanh 近似', color: 'var(--series-2)', dashed: true, ...geluTanh },
    { name: 'σ 近似', tex: 'x\\,\\sigma(1.702x)', texWidth: '6.4em', color: 'var(--series-3)', dashed: true, ...geluSigmoid },
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

function curvePath(curve, key, x0, x1, sx, sy, samples) {
  const fn = curve[key];
  const breaks = key === 'd' ? curve.breaks : [];
  const step = (x1 - x0) / samples;
  let path = '';
  let drawing = false;
  for (let index = 0; index <= samples; index++) {
    const x = x0 + step * index;
    const y = fn(x);
    if (!Number.isFinite(y) || breaks.some((at) => x - step < at && x >= at)) {
      drawing = false;
      if (!Number.isFinite(y)) continue;
    }
    path += (drawing ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1);
    drawing = true;
  }
  return path;
}

function Tex(props) {
  const [svg] = createResource(() => props.tex, (tex) => texToSvg(tex));
  return (
    <span class="act-plot-tex" style={{ 'min-width': props.width }}>
      {svg()}
    </span>
  );
}

function Slider(props) {
  const fill = () => ((props.value - props.min) / (props.max - props.min)) * 100 + '%';
  return (
    <label class="act-plot-slider">
      <span class="act-plot-slider-label">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ '--act-plot-fill': fill() }}
        onInput={(event) => props.onInput(Number(event.currentTarget.value))}
      />
      <span class="act-plot-value">{props.format(props.value)}</span>
    </label>
  );
}

function Panel(props) {
  let svg;
  let readoutBox;
  const plotWidth = () => props.width - MARGIN.left - MARGIN.right;
  const plotHeight = () => props.height - MARGIN.top - MARGIN.bottom;
  const sx = (x) => MARGIN.left + ((x - props.x[0]) / (props.x[1] - props.x[0])) * plotWidth();
  const sy = (y) => MARGIN.top + ((props.y[1] - y) / (props.y[1] - props.y[0])) * plotHeight();
  const xTicks = () => niceTicks(props.x[0], props.x[1], Math.max(2, Math.floor(plotWidth() / 44)));
  const yTicks = () => niceTicks(props.y[0], props.y[1], Math.max(2, Math.floor(plotHeight() / 40)));
  const samples = () => Math.max(40, Math.round(plotWidth() / SAMPLE_SPACING));
  const hovered = () => props.hover?.panel === props.valueKey;
  const readout = () => props.curves.map((curve) => ({ curve, y: curve[props.valueKey](props.hover.x) }));
  const readoutLeft = () => {
    if (!hovered()) return 0;
    const width = readoutBox.offsetWidth;
    const right = props.hover.left + READOUT_OFFSET;
    const left = right + width > props.width ? props.hover.left - READOUT_OFFSET - width : right;
    return Math.max(0, Math.min(props.width - width, left));
  };

  function onPointer(event) {
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (px < MARGIN.left || px > props.width - MARGIN.right) return props.onHover(null);
    const x = props.x[0] + ((px - MARGIN.left) / plotWidth()) * (props.x[1] - props.x[0]);
    props.onHover({ x, panel: props.valueKey, left: px });
  }

  return (
    <div class="act-plot-panel">
      <div class="act-plot-panel-title">
        <Tex tex={props.title} />
      </div>
      <div class="act-plot-box" style={{ width: props.width + 'px', height: props.height + 'px' }}>
        <svg
          ref={svg}
          class="act-plot-svg"
          width={props.width}
          height={props.height}
          viewBox={`0 0 ${props.width} ${props.height}`}
          role="img"
          aria-label={props.label}
          onPointerDown={onPointer}
          onPointerMove={onPointer}
          onPointerLeave={() => props.onHover(null)}
          onPointerCancel={() => props.onHover(null)}
        >
          <clipPath id={props.clipId}>
            <rect x={MARGIN.left} y={MARGIN.top} width={plotWidth()} height={plotHeight()} />
          </clipPath>
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line class="act-plot-grid" x1={MARGIN.left} x2={props.width - MARGIN.right} y1={sy(tick.value)} y2={sy(tick.value)} />
                <text class="act-plot-tick" x={MARGIN.left - 6} y={sy(tick.value)} text-anchor="end" dominant-baseline="middle">
                  {tick.label}
                </text>
              </>
            )}
          </For>
          <For each={xTicks()}>
            {(tick) => (
              <>
                <line class="act-plot-grid" x1={sx(tick.value)} x2={sx(tick.value)} y1={MARGIN.top} y2={MARGIN.top + plotHeight()} />
                <text class="act-plot-tick" x={sx(tick.value)} y={props.height - 6} text-anchor="middle">
                  {tick.label}
                </text>
              </>
            )}
          </For>
          <line class="act-plot-axis" x1={MARGIN.left} x2={props.width - MARGIN.right} y1={sy(0)} y2={sy(0)} />
          <line class="act-plot-axis" x1={sx(0)} x2={sx(0)} y1={MARGIN.top} y2={MARGIN.top + plotHeight()} />
          <g clip-path={`url(#${props.clipId})`}>
            <For each={props.curves}>
              {(curve) => (
                <path
                  class="act-plot-curve"
                  classList={{ 'act-plot-dashed': curve.dashed }}
                  stroke={curve.color}
                  d={curvePath(curve, props.valueKey, props.x[0], props.x[1], sx, sy, samples())}
                />
              )}
            </For>
          </g>
          <Show when={props.hover}>
            <line class="act-plot-crosshair" x1={sx(props.hover.x)} x2={sx(props.hover.x)} y1={MARGIN.top} y2={MARGIN.top + plotHeight()} />
            <For each={readout().filter(({ y }) => Number.isFinite(y) && y >= props.y[0] && y <= props.y[1])}>
              {({ curve, y }) => <circle class="act-plot-dot" cx={sx(props.hover.x)} cy={sy(y)} r="3.5" fill={curve.color} />}
            </For>
          </Show>
        </svg>
        <div ref={readoutBox} class="act-plot-readout" classList={{ 'act-plot-readout-visible': hovered() }} style={{ left: readoutLeft() + 'px' }} aria-hidden="true">
          <Show when={props.hover}>
            <div class="act-plot-readout-row">
              <span>x</span>
              <span class="act-plot-readout-number">{formatNumber(props.hover.x, 2)}</span>
            </div>
            <For each={readout()}>
              {({ curve, y }) => (
                <div class="act-plot-readout-row">
                  <span>
                    <i class="act-plot-swatch" classList={{ 'act-plot-dashed': curve.dashed }} style={{ '--act-plot-color': curve.color }} />
                    {curve.name}
                  </span>
                  <span class="act-plot-readout-number">{Number.isFinite(y) ? formatNumber(y, 3) : '—'}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
}

export default function ActFnPlot(props) {
  const [span, setSpan] = createSignal();
  const [beta, setBeta] = createSignal();
  createComputed(() => setSpan(props.range));
  createComputed(() => setBeta(props.beta));
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [hover, setHover] = createSignal(null);
  const clipPrefix = 'act-plot-clip-' + createUniqueId();
  let panels;

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }));
    observer.observe(panels);
    onCleanup(() => observer.disconnect());
  });

  const curves = createMemo(() => curvesFor(props.fn, beta()));
  const target = createMemo(() => {
    const x = [-span(), span()];
    return [...x, ...fitRange(curves(), 'f', ...x), ...fitRange(curves(), 'd', ...x)];
  });
  const view = createTween(target, TWEEN_MS);
  const box = createMemo(() => arrange(size().width, size().height));

  const panel = (valueKey, title, label) => (
    <Panel
      valueKey={valueKey}
      title={title}
      label={label}
      clipId={clipPrefix + valueKey}
      width={box().width}
      height={box().height}
      x={view().slice(0, 2)}
      y={valueKey === 'f' ? view().slice(2, 4) : view().slice(4, 6)}
      curves={curves()}
      hover={hover()}
      onHover={setHover}
    />
  );

  return (
    <div class="act-plot">
      <div class="act-plot-head">
        <div class="act-plot-legend">
          <For each={curves()}>
            {(curve) => (
              <span class="act-plot-legend-item">
                <i class="act-plot-swatch" classList={{ 'act-plot-dashed': curve.dashed }} style={{ '--act-plot-color': curve.color }} />
                {curve.tex ? <Tex tex={curve.tex} width={curve.texWidth} /> : curve.name}
              </span>
            )}
          </For>
        </div>
        <div class="act-plot-controls">
          <Slider label="横轴范围" min={1} max={10} step={0.5} value={span()} onInput={setSpan} format={(value) => '±' + value.toFixed(1)} />
          <Show when={props.fn === 'silu'}>
            <Slider label="β" min={0} max={4} step={0.1} value={beta()} onInput={setBeta} format={(value) => value.toFixed(1)} />
          </Show>
        </div>
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
