export const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

function erf(value) {
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return Math.sign(value) * (1 - poly * Math.exp(-x * x));
}

const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const normalPdf = (x) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

const TANH_GELU_SCALE = Math.sqrt(2 / Math.PI);
const TANH_GELU_CUBIC = 0.044715;
const SIGMOID_GELU_SCALE = 1.702;

export const relu = {
  f: (x) => Math.max(0, x),
  d: (x) => (x > 0 ? 1 : x < 0 ? 0 : NaN),
  breaks: [0],
};

export const gelu = {
  f: (x) => x * normalCdf(x),
  d: (x) => normalCdf(x) + x * normalPdf(x),
  breaks: [],
};

export const geluTanh = {
  f: (x) => 0.5 * x * (1 + Math.tanh(TANH_GELU_SCALE * (x + TANH_GELU_CUBIC * x ** 3))),
  d: (x) => {
    const t = Math.tanh(TANH_GELU_SCALE * (x + TANH_GELU_CUBIC * x ** 3));
    return 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * TANH_GELU_SCALE * (1 + 3 * TANH_GELU_CUBIC * x * x);
  },
  breaks: [],
};

export const swish = (beta) => ({
  f: (x) => x * sigmoid(beta * x),
  d: (x) => {
    const s = sigmoid(beta * x);
    return s * (1 + beta * x * (1 - s));
  },
  breaks: [],
});

export const geluSigmoid = swish(SIGMOID_GELU_SCALE);

export const silu = swish(1);
