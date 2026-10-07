---
title: 用梯度下降求函数的最小值
slug: paper
date: 2026-10-06
layout: paper
authors: [张三, 李四]
abstract: 本文从一元函数出发说明梯度下降的更新规则，给出步长过大时发散的条件，并讨论把它推广到多元函数时需要的记号。
toc: true
---

## 问题 {#problem}

给定可微函数 $f: \R \to \R$，求使 $f(x)$ 最小的 $x$。梯度下降从初始值 $x_0$ 出发，每一步沿负梯度方向移动[^name]。

[^name]: 一元函数的梯度就是导数 $f'(x)$，这里沿用多元情形的名称。

## 更新规则 {#update}

第 $k$ 步的更新是

$$
\label{eq:update}
x_{k+1} = x_k - \eta f'(x_k)
$$

其中 $\eta > 0$ 是步长。

### 步长的选择 {#step-size}

对 $f(x) = x^2$，式 $\eqref{eq:update}$ 给出 $x_{k+1} = (1 - 2\eta) x_k$。:span[当 $\eta > 1$ 时 $|1 - 2\eta| > 1$，迭代发散][^diverge]。

[^diverge]: $\eta = 1$ 时迭代在 $x_0$ 和 $-x_0$ 之间来回，既不收敛也不发散。

步长太小时收敛很慢，实际中常用随迭代次数减小的步长。

### 推广到 $\mathbb{R}^n$ {#multivariate}

多元函数把导数换成梯度 $\nabla f(x) \in \R^n$，更新规则的形式不变。

## 结论 {#conclusion}

梯度下降只需要计算梯度，适合参数很多的模型。
