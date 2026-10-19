---
title: 写法示范：被引用的文章
slug: syntax-linked
date: 2026-10-19
summary: 《Bake 写法一览》里的站内链接和嵌入指向这篇文章。
tags: [Bake, 写法]
category: math
---

这篇文章提供被《Bake 写法一览》链接和嵌入的标题与段落。

## 链式法则 {#chain-rule}

设 $y = f(u)$，$u = g(x)$，则

$$
\frac{\partial y}{\partial x} = \left(\frac{\partial u}{\partial x}\right)^{T} \frac{\partial y}{\partial u} \label{eq:chain}
$$

每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到。局部导数只依赖本层的输入和输出。^local-grad

## 向量与雅可比矩阵的乘积 {#vjp}

实际计算时不构造完整的雅可比矩阵，只计算向量与雅可比矩阵的乘积，代价和一次前向计算相当。

### 门控函数的导数 {#gate toc="门控"}

门控单元的局部导数就是门控函数的导数，下图画出 SiLU 的形状。

:::act-fn-plot{fn=silu range=4}
SiLU 在负半轴有一段小于零的区域，导数在零附近平滑变化。
:::

## 计算顺序 {#order}

反向传播按前向计算的逆拓扑顺序访问每个节点，每个节点只在它的所有后继都处理完之后才计算。^topo-order
