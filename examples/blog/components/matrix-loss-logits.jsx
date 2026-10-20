import { For, createMemo, createSignal } from 'solid-js'
import { MathText } from './lib/matrix/view.jsx'
import './lib/matrix/loss.css'

export const params = {
  vocab: { label: 'Vocab size', type: 'enum', options: ['5', '6', '7', '8'], default: '6' },
}
export const layout = { width: 'body', height: 545 }

const INITIAL = [2, 1, 0, -1, 0.5, -0.5, 1.5, -1.5]
const SIZES = [5, 6, 7, 8]

function barStyle(value, scale) {
  return {
    bottom: `${value < 0 ? 50 + (value * 50) / scale : 50}%`,
    height: `${(Math.abs(value) * 50) / scale}%`,
  }
}

const signed = (value) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(3)}`

export default function LossLogitBars(props) {
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
  }
  const setLogit = (index, value) => setLogits((z) => z.map((old, i) => (i === index ? value : old)))
  const randomize = () => setLogits((z) => z.map(() => (Math.floor(Math.random() * 121) - 60) / 10))
  const reset = () => {
    setLogits(INITIAL.slice(0, logits().length))
    setTarget(0)
  }
  const indices = () => logits().map((_, i) => i)

  return (
    <div class="matrix-figure matrix-loss">
      <div class="matrix-loss-toolbar">
        <label>
          Vocab size
          <select value={logits().length} onChange={(event) => resize(Number(event.currentTarget.value))}>
            <For each={SIZES}>{(size) => <option value={size} selected={size === logits().length}>{size}</option>}</For>
          </select>
        </label>
        <div class="matrix-loss-actions">
          <button type="button" onClick={reset}>reset</button>
          <button type="button" onClick={randomize}>random</button>
        </div>
      </div>
      <div class="matrix-loss-scroll" tabindex="0" role="region" aria-label="各 token 的 logits、概率与梯度柱状图">
        <div class="matrix-loss-charts" style={{ '--count': logits().length }}>
          <div class="matrix-loss-title"><MathText text="Logits $z_i$" /></div>
          <div class="matrix-loss-columns matrix-loss-logits">
            <For each={indices()}>
              {(i) => {
                const z = () => logits()[i]
                const isTarget = () => i === target()
                return (
                  <div class="matrix-loss-cell" classList={{ target: isTarget() }}>
                    <button type="button" aria-pressed={isTarget()} aria-label={`设 token ${i + 1} 为目标`} onClick={() => setTarget(i)}>
                      {isTarget() ? '目标' : 'Token'} {i + 1}
                    </button>
                    <div class="matrix-loss-slider">
                      <span class="matrix-loss-limit top" aria-hidden="true">+6</span>
                      <span class="matrix-loss-limit bottom" aria-hidden="true">−6</span>
                      <div class="matrix-loss-track">
                        <span class="matrix-loss-bar" style={barStyle(z(), 6)} />
                        <span class="matrix-loss-handle" style={{ bottom: `${((z() + 6) / 12) * 100}%` }} />
                      </div>
                      <input
                        type="range"
                        min="-6"
                        max="6"
                        step="0.1"
                        value={z()}
                        aria-label={`Token ${i + 1} 的 logit`}
                        onInput={(event) => setLogit(i, Number(event.currentTarget.value))}
                      />
                    </div>
                    <output class="matrix-loss-z">{z().toFixed(1)}</output>
                  </div>
                )
              }}
            </For>
          </div>
          <div class="matrix-loss-legend">
            <span class="matrix-loss-probability"><MathText text="概率 $p_i$" /></span>
            <span class="matrix-loss-gradient"><MathText text="梯度 $p_i-y_i$" /></span>
          </div>
          <div class="matrix-loss-columns">
            <For each={indices()}>
              {(i) => (
                <div class="matrix-loss-cell" classList={{ target: i === target() }}>
                  <div class="matrix-loss-values">
                    <output class="matrix-loss-probability" aria-label={`Token ${i + 1} 的概率`}>{state().probabilities[i].toFixed(3)}</output>
                    <output class="matrix-loss-gradient" aria-label={`Token ${i + 1} 的梯度`}>{signed(state().gradients[i])}</output>
                  </div>
                  <div class="matrix-loss-pair">
                    <span class="matrix-loss-bar matrix-loss-probability" style={barStyle(state().probabilities[i], 1)} />
                    <span class="matrix-loss-bar matrix-loss-gradient" style={barStyle(state().gradients[i], 1)} />
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
