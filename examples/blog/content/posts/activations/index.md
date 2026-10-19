---
title: 三个激活函数
slug: activations
date: 2026-10-16
summary: ReLU、GELU 和 SiLU 的公式、导数和实现。这一篇用 bento 主题排版，每一节是一张卡片。
tags: [激活, bento]
category: writing
theme: bento
---

神经网络的每一层在线性变换之后接一个逐元素的非线性函数，也就是激活函数。下面比较三个常用的激活函数：ReLU、GELU 和 SiLU。

## ReLU {width=wide}

ReLU 把负数变成 0，正数保持不变：

$$
\mathrm{ReLU}(x) = \max(0, x)
$$

它计算简单，正半轴的导数恒为 1，梯度不会随层数衰减。缺点是负半轴的导数为 0，一个神经元的输入一直为负时，它的参数不再更新。

:::act-fn-plot{fn=relu}
ReLU 和它的导数。拖动右上角的滑块改变横轴范围。
:::

## GELU

GELU 用标准正态分布的累积分布函数 $\Phi$ 给输入加权：

$$
\mathrm{GELU}(x) = x\,\Phi(x)
$$

它在 0 附近是平滑的，负半轴有小的负值[^gelu-min]。BERT 和 GPT-2 都用 GELU。

[^gelu-min]: 最小值约为 $-0.17$，在 $x \approx -0.75$ 处取到。

## SiLU

SiLU 把 $\Phi$ 换成 sigmoid 函数 $\sigma$：

$$
\mathrm{SiLU}(x) = x\,\sigma(x)
$$

它和 GELU 的形状很接近，计算更便宜。SwiGLU 用 SiLU 作为门控的激活函数。

## 对比 {width=page}

| 函数 | 公式 | 在 0 处的导数 | 负半轴 | 常见用法 |
|---|---|---|---|---|
| ReLU | $\max(0, x)$ | 不可导 | 恒为 0 | 原始 Transformer、早期的卷积网络 |
| GELU | $x\,\Phi(x)$ | $0.5$ | 最小约 $-0.17$ | BERT、GPT-2 |
| SiLU | $x\,\sigma(x)$ | $0.5$ | 最小约 $-0.28$ | SwiGLU 的门控、LLaMA |

## 实现

PyTorch 里三个函数都只有一两行。GELU 的精确形式要算误差函数，常用的近似把它换成 $\tanh$：

```python
import math
import torch

def gelu(x: torch.Tensor) -> torch.Tensor:
    return 0.5 * x * (1 + torch.erf(x / math.sqrt(2)))

def gelu_tanh(x: torch.Tensor) -> torch.Tensor:
    inner = math.sqrt(2 / math.pi) * (x + 0.044715 * x**3)
    return 0.5 * x * (1 + torch.tanh(inner))

def silu(x: torch.Tensor) -> torch.Tensor:
    return x * torch.sigmoid(x)
```

## 导数

GELU 的导数由两项组成：

$$
\frac{d}{dx}\,x\,\Phi(x) = \Phi(x) + x\,\varphi(x)
$$

其中 $\varphi$ 是标准正态分布的密度函数[^phi]。

:::fold{title="SiLU 的导数"}
$$
\frac{d}{dx}\,x\,\sigma(x) = \sigma(x)\bigl(1 + x\,(1 - \sigma(x))\bigr)
$$
:::

[^phi]: $\varphi(x) = e^{-x^2/2} / \sqrt{2\pi}$，所以 GELU 在 0 处的导数是 $\Phi(0) = 0.5$。

## 怎么选

新模型多用 GELU 或 SiLU，它们在 0 附近的梯度更平滑。反向传播时，逐元素激活函数的雅可比矩阵是对角矩阵，见[雅可比矩阵在反向传播中的作用](/2026-10/jacobian/#在反向传播中的作用)，所以换激活函数只改变每个元素乘上的导数。
