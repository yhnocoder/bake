---
title: 博客自己的扩展
slug: extending
layout: note
theme: warm
series: bake 示例
---

这一页使用博客自己的版式 `note`、主题 `warm`、块类型 `shape` 和 `theorem`，以及只属于这个主题的组件 `wave-figure`。

:::wave-figure{amplitude=0.8}
波形、说明文字和坐标轴的公式都由组件在浏览器里生成。
:::

权重矩阵 :shape[W]{kind=matrix} 乘以列向量 :shape[x]{kind=column}，得到列向量 :shape[Wx]{kind=column}，再加上标量 :shape[b] 的广播。

:::theorem[链式法则]
若 $y = f(u)$ 且 $u = g(x)$，则 $\frac{dy}{dx} = \frac{dy}{du} \cdot \frac{du}{dx}$。
:::
