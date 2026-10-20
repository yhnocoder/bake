import { batch, createContext, createMemo, createSignal, createUniqueId, For, Index, onCleanup, Show, useContext } from 'solid-js';
import { Swatch } from './legend.jsx';
import { formatNumber, linearScale, niceTicks, samplePath } from './numbers.js';
import { createElementSize } from './size.js';
import './plot.css';

const MARGIN = { left: 34, right: 8, top: 8, bottom: 22 };
const X_TICK_SPACING = 44;
const Y_TICK_SPACING = 40;
const SAMPLE_SPACING = 2;
const MIN_SAMPLES = 40;
const READOUT_TOP = 2;

const PlotContext = createContext();

export function usePlot() {
  const plot = useContext(PlotContext);
  if (plot === undefined) throw new Error('Axes, Curve and Crosshair are drawn inside a Plot');
  return plot;
}

export function Plot(props) {
  let box;
  const fillsWidth = props.width === undefined;
  const fillsHeight = props.height === undefined;
  const measured = fillsWidth || fillsHeight ? createElementSize(() => box) : () => ({ width: 0, height: 0 });
  const width = () => props.width ?? measured().width;
  const height = () => props.height ?? measured().height;
  const margin = () => ({ ...MARGIN, ...props.margin });
  const area = () => ({ left: margin().left, top: margin().top, right: width() - margin().right, bottom: height() - margin().bottom });
  const x = createMemo(() => linearScale(props.x, [area().left, area().right]));
  const y = createMemo(() => linearScale(props.y, [area().bottom, area().top]));
  const [ownPointer, setOwnPointer] = createSignal(null);
  const [inside, setInside] = createSignal(false);
  const [series, setSeries] = createSignal([]);
  const pointer = () => ('pointer' in props ? props.pointer : ownPointer());
  const setPointer = (value) => (props.onPointer ?? setOwnPointer)(value);

  const plot = {
    x,
    y,
    width,
    height,
    area,
    pointer,
    inside,
    series,
    xDomain: () => props.x,
    yDomain: () => props.y,
    clipId: `bk-kit-clip-${createUniqueId()}`,
    register(item) {
      setSeries((items) => [...items, item]);
      onCleanup(() => setSeries((items) => items.filter((other) => other !== item)));
    },
  };

  function track(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = ((event.clientX - rect.left) / rect.width) * width();
    const within = position >= area().left && position <= area().right;
    batch(() => {
      setInside(within);
      setPointer(within ? x().invert(position) : null);
    });
  }

  function leave() {
    batch(() => {
      setInside(false);
      setPointer(null);
    });
  }

  return (
    <div ref={box} class="bk-kit-plot" classList={{ 'bk-kit-plot-fill-width': fillsWidth, 'bk-kit-plot-fill-height': fillsHeight }} style={{ width: fillsWidth ? undefined : `${props.width}px`, height: fillsHeight ? undefined : `${props.height}px` }}>
      <Show when={width() > 0 && height() > 0}>
        <svg
          class="bk-kit-plot-svg"
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          role="img"
          aria-label={props.label}
          onPointerDown={track}
          onPointerMove={track}
          onPointerLeave={leave}
          onPointerCancel={leave}
        >
          <clipPath id={plot.clipId}>
            <rect x={area().left} y={area().top} width={area().right - area().left} height={area().bottom - area().top} />
          </clipPath>
          <PlotContext.Provider value={plot}>{props.children}</PlotContext.Provider>
        </svg>
      </Show>
    </div>
  );
}

export function Axes(props) {
  const plot = usePlot();
  const xTicks = () => niceTicks(...plot.xDomain(), Math.max(2, Math.floor((plot.area().right - plot.area().left) / X_TICK_SPACING)));
  const yTicks = () => niceTicks(...plot.yDomain(), Math.max(2, Math.floor((plot.area().bottom - plot.area().top) / Y_TICK_SPACING)));
  const grid = () => props.grid ?? true;
  const contains = ([low, high]) => low <= 0 && high >= 0;
  return (
    <g class="bk-kit-axes">
      <For each={yTicks()}>
        {(tick) => (
          <>
            <Show when={grid()}>
              <line class="bk-kit-grid" x1={plot.area().left} x2={plot.area().right} y1={plot.y()(tick.value)} y2={plot.y()(tick.value)} />
            </Show>
            <text class="bk-kit-tick" x={plot.area().left - 6} y={plot.y()(tick.value)} text-anchor="end" dominant-baseline="middle">
              {tick.label}
            </text>
          </>
        )}
      </For>
      <For each={xTicks()}>
        {(tick) => (
          <>
            <Show when={grid()}>
              <line class="bk-kit-grid" x1={plot.x()(tick.value)} x2={plot.x()(tick.value)} y1={plot.area().top} y2={plot.area().bottom} />
            </Show>
            <text class="bk-kit-tick" x={plot.x()(tick.value)} y={plot.height() - 6} text-anchor="middle">
              {tick.label}
            </text>
          </>
        )}
      </For>
      <Show when={contains(plot.yDomain())}>
        <line class="bk-kit-axis" x1={plot.area().left} x2={plot.area().right} y1={plot.y()(0)} y2={plot.y()(0)} />
      </Show>
      <Show when={contains(plot.xDomain())}>
        <line class="bk-kit-axis" x1={plot.x()(0)} x2={plot.x()(0)} y1={plot.area().top} y2={plot.area().bottom} />
      </Show>
    </g>
  );
}

export function Curve(props) {
  const plot = usePlot();
  plot.register(props);
  const samples = () => props.samples ?? Math.max(MIN_SAMPLES, Math.round((plot.area().right - plot.area().left) / SAMPLE_SPACING));
  const path = createMemo(() => samplePath(props.f, plot.xDomain(), plot.x(), plot.y(), samples(), props.breaks));
  return <path class="bk-kit-curve" classList={{ 'bk-kit-dashed': props.dashed }} stroke={props.color} clip-path={`url(#${plot.clipId})`} d={path()} />;
}

export function Crosshair(props) {
  const plot = usePlot();
  const shownX = createMemo(() => (plot.pointer() === null ? null : Number(plot.pointer().toFixed(props.xDigits ?? 2))));
  const at = () => plot.x()(shownX());
  const visible = () => plot.inside() && plot.pointer() !== null;
  const inRange = (value) => Number.isFinite(value) && value >= plot.yDomain()[0] && value <= plot.yDomain()[1];
  const readX = createMemo((last) => (visible() ? shownX() : last), null);
  const labelled = () => plot.series().filter((item) => item.label !== undefined);
  return (
    <>
      <Show when={shownX() !== null}>
        <line class="bk-kit-crosshair" x1={at()} x2={at()} y1={plot.area().top} y2={plot.area().bottom} />
        <Index each={plot.series()}>
          {(item) => {
            const value = () => item().f(shownX());
            return (
              <Show when={inRange(value())}>
                <circle class="bk-kit-dot" cx={at()} cy={plot.y()(value())} r="3.5" fill={item().color} />
              </Show>
            );
          }}
        </Index>
      </Show>
      <foreignObject class="bk-kit-readout-layer" x="0" y="0" width={plot.width()} height={plot.height()} aria-hidden="true">
        <div
          class="bk-kit-readout"
          classList={{ 'bk-kit-readout-visible': visible(), 'bk-kit-readout-left': readX() !== null && plot.x()(readX()) > plot.width() / 2 }}
          style={{ left: `${readX() === null ? 0 : plot.x()(readX())}px`, top: `${plot.area().top + READOUT_TOP}px` }}
        >
          <Show when={readX() !== null}>
            <div class="bk-kit-readout-row">
              <span>{props.xLabel ?? 'x'}</span>
              <span class="bk-kit-readout-number">{formatNumber(readX(), props.xDigits ?? 2)}</span>
            </div>
            <Index each={labelled()}>
              {(item) => {
                const value = () => item().f(readX());
                return (
                  <div class="bk-kit-readout-row">
                    <span>
                      <Swatch color={item().color} dashed={item().dashed} />
                      {item().label}
                    </span>
                    <span class="bk-kit-readout-number">{Number.isFinite(value()) ? formatNumber(value(), props.yDigits ?? 3) : '—'}</span>
                  </div>
                );
              }}
            </Index>
          </Show>
        </div>
      </foreignObject>
    </>
  );
}
