import { createSignal } from 'solid-js'
import { MathText } from './lib/mc/view.jsx'
import { Matrix } from './lib/mc/matrix.jsx'

export const params = {
  x1: { label: 'x₁ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: 1 },
  x2: { label: 'x₂ 的初始值', type: 'number', min: -2, max: 2, step: 0.01, default: -0.5 },
}
export const layout = { width: 'body', height: 335 }

const W = [
  [1, -2, 0.5],
  [0.5, 1, -1],
]
const ROWS = [1, 2]
const COLUMNS = [1, 2, 3]
const outputs = (x) => [0, 1, 2].map((j) => x[0] * W[0][j] + x[1] * W[1][j])
const fixed2 = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2)
const fixed3 = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(3)
const inputName = (i) => `<span style="color:var(--series-3)">$x_{${i}}$</span>`
const outputName = (j) => `<span style="color:var(--series-5)">$z_{${j}}$</span>`
const outputFormula = (j) =>
  `${outputName(j)} $= ${W[0][j - 1]}\\,x_1 ${W[1][j - 1] < 0 ? '-' : '+'} ${Math.abs(W[1][j - 1])}\\,x_2$`

export default function LinearJacobianCells(props) {
  const [x, setX] = createSignal([props.x1, props.x2])
  const [lit, setLit] = createSignal(new Set())
  const [say, setSay] = createSignal('移动滑块改变 $\\mathbf{x}$，指针停在任意一格上显示该格的含义。')
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
      setSay(
        `${inputName(index + 1)} 变化 <b>${fixed2(dx)}</b>，三个输出分别变化 <b>${changes}</b>，比值 <b>${ratios}</b>，即 $J$ 的第 ${index + 1} 列，也就是 $W$ 的第 ${index + 1} 行。`,
      )
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
        `${outputFormula(j)} $= ${W[0][j - 1]} \\times (${x()[0].toFixed(2)}) ${W[1][j - 1] < 0 ? '-' : '+'} ${Math.abs(W[1][j - 1])} \\times (${x()[1].toFixed(2)})$ = <b>${fixed3(z[j - 1])}</b>。` +
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
    <div class="mc-figure">
      <div class="mc-controls">
        {ROWS.map((i) => (
          <label style={{ '--accent': 'var(--series-3)' }}>
            <MathText text={`$x_${i}$`} />
            <input
              type="range"
              min="-2"
              max="2"
              step="0.01"
              value={x()[i - 1]}
              onInput={(event) => move(i - 1, Number(event.currentTarget.value))}
            />
            <span class="mc-value">{x()[i - 1].toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div class="mc-equation">
        <MathText class="mc-name" text="$\mathbf{x}$" />
        {matrix(inputCells, 2, 'input')}
        <span class="mc-op">·</span>
        <MathText class="mc-name" text="$W$" />
        {matrix(weightCells, 3, '')}
        <span class="mc-op">=</span>
        <MathText class="mc-name" text="$\mathbf{z}$" />
        {matrix(outputCells, 3, 'output')}
      </div>
      <div class="mc-matrix-row">
        <MathText class="mc-name" text="$J = \dfrac{\partial \mathbf{z}}{\partial \mathbf{x}}$ =" />
        {matrix(jacobianCells, 2, 'compact')}
      </div>
      <MathText class="mc-say" text={say()} />
    </div>
  )
}
