---
title: 雅可比矩阵
slug: jacobian
date: 2026-10-12
summary: 向量函数的雅可比矩阵收集每个输出对每个输入的偏导数，反向传播用它的转置把梯度传回上一层。
tags: [数学, 梯度]
category: math
---

设 $f: \mathbb{R}^n \to \mathbb{R}^m$ 是一个可微的向量函数，输入是 $x$，输出是 $y = f(x)$。

## 定义

雅可比矩阵是一个 $m \times n$ 的矩阵，第 $i$ 行第 $j$ 列是第 $i$ 个输出对第 $j$ 个输入的偏导数：

$$
J_{ij} = \frac{\partial y_i}{\partial x_j}
$$

当 $m = 1$ 时，雅可比矩阵只有一行，这一行等于梯度的转置。

## 在反向传播中的作用

损失 $L$ 是一个标量。已知 $L$ 对输出 $y$ 的梯度时，$L$ 对输入 $x$ 的梯度等于雅可比矩阵的转置乘以这个梯度：

$$
\frac{\partial L}{\partial x} = J^{T} \frac{\partial L}{\partial y}
$$

写成分量，第 $j$ 个输入的梯度是对所有输出的求和：

$$
\frac{\partial L}{\partial x_j} = \frac{\partial L}{\partial y_1} \frac{\partial y_1}{\partial x_j} + \frac{\partial L}{\partial y_2} \frac{\partial y_2}{\partial x_j} + \cdots + \frac{\partial L}{\partial y_m} \frac{\partial y_m}{\partial x_j} = \sum_{i=1}^{m} \frac{\partial L}{\partial y_i} J_{ij}
$$

实际计算时不必写出整个矩阵。逐元素的激活函数的雅可比矩阵是对角矩阵，所以这一步只需要把梯度和激活函数的导数逐元素相乘。
