---
title: 激活函数一览
slug: bento
layout: bento
---

:::lede
这一页用卡片网格比较常见的激活函数，每张卡片给出定义和一句说明。
:::

::::bento
:::card{span=2x1 title=ReLU}
$\max(0, x)$，计算量最小，是深度网络里最常用的激活函数。
:::

:::card{title=GELU}
$x \Phi(x)$，在零点附近平滑。
:::

:::card{title=SiLU}
$x \sigma(x)$，也叫 Swish。
:::

:::card{title=Tanh}
输出范围是 $(-1, 1)$。
:::

:::card{title=Sigmoid}
输出范围是 $(0, 1)$。
:::

:::card{span=2x1 title=Softplus}
$\log(1 + e^x)$，是 ReLU 的平滑版本。
:::

:::card{span=4x1 title=比较}
ReLU 在负半轴的导数是 0，GELU 和 SiLU 在负半轴仍有很小的导数，所以训练时不容易出现输出恒为 0 的神经元。
:::
::::

公式的写法见[公式](/features#math)，交互图的写法见[组件](/features#components)。
