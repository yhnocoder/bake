import { Match, Switch, createSignal } from 'solid-js'
import { Controls, MathText, Slider, Tex, formatNumber } from 'bake/kit'
import { fadeIn } from './lib/matrix/view.jsx'
import { Matrix } from './lib/matrix/matrix.jsx'

export const params = {
  x1: { label: 'x₁ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: 1 },
  x2: { label: 'x₂ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: -0.5 },
}
export const layout = { width: 'body' }

const W = [
  [1, -2, 0.5],
  [0.5, 1, -1],
]
const ROWS = [1, 2]
const COLUMNS = [1, 2, 3]
const outputs = (x) => [0, 1, 2].map((j) => x[0] * W[0][j] + x[1] * W[1][j])
const fixed2 = (v) => formatNumber(v, 2)
const fixed3 = (v) => formatNumber(v, 3)
const InputName = (props) => <MathText style="color:var(--series-3)" text={`$x_{${props.i}}$`} />
const OutputName = (props) => <MathText style="color:var(--series-5)" text={`$z_{${props.j}}$`} />
const OutputFormula = (props) => (
  <>
    <OutputName j={props.j} /> <MathText text={`$= ${W[0][props.j - 1]}\\,x_1 ${W[1][props.j - 1] < 0 ? '-' : '+'} ${Math.abs(W[1][props.j - 1])}\\,x_2$`} />
  </>
)

function Message(props) {
  const say = () => props.say
  const i = () => say().i
  const j = () => say().j
  return (
    <Switch fallback={<MathText text="移动滑块改变 $\mathbf{x}$，指针停在任意一格上显示该格的含义。" />}>
      <Match when={say().kind === 'move'}>
        <InputName i={say().index} /> 变化 <b>{say().dx}</b>，三个输出分别变化 <b>{say().changes}</b>，比值 <b>{say().ratios}</b>，即 <MathText text="$J$" /> 的第 {say().index} 列，也就是{' '}
        <MathText text="$W$" /> 的第 {say().index} 行。
      </Match>
      <Match when={say().kind === 'x'}>
        <InputName i={i()} /> 变化时三个输出的变化率：<OutputFormula j={1} />，<OutputFormula j={2} />，<OutputFormula j={3} />，其中 <MathText text={`$x_{${i()}}$`} /> 的系数依次是{' '}
        <b>{W[i() - 1].join('　')}</b>，即 <MathText text="$J$" /> 的第 {i()} 列，也就是 <MathText text="$W$" /> 的第 {i()} 行。这三个数不含 <MathText text="$\mathbf{x}$" />，所以不随滑块变。
      </Match>
      <Match when={say().kind === 'w'}>
        <MathText text={`$W_{${i()}${j()}}$`} /> 是 <OutputFormula j={j()} /> 中 <InputName i={i()} /> 的系数，所以{' '}
        <MathText text={`$\\partial z_{${j()}} / \\partial x_{${i()}} = W_{${i()}${j()}}$`} /> = <b>{W[i() - 1][j() - 1]}</b>，它位于 <MathText text="$J$" /> 的第 {j()} 行第 {i()} 列。
      </Match>
      <Match when={say().kind === 'z'}>
        <OutputFormula j={j()} /> = {W[0][j() - 1]} × ({fixed2(props.x[0])}) {W[1][j() - 1] < 0 ? '−' : '+'} {Math.abs(W[1][j() - 1])} × ({fixed2(props.x[1])}) ={' '}
        <b>{fixed3(outputs(props.x)[j() - 1])}</b>。它对 <MathText text="$x_1$" />、<MathText text="$x_2$" /> 的偏导数是 <MathText text="$W$" /> 的第 {j()} 列{' '}
        <b>
          {W[0][j() - 1]}　{W[1][j() - 1]}
        </b>
        ，也就是 <MathText text={`$z_{${j()}}$`} /> 的梯度，即 <MathText text="$J$" /> 的第 {j()} 行。
      </Match>
      <Match when={say().kind === 'j'}>
        <MathText text={`$\\partial z_{${j()}} / \\partial x_{${i()}} = W_{${i()}${j()}}$`} /> = <b>{W[i() - 1][j() - 1]}</b>：<InputName i={i()} /> 变化时 <OutputName j={j()} /> 的变化率是{' '}
        {W[i() - 1][j() - 1]}。
      </Match>
    </Switch>
  )
}

export default function LinearJacobianCells(props) {
  const [x, setX] = createSignal([props.x1, props.x2])
  const [lit, setLit] = createSignal(new Set())
  const [say, setSay] = createSignal({ kind: null })
  let say$
  let previous = x()
  let previousZ = outputs(x())

  const move = (index, value) => {
    const next = x().map((v, i) => (i === index ? value : v))
    setX(next)
    const z = outputs(next)
    const dx = next[index] - previous[index]
    if (Math.abs(dx) > 1e-9) {
      const changes = z.map((v, j) => fixed3(v - previousZ[j])).join('　')
      const ratios = z.map((v, j) => fixed2((v - previousZ[j]) / dx)).join('　')
      setSay({ kind: 'move', index: index + 1, dx: fixed2(dx), changes, ratios })
    }
    previous = next
    previousZ = z
  }

  const enter = (cell) => {
    const keys = new Set([cell.key])
    const light = (...more) => more.forEach((key) => keys.add(key))
    if (cell.kind === 'x') {
      const i = cell.i
      COLUMNS.forEach((j) => light(`w${i}${j}`, `z${j}`))
      light(`j${i}1`, `j${i}2`, `j${i}3`)
    } else if (cell.kind === 'w') {
      const { i, j } = cell
      light(`x${i}`, `z${j}`, `j${i}${j}`)
    } else if (cell.kind === 'z') {
      const j = cell.j
      ROWS.forEach((i) => light(`w${i}${j}`, `x${i}`, `j${i}${j}`))
    } else {
      const { i, j } = cell
      light(`w${i}${j}`, `x${i}`, `z${j}`)
    }
    setSay(cell)
    setLit(keys)
    fadeIn(say$)
  }
  const leave = () => setLit(new Set())

  const inputCells = ROWS.map((i) => ({ key: `x${i}`, kind: 'x', i, label: `$x_${i}$`, value: () => fixed2(x()[i - 1]) }))
  const weightCells = ROWS.flatMap((i) =>
    COLUMNS.map((j) => ({ key: `w${i}${j}`, kind: 'w', i, j, label: `$W_{${i}${j}}$`, value: String(W[i - 1][j - 1]) })),
  )
  const outputCells = COLUMNS.map((j) => ({ key: `z${j}`, kind: 'z', j, label: `$z_${j}$`, value: () => fixed3(outputs(x())[j - 1]) }))
  const jacobianCells = COLUMNS.flatMap((j) => ROWS.map((i) => ({ key: `j${i}${j}`, kind: 'j', i, j, value: String(W[i - 1][j - 1]) })))
  const matrix = (cells, columns, kind) => (
    <Matrix cells={cells} columns={columns} kind={kind} lit={lit()} onEnter={enter} onLeave={leave} />
  )

  return (
    <div class="matrix-figure">
      <Controls>
        {ROWS.map((i) => (
          <span class="matrix-input-slider">
            <Slider label={<Tex tex={`x_${i}`} />} min={-2} max={2} step={0.01} value={x()[i - 1]} onInput={(value) => move(i - 1, value)} />
          </span>
        ))}
      </Controls>
      <div class="matrix-equation">
        <MathText class="matrix-name" text="$\mathbf{x}$" />
        {matrix(inputCells, 2, 'input')}
        <span class="matrix-op">·</span>
        <MathText class="matrix-name" text="$W$" />
        {matrix(weightCells, 3, '')}
        <span class="matrix-op">=</span>
        <MathText class="matrix-name" text="$\mathbf{z}$" />
        {matrix(outputCells, 3, 'output')}
      </div>
      <div class="matrix-matrix-row">
        <MathText class="matrix-name" text="$J = \dfrac{\partial \mathbf{z}}{\partial \mathbf{x}}$ =" />
        {matrix(jacobianCells, 2, 'compact')}
      </div>
      <span ref={say$} class="matrix-say">
        <Message say={say()} x={x()} />
      </span>
    </div>
  )
}
