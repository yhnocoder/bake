---
title: 三个激活函数
slug: activations
date: 2026-10-16
summary: ReLU、GELU 和 SiLU 的公式、导数和实现。这一篇用 bento 主题排版，每一节是一张卡片。
tags: [激活, bento]
category: writing
preview: preview.js
theme: bento
---

神经网络的每一层在线性变换之后接一个逐元素的非线性函数，也就是激活函数。下面比较三个常用的激活函数：ReLU、GELU 和 SiLU。

## ReLU {cols=2 rows=24}

ReLU 把负数变成 0，正数保持不变 [@relu]：

$$
\mathrm{ReLU}(x) = \max(0, x)
$$

它计算简单，正半轴的导数恒为 1，梯度不会随层数衰减。缺点是负半轴的导数为 0，一个神经元的输入一直为负时，它的参数不再更新。

:::act-fn-plot{fns=relu zoom}
ReLU 和它的导数。拖动滑块改变横轴的范围和中心。
:::

:::sticker
📈
:::

## GELU {cols=2 rows=14}

:::recap
按输入在标准正态分布里的位置给它加权。
:::

GELU 用标准正态分布的累积分布函数 $\Phi$ 给输入加权 [@gelu]：

$$
\mathrm{GELU}(x) = x\,\Phi(x)
$$

它在 0 附近是平滑的，负半轴有小的负值[^gelu-min]。BERT 和 GPT-2 都用 GELU。

[^gelu-min]: 最小值约为 $-0.17$，在 $x \approx -0.75$ 处取到。

:::note{color=blue}
PyTorch 的 `F.gelu(x, approximate="tanh")` 就是[实现](#实现)一节里的 `gelu_tanh`。
:::

## SiLU {cols=2 rows=10}

SiLU 把 $\Phi$ 换成 sigmoid 函数 $\sigma$ [@silu]：

$$
\mathrm{SiLU}(x) = x\,\sigma(x)
$$

它和 GELU 的形状很接近，计算更便宜。SwiGLU 用 SiLU 作为门控的激活函数。

:::sticker
$x\,\sigma(x)$
:::

## 导数 {cols=2 rows=18}

ReLU 的导数在正半轴是 1，负半轴是 0。另外两个函数的导数都是平滑的。

### GELU 的导数

:::recap
两项之和：$\Phi(x)$ 加上 $x\,\varphi(x)$。
:::

$$
\frac{d}{dx}\,x\,\Phi(x) = \Phi(x) + x\,\varphi(x)
$$

其中 $\varphi$ 是标准正态分布的密度函数[^phi]。

[^phi]: $\varphi(x) = e^{-x^2/2} / \sqrt{2\pi}$，所以 GELU 在 0 处的导数是 $\Phi(0) = 0.5$。

### SiLU 的导数

:::fold{title="推导"}
对 $x\,\sigma(x)$ 用乘积法则，再用 $\sigma'(x) = \sigma(x)(1 - \sigma(x))$：

$$
\frac{d}{dx}\,x\,\sigma(x) = \sigma(x)\bigl(1 + x\,(1 - \sigma(x))\bigr)
$$
:::

## 怎么选 {cols=2}

新模型多用 GELU 或 SiLU，它们在 0 附近的梯度更平滑。

:::aside{title="实践建议"}
沿用模型原来的激活函数。换成另一个函数后，学习率和初始化通常也要重新调。
:::

:::sticker
🧪
:::

:::note{color=green}
$x \to +\infty$ 时，三个函数的导数都趋于 1；$x \to -\infty$ 时都趋于 0。
:::

## 反向传播 {cols=6 rows=17}

逐元素激活函数的雅可比矩阵是对角矩阵，所以换激活函数只改变每个元素乘上的导数。下面一节出自[雅可比矩阵](/2026-10/jacobian/)：

:::embed
/2026-10/jacobian/#在反向传播中的作用
:::

## 实现 {cols=4 rows=17}

PyTorch 里三个函数都只有几行。GELU 的精确形式要算误差函数，常用的近似把它换成 $\tanh$：

```python
import math
import torch

def gelu(x):
    cdf = 0.5 * (1 + torch.erf(x / math.sqrt(2)))
    return x * cdf

def gelu_tanh(x):
    u = x + 0.044715 * x**3
    u = u * math.sqrt(2 / math.pi)
    return 0.5 * x * (1 + torch.tanh(u))

def silu(x):
    return x * torch.sigmoid(x)
```

## 写成 Markdown {cols=2}

这篇文章的行内公式写在一对美元符号之间：

:::example
GELU 的定义是 $\mathrm{GELU}(x) = x\,\Phi(x)$，其中 $\Phi$ 是标准正态分布的累积分布函数。
:::

## 对比 {cols=4 rows=11}

| 函数 | 公式 | 在 0 处的导数 | 负半轴 | 常见用法 |
|---|---|---|---|---|
| ReLU | $\max(0, x)$ | 不可导 | 恒为 0 | 原始 Transformer、早期的卷积网络 |
| GELU | $x\,\Phi(x)$ | $0.5$ | 最小约 $-0.17$ | BERT、GPT-2 |
| SiLU | $x\,\sigma(x)$ | $0.5$ | 最小约 $-0.28$ | SwiGLU 的门控、LLaMA |

## 参考文献 {cols=2}

:::references
- [@relu] Nair, Hinton. *Rectified Linear Units Improve Restricted Boltzmann Machines*. 2010.
- [@gelu] Hendrycks, Gimpel. *Gaussian Error Linear Units*. 2016.
- [@silu] Elfwing, Uchibe, Doya. *Sigmoid-Weighted Linear Units for Neural Network Function Approximation in Reinforcement Learning*. 2018.
:::
