import { formatNumber } from 'bake/kit'
import { fn, swish, normalPdf, SWISH_MIN_AT_BETA_1, GELU_MIN_X } from './functions.js'

const LN9 = Math.log(9)
const band = (a, b, label, extra = {}) => ({ a, b, label, ...extra })
const point = (x, y, label, extra = {}) => ({ x, y, label, ...extra })
const ref = (a, b, y, label, extra = {}) => ({ a, b, y, label, ...extra })

const presets = {
  'far-negative': (derivative) => ({
    bands: [band(-6, -2, '负半轴远端', { shadeOnly: true, color: 'var(--accent)' })],
    references: derivative
      ? [ref(-6, -2, 0, 'ReLU 导数 $=0$；SiLU、tanh 导数 $\\to 0$', { labelX: -3.8 })]
      : [
          ref(-6, -2, 0, 'ReLU 严格为零；SiLU $\\to 0^-$', { labelX: -4 }),
          ref(-6, -2, -1, '$\\tanh\\to -1$', { labelX: -4, dy: 16, color: 'tanh' }),
        ],
    left: derivative ? '当 $x\\to-\\infty$：导数 $\\to 0$' : '当 $x\\to-\\infty$',
    right: '向原点方向',
  }),
  zero: (derivative) => ({
    verticals: [{ x: 0, label: derivative ? '' : '$x=0$' }],
    points: derivative
      ? [
          point(0, 0, 'ReLU：左极限 $0$', { open: true, color: 'relu', dy: 18 }),
          point(0, 1, 'ReLU：右极限 $1$，原点不可导', { open: true, color: 'relu' }),
          point(0, 0.5, 'SiLU：$\\frac{df}{dx}(0)=0.5$', { color: 'silu' }),
          point(0, 0.25, 'Sigmoid：$\\frac{df}{dx}(0)=0.25$', { color: 'sigmoid', dy: 14 }),
        ]
      : [
          point(0, 0, 'ReLU、SiLU：$f(0)=0$', { dy: 18 }),
          point(0, 0.5, 'Sigmoid：$f(0)=0.5$', { color: 'sigmoid' }),
        ],
    left: '向负半轴延伸',
    right: '向正半轴延伸',
  }),
  transition: (derivative) => ({
    bands: [band(-2, 2, 'GELU 主要变化范围 $\\approx[-2,2]$', { series: 'gelu' })],
    verticals: [{ x: 0, label: derivative ? 'ReLU：导数在 $x=0$ 跳变' : 'ReLU：过渡集中在 $x=0$' }],
    points: derivative
      ? [
          point(-Math.SQRT2, fn.gelu.d(-Math.SQRT2), 'GELU 导数最小 $\\approx -0.129$', { color: 'gelu', dx: -64, dy: 18 }),
          point(Math.SQRT2, fn.gelu.d(Math.SQRT2), 'GELU 导数最大 $\\approx 1.129$', { color: 'gelu', dx: -30, dy: -10 }),
        ]
      : [point(GELU_MIN_X, fn.gelu.f(GELU_MIN_X), 'GELU 最低点 $\\approx(-0.75,\\ -0.17)$', { color: 'gelu', dx: -118, dy: 22 })],
    left: '当 $x\\to-\\infty$',
    right: '当 $x\\to+\\infty$',
  }),
  'far-positive': (derivative) => ({
    bands: [band(2, 6, '正半轴远端', { shadeOnly: true, color: 'var(--accent)' })],
    references: derivative
      ? [
          ref(2, 6, 1, 'SiLU 导数 $\\to 1$', { color: 'silu', labelX: 4 }),
          ref(2, 6, 0, 'tanh 导数 $\\to 0$', { color: 'tanh', labelX: 4, dy: 16 }),
        ]
      : [
          ref(2, 6, 1, '$\\tanh\\to 1$：有上界', { color: 'tanh', labelX: 4 }),
          ref(0, 6, 0, 'SiLU $\\approx x$：线性增长', { endY: 6, labelX: 4.4, labelY: 3, dy: 24, color: 'silu' }),
        ],
    points: derivative
      ? [point(1, 2, '$\\mathrm{ReLU}^2$：导数 $=2x$，无上界', { color: 'relu2', dx: 8, dy: -8 })]
      : [point(2, 4, '$\\mathrm{ReLU}^2$：$x=2$ 时输出 $4$', { color: 'relu2', dx: -126, dy: -8 })],
    left: '向原点方向',
    right: '当 $x\\to+\\infty$',
  }),
  'sigmoid-tanh': (derivative) => ({
    bands: [
      band(-LN9, LN9, 'Sigmoid 10–90% · 宽 4.39', { series: 'sigmoid' }),
      band(-LN9 / 2, LN9 / 2, 'Tanh 10–90% · 宽 2.20', { series: 'tanh' }),
    ],
    references: derivative
      ? [
          ref(-6, 0, 0, '饱和区 · 导数 $\\to 0$', { labelX: -4.4 }),
          ref(0, 6, 0, '饱和区 · 导数 $\\to 0$', { labelX: 4.4 }),
        ]
      : [
          ref(-6, 0, 0, '$\\sigma\\to 0$', { labelX: -4.4, color: 'sigmoid' }),
          ref(-6, 0, -1, '$\\tanh\\to -1$', { labelX: -4.4, color: 'tanh' }),
          ref(0, 6, 1, '饱和区 · $\\to 1$', { labelX: 4.4, dy: 16 }),
        ],
    points: derivative
      ? [
          point(0, 0.25, '$\\frac{d\\sigma}{dx}(0)=0.25$', { color: 'sigmoid' }),
          point(0, 1, '$\\frac{d\\tanh}{dx}(0)=1$', { dy: 16, color: 'tanh' }),
        ]
      : [
          point(0, 0.5, '$\\sigma(0)=0.5$', { color: 'sigmoid' }),
          point(0, 0, '$\\tanh(0)=0$', { dy: 18, color: 'tanh' }),
        ],
    left: derivative ? '当 $x\\to-\\infty$：导数 $\\to 0^+$' : '当 $x\\to-\\infty$：$\\sigma\\to 0$ / $\\tanh\\to -1$',
    right: derivative ? '当 $x\\to+\\infty$：导数 $\\to 0^+$' : '当 $x\\to+\\infty$：两者 $\\to 1$',
  }),
  'gelu-approx': (derivative) => ({
    bands: [band(-2, 2, '主要过渡区 $\\approx[-2,2]$')],
    points: derivative
      ? [
          point(-Math.SQRT2, fn.gelu.d(-Math.SQRT2), '导数最小 $\\approx -0.129$', { dx: -65, dy: 18 }),
          point(0, 0.5, '$x=0$，斜率 $0.5$'),
          point(Math.SQRT2, fn.gelu.d(Math.SQRT2), '导数最大 $\\approx 1.129$', { dx: -20, dy: -10 }),
        ]
      : [
          point(GELU_MIN_X, fn.gelu.f(GELU_MIN_X), '最低点 $\\approx(-0.75,\\ -0.17)$', { dx: -104, dy: 23 }),
          point(0, 0, '原点 $(0,0)$', { dy: -14 }),
        ],
    left: derivative ? '当 $x\\to-\\infty$：导数 $\\to 0^-$' : '当 $x\\to-\\infty$：输出 $\\to 0^-$',
    right: derivative ? '当 $x\\to+\\infty$：导数 $\\to 1$' : '当 $x\\to+\\infty$：输出 $\\approx x$',
  }),
  'gate-clamp': (derivative) => ({
    bands: [band(-LN9, LN9, '零附近的 gate 过渡', { series: 'silu' })],
    verticals: [{ x: 7, label: derivative ? '$g=7$：不可导' : '$g=7$：clamp' }],
    references: derivative
      ? [
          ref(-4, 0, 0, '导数 $\\to 0$'),
          ref(0, 12, 1, 'SiLU $\\to 1$', { labelX: 10, dy: -12 }),
          ref(0, 12, 0, 'SiTU $\\to 0$', { color: 'situ-gate', labelX: 4, dy: 18 }),
        ]
      : [
          ref(-4, 0, 0, '输出 $\\to 0$'),
          ref(0, 12, 4, 'SiTU $\\to 4$', { color: 'situ-gate', labelX: 10 }),
          ref(7, 12, fn.gptOssGate.f(7), 'clamp 后恒定 $\\approx 7$', { color: 'gpt-oss-gate', labelX: 9.5 }),
          ref(0, 12, 0, 'SiLU $\\approx g$', { endY: 12, labelX: 9, labelY: 9 }),
        ],
    points: derivative
      ? [
          point(7, 0, 'clamp 后斜率 $=0$', { open: true, dy: 18, color: 'gpt-oss-gate' }),
          point(7, fn.quickGelu.d(7), '', { open: true, color: 'gpt-oss-gate' }),
          point(0, 0.5, '原点斜率 $=0.5$'),
        ]
      : [point(0, 0, '原点 $(0,0)$')],
    left: '当 $g\\to-\\infty$',
    right: '当 $g\\to+\\infty$',
  }),
}

function curveGuides(kind, derivative, { beta, range, mainColor, referenceColor }) {
  const [lo, hi] = range
  const result = { bands: [], points: [], references: [], verticals: [], left: '当输入趋向负无穷', right: '当输入趋向正无穷' }
  const zero = () => result.references.push(ref(lo, 0, 0, derivative ? '导数 $\\to 0$' : '输出 $\\to 0$', { labelX: lo * 0.72 }))
  const linear = () =>
    result.references.push(
      derivative
        ? ref(0, hi, 1, '导数 $\\to 1$', { labelX: hi * 0.72, dy: 18 })
        : ref(0, hi, 0, '$y=x$', { endY: hi, labelX: hi * 0.72, labelY: hi * 0.72, dy: 18 }),
    )
  if (kind === 'relu' || kind === 'relu2') {
    result.bands = [band(lo, 0, '负半轴：输出与导数严格为零', { shadeOnly: true })]
    result.verticals = [{ x: 0, label: kind === 'relu' ? '$x=0$：折点' : '$x=0$：导数连续' }]
    result.references = [ref(lo, 0, 0, '严格为零', { labelX: lo * 0.65 })]
    if (kind === 'relu') {
      if (derivative) {
        result.references.push(ref(0, hi, 1, '斜率 $=1$', { dy: 18 }))
        result.points = [point(0, 0, '', { open: true }), point(0, 1, '原点不可导', { open: true, dy: 18 })]
      } else result.points = [point(0, 0, '原点 $(0,0)$')]
    } else {
      result.points = [
        point(0, 0, derivative ? '原点斜率 $=0$' : '原点 $(0,0)$'),
        point(2, 4, derivative ? '$x=2$：斜率 $4$' : '$x=2$：输出 $4$', { dx: -100 }),
        point(2, derivative ? 1 : 2, derivative ? 'ReLU：斜率 $1$' : 'ReLU：输出 $2$', { dx: -100, color: referenceColor }),
      ]
    }
  } else if (kind === 'sigmoid' || kind === 'tanh' || kind === 'normal') {
    const w = kind === 'normal' ? 1.281552 : LN9 / (kind === 'tanh' ? 2 : 1)
    result.bands = [band(-w, w, '输出变化的 10%–90%：宽 ' + (2 * w).toFixed(2))]
    const f0 = kind === 'tanh' ? 0 : 0.5
    const d0 = kind === 'normal' ? normalPdf(0) : kind === 'tanh' ? 1 : 0.25
    result.points = [point(0, derivative ? d0 : f0, derivative ? '原点斜率 $' + d0.toFixed(3) + '$' : '$x=0$，输出 $' + f0 + '$', { dy: 18 })]
    result.references = [
      ref(lo, 0, derivative ? 0 : kind === 'tanh' ? -1 : 0, derivative ? '导数 $\\to 0$' : '饱和参考', { labelX: lo * 0.7, dy: 16 }),
      ref(0, hi, derivative ? 0 : 1, derivative ? '导数 $\\to 0$' : '输出 $\\to 1$', { labelX: hi * 0.7, dy: 16 }),
    ]
  } else if (kind === 'silu' || kind === 'swish' || kind === 'gelu' || kind === 'softplus') {
    const b = kind === 'swish' ? beta : 1
    const w = kind === 'gelu' ? 2 : LN9 / b
    const bandLabel =
      kind === 'gelu' ? '主要变化范围 $\\approx[-2,2]$' : (kind === 'softplus' ? '斜率' : 'gate') + ' 10%–90%，宽 ' + formatNumber(2 * w, 2)
    result.bands = [band(-w, w, bandLabel)]
    zero()
    linear()
    const originValue = derivative ? 0.5 : kind === 'softplus' ? Math.log(2) : 0
    const originLabel = derivative ? '原点斜率 $=0.5$' : kind === 'softplus' ? '$f(0)=\\ln 2\\approx 0.693$' : '原点 $(0,0)$'
    result.points = [point(0, originValue, originLabel)]
    if (!derivative && kind !== 'softplus') {
      const x = kind === 'gelu' ? GELU_MIN_X : SWISH_MIN_AT_BETA_1 / b
      const y = kind === 'gelu' ? fn.gelu.f(x) : swish(b).f(x)
      result.points.push(point(x, y, '最低点 (' + formatNumber(x, 2) + ', ' + formatNumber(y, 2) + ')', { dx: -70, dy: 22 }))
    }
  }
  result.points = result.points.map((p) => ({ color: mainColor, ...p }))
  result.bands = result.bands.map((b) => ({ color: mainColor, ...b }))
  return result
}

export const presetNames = ['auto', 'none', ...Object.keys(presets)]

export function guidesFor(preset, derivative, { series, beta, range }) {
  const colorOf = (key) => series.find((s) => s.key === key)?.color
  const resolve = (color) => (color === undefined ? undefined : colorOf(color) ?? color)
  const indexOf = (key) => Math.max(0, series.findIndex((s) => s.key === key))
  let raw = null
  if (preset === 'auto') {
    const main = series.filter((s) => s.role === 'main')
    const kind = main.length === 1 ? main[0].guide : null
    if (kind) {
      const referenceColor = series.find((s) => s.role === 'reference')?.color
      raw = curveGuides(kind, derivative, { beta, range, mainColor: main[0].color, referenceColor })
    }
  } else if (preset !== 'none') raw = presets[preset](derivative)
  if (!raw) return null
  return {
    left: raw.left,
    right: raw.right,
    verticals: raw.verticals ?? [],
    bands: (raw.bands ?? []).map((b) => ({ ...b, color: resolve(b.color) ?? series[indexOf(b.series)]?.color, index: indexOf(b.series) })),
    references: (raw.references ?? []).map((r) => ({ ...r, color: resolve(r.color) })),
    points: (raw.points ?? []).map((p) => ({ ...p, color: resolve(p.color) })),
  }
}

const CURVE_KINDS = ['relu', 'relu2', 'sigmoid', 'tanh', 'normal', 'silu', 'swish', 'gelu', 'softplus']
const PRESET_RANGE = [-4, 4]

const labelsOf = (guides) => [
  guides.left,
  guides.right,
  ...[...(guides.bands ?? []), ...(guides.references ?? []), ...(guides.verticals ?? []), ...(guides.points ?? [])].map((item) => item.label ?? ''),
]

export function guideLabelSources() {
  return [false, true].flatMap((derivative) => [
    ...Object.values(presets).flatMap((preset) => labelsOf(preset(derivative))),
    ...CURVE_KINDS.flatMap((kind) => labelsOf(curveGuides(kind, derivative, { beta: 1, range: PRESET_RANGE }))),
  ])
}
