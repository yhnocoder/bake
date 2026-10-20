import { Show, createSignal } from 'solid-js'
import { Controls, Slider, Tex, formatNumber } from 'bake/kit'
import { MathText, fadeIn } from './lib/matrix/view.jsx'
import { Matrix } from './lib/matrix/matrix.jsx'

export const params = {
  x1: { label: 'x₁ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: 1 },
  x2: { label: 'x₂ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: -0.5 },
}
export const layout = { width: 'body', height: 432, narrowHeight: 566, autoHeight: true }

const W = [
  [1, -2, 0.5],
  [0.5, 1, -1],
]
const ROWS = [1, 2]
const COLUMNS = [1, 2, 3]
const outputs = (x) => [0, 1, 2].map((j) => x[0] * W[0][j] + x[1] * W[1][j])
const fixed2 = (v) => formatNumber(v, 2)
const fixed3 = (v) => formatNumber(v, 3)
const inputName = (i) => `<span style="color:var(--series-3)">$x_{${i}}$</span>`
const outputName = (j) => `<span style="color:var(--series-5)">$z_{${j}}$</span>`
const outputFormula = (j) =>
  `${outputName(j)} $= ${W[0][j - 1]}\\,x_1 ${W[1][j - 1] < 0 ? '-' : '+'} ${Math.abs(W[1][j - 1])}\\,x_2$`

export default function LinearJacobianCells(props) {
  const [x, setX] = createSignal([props.x1, props.x2])
  const [lit, setLit] = createSignal(new Set())
  const [say, setSay] = createSignal('移动滑块改变 $\\mathbf{x}$，指针停在任意一格上显示该格的含义。')
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
      setSay({ index: index + 1, dx: fixed2(dx), changes, ratios })
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
      setSay(
        `${inputName(i)} 变化时三个输出的变化率：${outputFormula(1)}，${outputFormula(2)}，${outputFormula(3)}，其中 $x_{${i}}$ 的系数依次是 <b>${W[i - 1].join('　')}</b>，即 $J$ 的第 ${i} 列，也就是 $W$ 的第 ${i} 行。这三个数不含 $\\mathbf{x}$，所以不随滑块变。`,
      )
    } else if (cell.kind === 'w') {
      const { i, j } = cell
      light(`x${i}`, `z${j}`, `j${i}${j}`)
      setSay(
        `$W_{${i}${j}}$ 是 ${outputFormula(j)} 中 ${inputName(i)} 的系数，所以 $\\partial z_{${j}} / \\partial x_{${i}} = W_{${i}${j}}$ = <b>${W[i - 1][j - 1]}</b>，它位于 $J$ 的第 ${j} 行第 ${i} 列。`,
      )
    } else if (cell.kind === 'z') {
      const j = cell.j
      const z = outputs(x())
      ROWS.forEach((i) => light(`w${i}${j}`, `x${i}`, `j${i}${j}`))
      setSay(
        `${outputFormula(j)} = ${W[0][j - 1]} × (${fixed2(x()[0])}) ${W[1][j - 1] < 0 ? '−' : '+'} ${Math.abs(W[1][j - 1])} × (${fixed2(x()[1])}) = <b>${fixed3(z[j - 1])}</b>。` +
          `它对 $x_1$、$x_2$ 的偏导数是 $W$ 的第 ${j} 列 <b>${W[0][j - 1]}　${W[1][j - 1]}</b>，也就是 $z_{${j}}$ 的梯度，即 $J$ 的第 ${j} 行。`,
      )
    } else {
      const { i, j } = cell
      light(`w${i}${j}`, `x${i}`, `z${j}`)
      setSay(
        `$\\partial z_{${j}} / \\partial x_{${i}} = W_{${i}${j}}$ = <b>${W[i - 1][j - 1]}</b>：${inputName(i)} 变化时 ${outputName(j)} 的变化率是 ${W[i - 1][j - 1]}。`,
      )
    }
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
      <Show when={typeof say() === 'object' && say()} fallback={<MathText ref={say$} class="matrix-say" text={say()} />}>
        {(moved) => (
          <span class="matrix-say">
            <MathText text={inputName(moved().index)} /> 变化 <b>{moved().dx}</b>，三个输出分别变化 <b>{moved().changes}</b>，比值{' '}
            <b>{moved().ratios}</b>，即 <MathText text="$J$" /> 的第 {moved().index} 列，也就是 <MathText text="$W$" /> 的第 {moved().index} 行。
          </span>
        )}
      </Show>
    </div>
  )
}
