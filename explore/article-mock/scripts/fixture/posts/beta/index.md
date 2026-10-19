---
title: 矩阵求导（测试）
slug: matrix-fixture
date: 2026-07-02
summary: 被测试文章链接和嵌入的目标文章。
toc: ticks
---

## 符号 {#notation}

这一章只有一段文字，用来让链式法则成为第二章。

## 链式法则 {#chain-rule}

设 $y = f(u)$，$u = g(x)$，则

$$
\frac{\partial y}{\partial x} = \left(\frac{\partial u}{\partial x}\right)^{\mathsf T} \frac{\partial y}{\partial u} \label{eq:chain}
$$

每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到[^local]。^local-grad

:::fixture-curve{fn=relu}
预览卡里不运行组件，只显示这一行图注。
:::

### 向量与雅可比矩阵的乘积 {#vjp}

实际计算时不构造完整的雅可比矩阵，只计算向量与雅可比矩阵的乘积，代价和一次前向计算相当。式 \eqref{eq:chain} 保留原文的编号。

:::embed
/2026-09/syntax-fixture/#intro
:::


## 雅可比矩阵 $J$ 的形状 {#jacobian-shape toc="雅可比矩阵的形状"}

标题里有公式，属性块写在公式后面。

:::list-table
* - 输出 ↓　输入 →
  - $x \in \mathbb{R}$
  - $\mathbf{x} \in \mathbb{R}^{n}$
  - $W \in \mathbb{R}^{p \times q}$
* - $y \in \mathbb{R}$
  - $\displaystyle \frac{dy}{dx} \in \mathbb{R}$
  - $\displaystyle \frac{\partial y}{\partial \mathbf{x}} = \Big[\frac{\partial y}{\partial x_1}\ \ \cdots\ \ \frac{\partial y}{\partial x_n}\Big] \in \mathbb{R}^{n}$
  - $\displaystyle \frac{\partial y}{\partial W} = \begin{bmatrix} \frac{\partial y}{\partial W_{11}} & \cdots & \frac{\partial y}{\partial W_{1q}}\\ \vdots & & \vdots\\ \frac{\partial y}{\partial W_{p1}} & \cdots & \frac{\partial y}{\partial W_{pq}} \end{bmatrix} \in \mathbb{R}^{p \times q}$
* - $\mathbf{y} \in \mathbb{R}^{m}$
  - $\displaystyle \frac{\partial \mathbf{y}}{\partial x} = \begin{bmatrix}\frac{\partial y_1}{\partial x}\\ \vdots\\ \frac{\partial y_m}{\partial x}\end{bmatrix} \in \mathbb{R}^{m}$
  - $\displaystyle \frac{\partial \mathbf{y}}{\partial \mathbf{x}} = \begin{bmatrix} \frac{\partial y_1}{\partial x_1} & \cdots & \frac{\partial y_1}{\partial x_n}\\ \vdots & & \vdots\\ \frac{\partial y_m}{\partial x_1} & \cdots & \frac{\partial y_m}{\partial x_n} \end{bmatrix} \in \mathbb{R}^{m \times n}$
  - $\displaystyle \frac{\partial \mathbf{y}}{\partial W} \in \mathbb{R}^{m \times p \times q}$
* - $Y \in \mathbb{R}^{r \times s}$
  - $\displaystyle \frac{\partial Y}{\partial x} \in \mathbb{R}^{r \times s}$
  - $\displaystyle \frac{\partial Y}{\partial \mathbf{x}} \in \mathbb{R}^{r \times s \times n}$
  - $\displaystyle \frac{\partial Y}{\partial W} \in \mathbb{R}^{r \times s \times p \times q}$
:::

[^local]: 被嵌入内容里的旁注不显示。
