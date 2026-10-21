import { For, createMemo, createSignal } from 'solid-js'
import { Button, Controls, MathText, Segmented, createTween, formatNumber } from 'bake/kit'
import { fadeIn } from './lib/matrix/view.jsx'
import './lib/matrix/loss.css'

export const params = {
  vocab: { label: 'Vocab size', type: 'enum', options: ['5', '6', '7', '8'], default: '6' },
}
export const layout = { width: 'body' }

const INITIAL = [2, 1, 0, -1, 0.5, -0.5, 1.5, -1.5]
const SIZES = ['5', '6', '7', '8']
const MAX = 8
const LIMIT = 6
const TRACK_HALF = 46

const bar = (value, scale) => ({ transform: `scaleY(${value / scale})` })
const handle = (value) => ({ transform: `translateY(${(-value / LIMIT) * TRACK_HALF}px)` })
const signed = (value) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`

export default function LossLogitBars(props) {
  let charts
  const [logits, setLogits] = createSignal(INITIAL.slice(0, Number(props.vocab)))
  const [target, setTarget] = createSignal(0)

  const state = createMemo(() => {
    const z = logits()
    const max = Math.max(...z)
    const exps = z.map((value) => Math.exp(value - max))
    const sum = exps.reduce((a, b) => a + b, 0)
    const probabilities = exps.map((value) => value / sum)
    const gradients = probabilities.map((p, i) => p - (i === target() ? 1 : 0))
    const gradientSum = gradients.reduce((a, b) => a + b, 0)
    return {
      probabilities,
      gradients,
      loss: max - z[target()] + Math.log(sum),
      probabilitySum: probabilities.reduce((a, b) => a + b, 0),
      gradientSum: Math.abs(gradientSum) < 1e-12 ? 0 : gradientSum,
    }
  })

  const resize = (size) => {
    setLogits((z) => Array.from({ length: size }, (_, i) => z[i] ?? INITIAL[i]))
    if (target() >= size) setTarget(0)
    fadeIn(charts)
  }
  const setLogit = (index, value) => setLogits((z) => z.map((old, i) => (i === index ? value : old)))
  const randomize = () => setLogits((z) => z.map(() => (Math.floor(Math.random() * 121) - 60) / 10))
  const reset = () => {
    setLogits(INITIAL.slice(0, logits().length))
    setTarget(0)
  }
  const padded = (values) => Array.from({ length: MAX }, (_, i) => values[i] ?? 0)
  const shown = createTween(() => [...padded(logits()), ...padded(state().probabilities), ...padded(state().gradients)], { duration: 150 })
  const count = createMemo(() => logits().length)
  const indices = createMemo(() => Array.from({ length: count() }, (_, i) => i))

  return (
    <div class="matrix-figure matrix-loss">
      <Controls>
        <span class="matrix-loss-size">
          Vocab size
          <Segmented label="Vocab size" options={SIZES} value={String(count())} onChange={(value) => resize(Number(value))} />
        </span>
        <span class="matrix-actions">
          <Button onClick={reset}>reset</Button>
          <Button onClick={randomize}>random</Button>
        </span>
      </Controls>
      <div class="matrix-loss-scroll" tabindex="0" role="region" aria-label="各 token 的 logits、概率与梯度柱状图">
        <div ref={charts} class="matrix-loss-charts" style={{ '--count': count() }}>
          <div class="matrix-loss-title">
            <MathText text="Logits $z_i$" />
          </div>
          <div class="matrix-loss-columns matrix-loss-logits">
            <For each={indices()}>
              {(i) => {
                const z = () => logits()[i]
                const isTarget = () => i === target()
                return (
                  <div class="matrix-loss-cell" classList={{ target: isTarget() }}>
                    <button type="button" aria-pressed={isTarget()} aria-label={`设 token ${i + 1} 为目标`} onClick={() => setTarget(i)}>
                      <span class="matrix-loss-word token">Token {i + 1}</span>
                      <span class="matrix-loss-word chosen">目标 {i + 1}</span>
                    </button>
                    <div class="matrix-loss-slider">
                      <span class="matrix-loss-limit top" aria-hidden="true">
                        +6
                      </span>
                      <span class="matrix-loss-limit bottom" aria-hidden="true">
                        −6
                      </span>
                      <div class="matrix-loss-track">
                        <For each={['plain', 'chosen']}>
                          {(kind) => (
                            <span class={'matrix-loss-mark ' + kind}>
                              <span class="matrix-loss-bar" style={bar(shown()[i], LIMIT)} />
                              <span class="matrix-loss-handle" style={handle(shown()[i])} />
                            </span>
                          )}
                        </For>
                      </div>
                      <input
                        type="range"
                        min={-LIMIT}
                        max={LIMIT}
                        step="0.1"
                        value={z()}
                        aria-label={`Token ${i + 1} 的 logit`}
                        aria-valuetext={formatNumber(z(), 1)}
                        onInput={(event) => setLogit(i, Number(event.currentTarget.value))}
                      />
                    </div>
                    <output class="matrix-loss-z">
                      <span class="matrix-loss-word token">{formatNumber(z(), 1)}</span>
                      <span class="matrix-loss-word chosen" aria-hidden="true">
                        {formatNumber(z(), 1)}
                      </span>
                    </output>
                  </div>
                )
              }}
            </For>
          </div>
          <div class="matrix-loss-legend">
            <span class="matrix-loss-probability">
              <MathText text="概率 $p_i$" />
            </span>
            <span class="matrix-loss-gradient">
              <MathText text="梯度 $p_i-y_i$" />
            </span>
          </div>
          <div class="matrix-loss-columns matrix-loss-results">
            <For each={indices()}>
              {(i) => (
                <div class="matrix-loss-cell" classList={{ target: i === target() }}>
                  <div class="matrix-loss-values">
                    <output class="matrix-loss-probability" aria-label={`Token ${i + 1} 的概率`}>
                      {state().probabilities[i].toFixed(3)}
                    </output>
                    <output class="matrix-loss-gradient" aria-label={`Token ${i + 1} 的梯度`}>
                      {signed(state().gradients[i])}
                    </output>
                  </div>
                  <div class="matrix-loss-pair">
                    <span class="matrix-loss-bar matrix-loss-probability" style={bar(shown()[MAX + i], 1)} />
                    <span class="matrix-loss-bar matrix-loss-gradient" style={bar(shown()[2 * MAX + i], 1)} />
                  </div>
                  <span class="matrix-loss-caption">Token {i + 1}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
      <div class="matrix-loss-total">
        <MathText text="Loss $\ell=-\ln p_y$" />
        <output>{state().loss.toFixed(4)}</output>
      </div>
      <p class="matrix-loss-sums">
        概率之和 = <output>{state().probabilitySum.toFixed(3)}</output>；梯度分量之和 = <output>{state().gradientSum.toFixed(3)}</output>
      </p>
    </div>
  )
}
