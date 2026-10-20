export const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)))

function erf(value) {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-x * x))
}

export const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2))
export const normalPdf = (x) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)

const softplus = (x) => (x > 20 ? x : Math.log1p(Math.exp(x)))
const TANH_GELU_SCALE = Math.sqrt(2 / Math.PI)
const QUICK_GELU_SCALE = 1.702
const GPT_OSS_LIMIT = 7
const SITU_GATE_BETA = 4

export const swish = (beta) => ({
  f: (x) => x * sigmoid(beta * x),
  d: (x) => {
    const s = sigmoid(beta * x)
    return s * (1 + beta * x * (1 - s))
  },
})

const silu = swish(1)
const quickGelu = swish(QUICK_GELU_SCALE)

export const fn = {
  relu: { f: (x) => Math.max(0, x), d: (x) => (x === 0 ? NaN : x > 0 ? 1 : 0), breaks: [0] },
  relu2: { f: (x) => Math.max(0, x) ** 2, d: (x) => (x > 0 ? 2 * x : 0) },
  sigmoid: { f: sigmoid, d: (x) => sigmoid(x) * (1 - sigmoid(x)) },
  tanh: { f: Math.tanh, d: (x) => 1 - Math.tanh(x) ** 2 },
  normalCdf: { f: normalCdf, d: normalPdf },
  gelu: { f: (x) => x * normalCdf(x), d: (x) => normalCdf(x) + x * normalPdf(x) },
  geluTanh: {
    f: (x) => 0.5 * x * (1 + Math.tanh(TANH_GELU_SCALE * (x + 0.044715 * x ** 3))),
    d: (x) => {
      const t = Math.tanh(TANH_GELU_SCALE * (x + 0.044715 * x ** 3))
      return 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * TANH_GELU_SCALE * (1 + 3 * 0.044715 * x * x)
    },
  },
  quickGelu,
  silu,
  softplus: { f: softplus, d: sigmoid },
  situGate: {
    f: (x) => SITU_GATE_BETA * Math.tanh(x / SITU_GATE_BETA) * sigmoid(x),
    d: (x) => {
      const t = Math.tanh(x / SITU_GATE_BETA)
      const s = sigmoid(x)
      return (1 - t * t) * s + SITU_GATE_BETA * t * s * (1 - s)
    },
  },
  gptOssGate: {
    f: (x) => quickGelu.f(Math.min(x, GPT_OSS_LIMIT)),
    d: (x) => (x === GPT_OSS_LIMIT ? NaN : x > GPT_OSS_LIMIT ? 0 : quickGelu.d(x)),
    breaks: [GPT_OSS_LIMIT],
  },
}

const entry = (name, math, guide) => ({ name, math, guide })

export const catalog = {
  relu: entry('ReLU', fn.relu, 'relu'),
  relu2: entry('$\\mathrm{ReLU}^2$', fn.relu2, 'relu2'),
  sigmoid: entry('Sigmoid', fn.sigmoid, 'sigmoid'),
  logistic: entry('Logistic $\\sigma(x)$', fn.sigmoid, 'sigmoid'),
  tanh: entry('tanh', fn.tanh, 'tanh'),
  'normal-cdf': entry('$\\Phi(x)$', fn.normalCdf, 'normal'),
  gelu: entry('GELU', fn.gelu, 'gelu'),
  'gelu-erf': entry('GELU (erf)', fn.gelu, 'gelu'),
  'gelu-tanh': entry('GELU (tanh 近似)', fn.geluTanh, null),
  'gelu-quick': entry('GELU (quick 近似)', fn.quickGelu, null),
  silu: entry('SiLU', fn.silu, 'silu'),
  swish: entry('$\\mathrm{Swish}_\\beta$', null, 'swish'),
  softplus: entry('Softplus', fn.softplus, 'softplus'),
  'gpt-oss-gate': entry('gpt-oss gate', fn.gptOssGate, null),
  'situ-gate': entry('SiTU gate（$\\beta_1=4$）', fn.situGate, null),
}

export const SWISH_MIN_AT_BETA_1 = -1.278465
export const GELU_MIN_X = -0.7518
