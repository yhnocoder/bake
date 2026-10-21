import { For, Match, Switch, createSignal } from 'solid-js'
import { MathText, formatNumber } from 'bake/kit'
import { fadeIn } from './lib/view.jsx'
import { Matrix } from './lib/matrix.jsx'

export const params = {}
export const layout = { width: 'body', placeholder: { narrow: 760, wide: 394 } }

const WEIGHTS = [
  [1, 1, 0.5],
  [-2, 0, 1],
]
const X = [
  [1, -0.5],
  [0.5, 1],
  [-1, 0.5],
]
const TARGETS = [0, 1, 2]
const T = X.length
const N = X[0].length

function softmax(z) {
  const e = z.map(Math.exp)
  const sum = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / sum)
}

const logits = (x) => [0, 1, 2].map((j) => x[0] * WEIGHTS[0][j] + x[1] * WEIGHTS[1][j])
const G = X.map((x, t) => softmax(logits(x)).map((p, j) => (p - (j === TARGETS[t] ? 1 : 0)) / T))
const M = G[0].length
const OUTER = X.map((x, t) => x.map((xi) => G[t].map((g) => xi * g)))
const SUM = OUTER[0].map((row, i) => row.map((_, j) => OUTER.reduce((total, outer) => total + outer[i][j], 0)))

const format = (v) => (Number.isInteger(v * 2) ? String(v).replace('-', '−') : formatNumber(v, 3))
const operand = (v) => (v < 0 ? `(${format(v)})` : format(v))
const grid = (rows, columns, make) =>
  Array.from({ length: rows }, (_, a) => Array.from({ length: columns }, (_, b) => make(a, b))).flat()
const key = (role, t, i, j) => `${role}:${t}:${i}:${j}`

const INTRO =
  '每个位置贡献一个外积 $\\mathbf{x}_t^{T}\\,\\dfrac{\\partial L}{\\partial \\mathbf{z}_t}$，三个外积相加得到 $X^{T}G$。指针停在任意一格上显示该格的计算。'

function Message(props) {
  const say = () => props.say
  const P = () => say().t + 1
  const I = () => say().i + 1
  const J = () => say().j + 1
  return (
    <Switch fallback={<MathText text={INTRO} />}>
      <Match when={say().role === 'o'}>
        位置 {P()} 的外积第 {I()} 行第 {J()} 列：<MathText text={`$X_{${P()}${I()}}\\,G_{${P()}${J()}}$`} /> = {operand(X[say().t][say().i])} × {operand(G[say().t][say().j])} ={' '}
        <b>{format(OUTER[say().t][say().i][say().j])}</b>。它是 <MathText text="$X^{T}G$" /> 同一格求和中的一项。
      </Match>
      <Match when={say().role === 's'}>
        <MathText text={`$\\partial L / \\partial W_{${I()}${J()}} = \\sum_t X_{t${I()}}\\,G_{t${J()}}$`} /> = {X.map((_, s) => `${operand(X[s][say().i])} × ${operand(G[s][say().j])}`).join(' + ')} ={' '}
        <b>{format(SUM[say().i][say().j])}</b>，三项依次来自三个位置。
      </Match>
      <Match when={say().role === 'x'}>
        <MathText text={`$X_{${P()}${I()}}$`} /> = <b>{format(X[say().t][say().i])}</b> 乘 <MathText text="$G$" /> 的第 {P()} 行，得到位置 {P()} 的外积的第 {I()} 行{' '}
        <b>{OUTER[say().t][say().i].map(format).join('　')}</b>。
      </Match>
      <Match when={say().role === 'g'}>
        <MathText text={`$G_{${P()}${J()}}$`} /> = <b>{format(G[say().t][say().j])}</b> 乘 <MathText text="$X$" /> 第 {P()} 行的转置，得到位置 {P()} 的外积的第 {J()} 列{' '}
        <b>{OUTER[say().t].map((row) => format(row[say().j])).join('　')}</b>。
      </Match>
    </Switch>
  )
}

export default function OuterProductSum() {
  const [lit, setLit] = createSignal(new Set())
  const [say, setSay] = createSignal({ role: null })
  let say$

  const cell = (role, t, i, j, value) => ({ key: key(role, t, i, j), role, t, i, j, value: format(value) })
  const inputCells = grid(T, N, (t, i) => cell('x', t, i, -1, X[t][i]))
  const gradientCells = grid(T, M, (t, j) => cell('g', t, -1, j, G[t][j]))
  const outerCells = OUTER.map((outer, t) => grid(N, M, (i, j) => cell('o', t, i, j, outer[i][j])))
  const sumCells = grid(N, M, (i, j) => cell('s', -1, i, j, SUM[i][j]))
  const all = [inputCells, gradientCells, ...outerCells, sumCells].flat()

  const enter = (target) => {
    const { role, t, i, j } = target
    const keys = new Set([target.key])
    const light = (match) => all.filter(match).forEach((other) => keys.add(other.key))
    if (role === 'o') {
      light((c) => c.role === 'x' && c.t === t && c.i === i)
      light((c) => c.role === 'g' && c.t === t && c.j === j)
      light((c) => c.role === 's' && c.i === i && c.j === j)
    } else if (role === 's') {
      light((c) => c.role === 'o' && c.i === i && c.j === j)
      light((c) => c.role === 'x' && c.i === i)
      light((c) => c.role === 'g' && c.j === j)
    } else if (role === 'x') {
      light((c) => c.role === 'o' && c.t === t && c.i === i)
      light((c) => c.role === 'g' && c.t === t)
    } else {
      light((c) => c.role === 'o' && c.t === t && c.j === j)
      light((c) => c.role === 'x' && c.t === t)
    }
    setSay(target)
    setLit(keys)
    fadeIn(say$)
  }
  const leave = () => setLit(new Set())
  const matrix = (cells, columns, kind) => (
    <Matrix cells={cells} columns={columns} kind={'small ' + kind} lit={lit()} onEnter={enter} onLeave={leave} />
  )

  return (
    <div class="matrix-figure">
      <div class="matrix-equation">
        <MathText class="matrix-name" text="$X$" />
        {matrix(inputCells, N, 'input')}
        <MathText class="matrix-name" text="$G$" />
        {matrix(gradientCells, M, 'output')}
      </div>
      <div class="matrix-equation">
        <For each={outerCells}>
          {(cells, t) => (
            <>
              <div class="matrix-block">
                <span class="matrix-block-caption">位置 {t() + 1}</span>
                {matrix(cells, M, '')}
              </div>
              <span class="matrix-op">{t() < T - 1 ? '+' : '='}</span>
            </>
          )}
        </For>
        <div class="matrix-block">
          <MathText class="matrix-block-caption" text="$X^{T}G$" />
          {matrix(sumCells, M, '')}
        </div>
      </div>
      <span ref={say$} class="matrix-say">
        <Message say={say()} />
      </span>
    </div>
  )
}
