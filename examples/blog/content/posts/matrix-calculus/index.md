---
title: 深度学习中的矩阵微积分
slug: matrix-calculus
date: 2026-09-22
summary: 以 Transformer 语言模型里的运算为例，梳理训练时反向传播用到的求导规则。
tags: [深度学习, 矩阵微积分, 反向传播]
toc: notes
category: math
---

## 引言 {#intro}

:::aside
规则本身与 Terence Parr 和 Jeremy Howard 的[《深度学习所需的矩阵微积分》](https://yhnocoder.github.io/learn_by_visualization/topics/matrix-calculus/)[@parr2018]一致。本文把贯穿全文的例子换成了 Transformer 语言模型里的运算。
:::

深度学习里的反向传播，本质上是在回答一个问题：模型中的==某个中间量发生微小变化时，最终的 Loss 会怎样变化==？

如果模型里只有标量，这就是普通微积分里的求导。例如 $y = f(x)$，导数 $\dfrac{dy}{dx}$ 描述 $x$ 的变化如何影响 $y$。

但神经网络里的量几乎都不是单个数。以本文模型的最后几步为例：lm head 的输入 $X$ 是 $T \times d$ 的矩阵，乘权重矩阵 $W_{out}$ 得到 $T \times V$ 的 logits $Z$，每一行经过 softmax 变成一行概率，再由 cross-entropy 得到一个标量 Loss：

$$
X \in \mathbb{R}^{T \times d} \;\xrightarrow{\;W_{out}\;}\; Z \in \mathbb{R}^{T \times V} \;\xrightarrow{\;\mathrm{softmax}\;}\; P \in \mathbb{R}^{T \times V} \;\xrightarrow{\;\text{cross-entropy}\;}\; L \in \mathbb{R}
$$

训练要更新 $W_{out}$，就需要 $L$ 对 $W_{out}$ 的导数，麻烦的问题出现了：==一个标量对一个矩阵求导==，结果到底是什么？$L$ 要经过 $Z = XW_{out}$ 才依赖 $X$，==矩阵对矩阵求导==呢？softmax 把一行 logits 变成一行概率，==向量对向量的导数==又该如何表示？这些问题就是矩阵微积分要解决的事情。

实际写深度学习代码时，我们通常看不到这些推导。PyTorch 会把前向计算记录成计算图，调用 `loss.backward()` 之后，每个参数的 `.grad` 里就有了 Loss 对它的导数，形状与参数相同。本文要说明这个导数是什么，它怎样由每个运算的局部导数经过链式法则得到，以及计算它时为什么不需要矩阵对矩阵那样的高维导数。

本文以 lm head、softmax 与 cross-entropy、SwiGLU FFN 为例来介绍求导规则。而整个模型的反向传播，如 RMSNorm、attention 和 Embedding 的反向规则，以及训练时的显存和计算量，放在第二篇《Transformer 的反向传播》。

本文假定读者了解 Transformer 的各个模块，用 PyTorch 训练过模型，微积分已经生疏 :)。

### 本文使用的模型 {#model}

下图是一个 decoder-only Transformer 做语言模型训练时，从输入 token 到 Loss 的完整计算过程。$T$ 是序列长度，$d$ 是模型宽度，$V$ 是词表大小，$N$ 是 Decoder 的层数。图中省略了 batch 维度。

:::transformer-diagram
:::

这张图画出了本文使用的完整前向计算过程。输入是由 $T$ 个整数构成的 `token_ids`，经过 Embedding、若干 Transformer Block、输出投影和 CrossEntropy，最终得到一个标量 Loss $L$。

前向计算时，每个节点都定义了==输入如何变成输出==；反向传播要做的，就是从 $L$ 出发沿图==逆向计算梯度==，最终我们求出 $L$ 对所有可训练参数的导数。

对每个节点，我们需要知道：

==已知输出的梯度，如何得到输入和参数的梯度？==

感谢链式法则，整张计算图虽然看起来很大，真正需要掌握的求导规则其实只有有限几种。矩阵乘法、逐元素运算、归一化、Softmax、残差连接等，这些求导的规则只需要我们分别定义一次，之后遇到相同结构可直接复用。反向传播就是这些“子模块”的求导规则沿计算图不断组合的结果。

图中还包含 RMSNorm、SwiGLU FFN、GQA Attention 和 RoPE。下面的折叠部分只负责补充它们的前向定义和记号；如果你已经熟悉这些模块，可以直接跳过。真正开始求导时，再按需回来查对应公式即可。

::::fold{title="什么是 RMSNorm"}

RMSNorm 对每个位置的向量 $\mathbf{x} \in \mathbb{R}^{d}$ 单独计算：先除以 $\mathbf{x}$ 的均方根，再逐元素乘一个可学习的权重 $\gamma \in \mathbb{R}^{d}$[@zhang2019]：

$$
\mathrm{RMSNorm}(\mathbf{x}) = \frac{\mathbf{x}}{\mathrm{rms}(\mathbf{x})} \otimes \gamma \in \mathbb{R}^{d},\qquad \mathrm{rms}(\mathbf{x}) = \sqrt{\frac{1}{d}\sum_{k=1}^{d} x_k^2 + \epsilon}
$$

$\epsilon$ 是一个很小的正数（例如 $10^{-6}$），防止分母为零。除以 $\mathrm{rms}(\mathbf{x})$ 之后，各分量平方的平均值约等于 1，与输入向量本身的大小无关。和 LayerNorm 相比，RMSNorm 不减去均值，也没有偏置项。

::::

::::fold{title="什么是 SwiGLU FFN"}

FFN 对序列里的每个位置独立计算，所以下面只写一个位置的向量 $\mathbf{x} \in \mathbb{R}^{d}$：

$$
\mathbf{h} = \big(\mathrm{Swish}(\mathbf{x}W_{gate}) \otimes \mathbf{x}W_{up}\big)\,W_{down}
$$

三个权重矩阵是 $W_{gate}, W_{up} \in \mathbb{R}^{d \times d_{ff}}$ 和 $W_{down} \in \mathbb{R}^{d_{ff} \times d}$。$\otimes$ 表示逐元素相乘。Swish 逐元素作用在向量上，对每个数做的是 $\mathrm{Swish}(z) = z\,\sigma(z)$，其中 $\sigma(z) = \dfrac{1}{1+e^{-z}}$ 是 sigmoid 函数。

:::glu-diagram
上图中 $W_g$、$W_u$、$W_d$ 就是 $W_{gate}$、$W_{up}$、$W_{down}$，$\phi$ 是 Swish，$\odot$ 是逐元素相乘 $\otimes$，$X$ 的 $T$ 行是 $T$ 个位置的 $\mathbf{x}$。
:::

::::

::::fold{title="什么是 GQA Attention"}

Attention 让每个位置读取它自己和前面所有位置的信息。输入 $X \in \mathbb{R}^{T \times d}$，每一行是一个位置的向量。在本文的模型里，$X$ 是 RMSNorm 的输出。

先看一个 head。$X$ 分别乘三个权重矩阵 $W_Q, W_K, W_V \in \mathbb{R}^{d \times d_h}$，得到 query、key、value 三个矩阵 $Q, K, V \in \mathbb{R}^{T \times d_h}$，每一行对应一个位置：

$$
Q = XW_Q,\qquad K = XW_K,\qquad V = XW_V
$$

然后计算

$$
A = \mathrm{softmax}\!\left(\frac{QK^{T}}{\sqrt{d_h}} + M\right) V
$$

$QK^T \in \mathbb{R}^{T \times T}$，第 $t$ 行第 $s$ 列是位置 $t$ 的 query 与位置 $s$ 的 key 的点积，称为 attention 分数。$M$ 是 causal mask，把 $t < s$ 的元素置为 $-\infty$，使位置 $t$ 只读取自己和前面的位置。softmax 对每一行独立作用，把一行分数变成一组和为 1 的权重。最后乘 $V$：$A$ 的第 $t$ 行是各位置 value 向量按这组权重的加权和，$A \in \mathbb{R}^{T \times d_h}$。

Multi-Head Attention（MHA）把这个计算并行做 $n_h$ 次，每个 head 有自己的 $W_{Qi}$、$W_{Ki}$、$W_{Vi}$。$n_h$ 个 head 的输出 $A_1, \ldots, A_{n_h}$ 按列拼接成 $T \times n_h d_h$ 的矩阵，再乘 $W_O \in \mathbb{R}^{n_h d_h \times d}$，回到 $\mathbb{R}^{T \times d}$。

Grouped-Query Attention（GQA）相比 MHA 只改变 key 和 value 的数量：query 仍有 $n_h$ 个 head，key 和 value 只有 $n_{kv}$ 组，每组被 $n_h / n_{kv}$ 个 query head 共用。下图是 $n_h = 4$ 时 MHA 与 GQA 的对比，右边的 GQA 取 $n_{kv} = 2$。

:::mha-gqa
:::

用下标写出来：query head $i$ 属于第 $j$ 组时，

$$
Q_i = XW_Q^{(i)},\qquad K_j = XW_K^{(j)},\qquad V_j = XW_V^{(j)}
$$

$$
A_i = \mathrm{softmax}\!\left(\frac{Q_iK_j^{T}}{\sqrt{d_h}} + M\right) V_j
$$

这样做是为了减小推理时的 KV cache：生成每个新 token 时，前面所有位置的 $K$、$V$ 都要保存下来，组数从 $n_h$ 减到 $n_{kv}$，这部分显存按同样的比例减小。[^llama]

[^llama]: 例如 Llama 2 70B 有 64 个 query head，8 组 K/V。

本文的模型在计算 attention 分数之前，还对 query 和 key 各做两步处理。

第一步是 QK-Norm：对 $Q_i$ 和 $K_j$ 的每一行做 RMSNorm，归一化的维度是 $d_h$。query 和 key 各有一个权重 $\gamma_q, \gamma_k \in \mathbb{R}^{d_h}$，同一层的所有 head 共用这两个权重。这一步限制了 attention 分数的大小，使训练更稳定。

第二步是 RoPE：把 $Q_i$ 和 $K_j$ 的每一行按它所在的位置旋转，使 attention 分数依赖两个位置的差。定义见下面“什么是 RoPE”折叠块。

加上这两步，query head $i$ 的完整计算是

$$
\tilde{Q}_i = \mathrm{RoPE}\big(\mathrm{RMSNorm}(XW_Q^{(i)})\big),\qquad \tilde{K}_j = \mathrm{RoPE}\big(\mathrm{RMSNorm}(XW_K^{(j)})\big),\qquad V_j = XW_V^{(j)}
$$

$$
A_i = \mathrm{softmax}\!\left(\frac{\tilde{Q}_i\tilde{K}_j^{T}}{\sqrt{d_h}} + M\right) V_j
$$

下图画出了这个计算过程，再加上最后的拼接和 $W_O$。图中只画了 query head $i$ 一个 head；第 $j$ 组的 $\tilde{K}_j$ 和 $V_j$ 还要被同组的其他 head 使用，$\mathrm{Concat}$ 把 $n_h$ 个 head 的输出按列拼接起来。

:::gqa-attention
:::

::::

::::fold{title="什么是 RoPE"}

attention 分数是 query 与 key 的点积，点积只由两个向量的值决定，不包含它们在序列里的位置。RoPE（rotary position embedding）在计算点积之前，按位置旋转 query 和 key，使点积依赖两个位置的差[@su2021]。

**两维的情形**。先设 $d_h = 2$。位置 $t$ 的 query 向量 $\mathbf{q} = [\,q_1\ \ q_2\,]$ 看作平面上的一个点，RoPE 把它绕原点逆时针旋转角度 $t\theta$：

$$
\mathrm{RoPE}(\mathbf{q}) = \mathbf{q}\,R(t\theta),\qquad R(\alpha) = \begin{bmatrix}\cos\alpha & \sin\alpha\\ -\sin\alpha & \cos\alpha\end{bmatrix}
$$

$\theta$ 是一个固定的角度，位置每增加 1，向量多转 $\theta$。位置 $s$ 的 key 向量 $\mathbf{k}$ 同样旋转 $s\theta$。旋转矩阵满足 $R(\alpha)R(\beta)^{T} = R(\alpha - \beta)$，所以旋转之后的点积是

$$
\big(\mathbf{q}R(t\theta)\big)\big(\mathbf{k}R(s\theta)\big)^{T} = \mathbf{q}\,R(t\theta)R(s\theta)^{T}\,\mathbf{k}^{T} = \mathbf{q}\,R\big((t-s)\theta\big)\,\mathbf{k}^{T}
$$

结果只依赖位置差 $t - s$。几何上，两个向量的长度不变，夹角改变 $(t-s)\theta$，所以两个位置同时增加相同的数时，点积不变。

**$d_h$ 维的情形**。把 $d_h$ 个分量按顺序分成 $d_h/2$ 对，第 $k$ 对 $(q_{2k-1}, q_{2k})$ 在自己的平面里旋转角度 $t\theta_k$，其中

$$
\theta_k = b^{-2(k-1)/d_h},\qquad k = 1, \ldots, d_h/2
$$

$b$ 是一个常数，原论文取 $10000$，Llama 3 取 $500000$。$\theta_1 = 1$，之后逐对减小，最后一对接近 $1/b$：前几对随位置转得快，后几对转得慢。各对之间互不影响，合起来是一个分块对角的 $d_h \times d_h$ 正交矩阵 $R_t$，对角线上是 $d_h/2$ 个 $2 \times 2$ 旋转矩阵：

$$
\mathrm{RoPE}(\mathbf{q}_t) = \mathbf{q}_t R_t \in \mathbb{R}^{d_h},\qquad R_t = \begin{bmatrix} R(t\theta_1) & & \\ & \ddots & \\ & & R(t\theta_{d_h/2}) \end{bmatrix}
$$

点积等于各对的点积之和，每一对都满足两维情形的结论，所以

$$
(\mathbf{q}_t R_t)(\mathbf{k}_s R_s)^{T} = \mathbf{q}_t\,R_{t-s}\,\mathbf{k}_s^{T}
$$

下图画出其中一对分量的旋转，取 $d_h = 8$、$b = 10000$，四对的 $\theta_k$ 分别是 $1$、$0.1$、$0.01$、$0.001$。虚线是旋转前的 $\mathbf{q}$ 和 $\mathbf{k}$，实线是旋转后的向量。两个滑块设置 query 的位置 $t$ 和 key 的位置 $s$。点“$t$ 和 $s$ 同时加 1”，两个向量转过相同的角度，旋转后的点积不变。切换到第 4 对，$t = 20$ 时向量只转了 $0.02$ 弧度。

:::rope-rotation
:::

RoPE 没有参数，$R_t$ 由位置 $t$ 完全确定。实现里分量的配对方式不一定是相邻两个：Hugging Face 的 Llama 实现把第 $k$ 个和第 $k + d_h/2$ 个分量配成一对。两种配对只差一个固定的分量重排，上面的结论相同。

::::

:::recap
Transformer：从输入 token_ids 到 loss 的完整计算过程，以及模型结构的定义
:::

### 深度学习中用到的导数概览 {#shapes}

一元微积分里，$y = f(x)$ 的输入和输出都是标量，[导数](#derivative) $\dfrac{dy}{dx}$ 也是一个标量。

神经网络中一个运算的输入和输出可以是标量 $x \in \mathbb{R}$、向量 $\mathbf{x} \in \mathbb{R}^{n}$ 或矩阵 $W \in \mathbb{R}^{p \times q}$，这时导数由多个数组成：需要给出输出的每个分量对输入的每个分量的[偏导数](#partial)。

下表列出输入和输出分别是标量、向量、矩阵时的导数。高阶 Tensor（大于 2 维）规则与矩阵类似。

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

表中右下角的三格，即 $\mathbf{y}$ 对 $W$、$Y$ 对 $\mathbf{x}$ 和 $Y$ 对 $W$ 的导数，是三维和四维的数组。模型里的运算大多是矩阵进、矩阵出，例如 lm head 的 $Z = XW_{out}$，按这张表，$Z$ 对 $X$ 的导数在右下角的格子里，有 $T \times V \times T \times d$ 个元素。反向传播怎样处理这三格，是本文要回答的问题之一。

:::aside{title="记号约定"}
本文不把矩阵展平，而是保留原有维度，因此 $Y\in\mathbb R^{r\times s}$ 对 $W\in\mathbb R^{p\times q}$ 的完整导数记为 $\mathbb R^{r\times s\times p\times q}$。
:::

:::aside
本文的向量都是行向量，线性层写成 $\mathbf{x}W$，与 PyTorch 的 `x @ W` 一致。

向量对向量的导数，行对应输出、列对应输入，这种排法称为 numerator layout。有些资料采用转置的排法，称为 denominator layout。其他资料的公式形状与本文不一致时，先检查它采用哪一种排法。
:::

:::recap
输入 $\times$ 输出：（标量、向量、矩阵） $\times$ （标量、向量、矩阵）
:::

## 标量对标量：导数 {#review}

### 什么是导数 {#derivative}

先看最简单的情形：输入 $x \in \mathbb{R}$，输出 $y = f(x) \in \mathbb{R}$，两者都是标量。

设 $\Delta x$ 为一个很小的变化量，$x$ 变到 $x + \Delta x$ 时，$y$ 从 $f(x)$ 变到 $f(x + \Delta x)$，变化量 $\Delta y = f(x+\Delta x) - f(x)$，两者的比值是 $\dfrac{\Delta y}{\Delta x} = \dfrac{f(x+\Delta x) - f(x)}{\Delta x}$。

==$\Delta x$ 趋于零时这个比值的极限==，就是 $y$ 对 $x$ 的导数，记作 $\dfrac{dy}{dx}$：

$$
\frac{dy}{dx} = \lim_{\Delta x \to 0} \frac{f(x+\Delta x) - f(x)}{\Delta x}
$$

同一个导数也可以写成 $\dfrac{d}{dx}y$、$\dfrac{df(x)}{dx}$ 或 $\dfrac{d}{dx}f(x)$。从几何上来看，$\dfrac{dy}{dx}$ 是 $f$ 的图像在 $x$ 处的切线的斜率。

::::fold{title="割线、切线与导数的图像"}

比值 $\dfrac{\Delta y}{\Delta x}$ 是 $f$ 的图像上过 $x$ 和 $x+\Delta x$ 两点的直线的斜率，这条直线称为割线。

这个比值随 $\Delta x$ 改变。取 $f(x) = x^3$，在 $x = 1$ 处：$\Delta x = 1$ 时比值是 $7$，$\Delta x = 0.1$ 时是 $3.31$，$\Delta x = 0.01$ 时是 $3.0301$。$\Delta x$ 越小，比值越接近 $3$。下图的两个滑块分别控制 $x_0$ 和 $\Delta x$，把 $\Delta x$ 从 $1$ 减小到 $0.001$，可以看到割线的斜率逐渐接近 $3$。

:::tangent-secant
:::

$\Delta x$ 趋于零时，割线趋于一条确定的直线，这条直线是 $x_0$ 处的切线。切线的斜率不再依赖 $\Delta x$，这个斜率就是 $x_0$ 处的导数 $\dfrac{dy}{dx}$。

$x_0$ 取不同位置时切线的斜率不同，所以导数 $\dfrac{dy}{dx}$ 本身也是 $x$ 的函数，图的下半部分画的是它。对 $y = x^3$ 有 $\dfrac{dy}{dx} = 3x^2$，对 $y = \sin x$ 有 $\dfrac{dy}{dx} = \cos x$。

记号 $\dfrac{dy}{dx}$ 里的 $d$ 表示无穷小的变化量：把比值 $\dfrac{\Delta y}{\Delta x}$ 中的 $\Delta$ 换成 $d$，表示 $\Delta x$ 趋于零之后的结果。

::::

:::recap
$\dfrac{dy}{dx} = \lim\limits_{\Delta x \to 0} \dfrac{f(x+\Delta x) - f(x)}{\Delta x}$\
即 $f$ 的图像在 $x$ 处切线的斜率
:::

### 标量求导规则 {#rules}

下表列出本文用到的标量求导规则。这些规则读者在微积分课上都见过，如果不理解需要重新上高中。

| 规则 | $f(x)$ | $\dfrac{d}{dx}f(x)$ | 例子 |
|---|---|---|---|
| 常数（不含 $x$ 的量） | $c$ | $0$ | $\dfrac{d}{dx}\,99 = 0$；只要 $y$ 不依赖 $x$，$\dfrac{d}{dx}\,3y = 0$ |
| 常数倍 | $c\,f$ | $c\,\dfrac{df}{dx}$ | $\dfrac{d}{dx}\,3x^2 = 3 \cdot 2x = 6x$ |
| 幂函数 | $x^n$ | $n\,x^{n-1}$ | $\dfrac{d}{dx}\,x^3 = 3x^2$；$\dfrac{d}{dx}\,x^{-1} = -x^{-2}$ |
| 加法 | $f + g$ | $\dfrac{df}{dx} + \dfrac{dg}{dx}$ | $\dfrac{d}{dx}\,(x^2 + 3x) = 2x + 3$ |
| 减法 | $f - g$ | $\dfrac{df}{dx} - \dfrac{dg}{dx}$ | $\dfrac{d}{dx}\,(x^2 - 3x) = 2x - 3$ |
| 指数函数 | $e^x$ | $e^x$ | $\dfrac{d}{dx}\,e^{2x} = 2e^{2x}$（配合链式法则） |
| 对数函数 | $\ln x$ | $\dfrac{1}{x}$ | $\dfrac{d}{dx}\,\ln(x^2) = \dfrac{1}{x^2} \cdot 2x = \dfrac{2}{x}$（配合链式法则） |
| sigmoid | $\sigma(x) = \dfrac{1}{1+e^{-x}}$ | $\sigma(x)\,\big(1-\sigma(x)\big)$ |  |
| Swish | $x\,\sigma(x)$ | $\sigma(x) + x\,\sigma(x)\,\big(1-\sigma(x)\big)$ |  |

还有两个常用的法则：

| 规则 | $f(x)$ | $\dfrac{d}{dx}f(x)$ | 例子 |
|---|---|---|---|
| 乘积法则 | $f\,g$ | $f\,\dfrac{dg}{dx} + \dfrac{df}{dx}\,g$ | $\dfrac{d}{dx}\,(x^2 \cdot x) = x^2 \cdot 1 + 2x \cdot x = 3x^2$ |
| 商法则 | $\dfrac{f}{g}$ | $\dfrac{\dfrac{df}{dx}\,g - f\,\dfrac{dg}{dx}}{g^2}$ | $\dfrac{d}{dx}\,\dfrac{x}{x+1} = \dfrac{(x+1) - x}{(x+1)^2} = \dfrac{1}{(x+1)^2}$ |

$\dfrac{d}{dx}$ 也可以看成一个运算符，输入一个函数，输出另一个函数。可以这么思考：

- 加法可以拆开：$\dfrac{d}{dx}\big(f(x) + g(x)\big) = \dfrac{d}{dx}f(x) + \dfrac{d}{dx}g(x)$；
- 常数因子可以提到它前面：$\dfrac{d}{dx}\big(\alpha f(x)\big) = \alpha \dfrac{d}{dx}f(x)$。

所以对复杂表达式求导可以先拆分、分别求导、再组合：

$$
\frac{d}{dx}\,9(x + x^2) = 9\,\frac{d}{dx}(x + x^2) = 9\Big(\frac{d}{dx}x + \frac{d}{dx}x^2\Big) = 9(1 + 2x) = 9 + 18x
$$

:::recap
标量求导规则
:::

### 单变量链式法则 {#chain-scalar}

我们经常遇到这样的函数[^operator]：虽然最终只关心输入 $x$ 和输出 $y$，但从 $x$ 算到 $y$，中间需要经过几步运算。例如

[^operator]: 大模型中的每个算子都可以理解成一个函数。

$$
y=\sin(x^2)
$$

计算时，我们先对 $x$ 平方，再对结果取 $\sin$。为了把这两步写清楚，可以给平方后的结果起一个名字 $u$：

$$
u=x^2,\qquad y=\sin u
$$

$u$ 不是额外引入的独立变量，只是原本就存在的中间计算结果。这样写没有改变函数，却把 $x$ 如何影响 $y$ 展开成了一条明确的依赖路径：

$$
x\longrightarrow u\longrightarrow y
$$

现在我们想知道：$x$ 发生一个微小变化时，$y$ 会变化多少？可以分两步来看。首先，$x$ 的变化引起 $u$ 的变化，在局部有 $\Delta u\approx \dfrac{du}{dx}\Delta x$。接着，$u$ 的变化引起 $y$ 的变化：$\Delta y\approx \dfrac{dy}{du}\Delta u$。把两步连起来，就得到

$$
\Delta y\approx \frac{dy}{du}\frac{du}{dx}\Delta x
$$

也就是说，每一步的导数描述这一段运算如何传递微小变化，把它们相乘，就得到了整条路径上的变化率。当相关函数可导时，这就是==链式法则==：

$$
\boxed{\frac{dy}{dx}=\frac{dy}{du}\frac{du}{dx}}
$$

对于刚才的例子，

$$
\frac{du}{dx}=2x,\qquad \frac{dy}{du}=\cos u
$$

因此

$$
\frac{dy}{dx}= \frac{dy}{du} \frac{du}{dx} = \cos u\cdot 2x=2x\cos(x^2)
$$

引入中间变量的意义也就在这里：我们可以把==一个复杂函数拆成若干简单运算==，分别计算每一步的局部导数，再把它们组合起来。如果依赖链更长，例如 $x\to v\to u\to y$，同样有

$$
\frac{dy}{dx} = \frac{dy}{du} \frac{du}{dv} \frac{dv}{dx}
$$

反向传播利用的正是这种组合方式。前向计算沿 $x\to v\to u\to y$ 得到结果；如果最终的 Loss 就是 $y$，反向传播便从 $y$ 出发，先计算 $\dfrac{dy}{du}$，再乘上 $\dfrac{du}{dv}$ 得到 $\dfrac{dy}{dv}$，继续往回得到 $\dfrac{dy}{dx}$。每往回一步，都是把已经得到的梯度与这一段的局部导数组合起来。

:::backprop-paths{paths=chain}
:::

:::recap
$y = f(u)$，$u = g(x)$ 时 $\dfrac{dy}{dx} = \dfrac{dy}{du}\,\dfrac{du}{dx}$。从最外层的 $y$ 开始，逐层往回乘。
:::

### 例：Sigmoid 与 Swish 的导数 {#swish}

SwiGLU FFN 的 gate 分支使用 Swish，Swish 由 sigmoid 定义。规则表给出了两者的导数，下面用链式法则和乘积法则推出这两个结果。

sigmoid 的公式是 $\sigma(x) = \dfrac{1}{1+e^{-x}}$，可以写成复合函数：$\sigma(x) = u^{-1}$，其中 $u = 1 + e^{-x}$：

$$
\frac{d\sigma}{du} = -u^{-2},\qquad \frac{du}{dx} = -e^{-x}
$$

按链式法则把两者相乘：

$$
\begin{aligned}
\frac{d\sigma}{dx} = \frac{d\sigma}{du}\,\frac{du}{dx} &= \frac{e^{-x}}{(1+e^{-x})^2}\\
&= \frac{1}{1+e^{-x}} \cdot \frac{e^{-x}}{1+e^{-x}}\\
&= \sigma(x)\,\big(1-\sigma(x)\big)
\end{aligned}
$$

Swish 是两个函数的乘积：$\mathrm{Swish}(x) = x \cdot \sigma(x)$。按乘积法则，再代入上面的 $\dfrac{d\sigma}{dx}$：

$$
\begin{aligned}
\frac{d\,\mathrm{Swish}(x)}{dx} &= 1 \cdot \sigma(x) + x\,\frac{d\sigma}{dx}\\
&= \sigma(x) + x\,\sigma(x)\,\big(1-\sigma(x)\big)\\
&= \sigma(x)\,\big(1 + x\,(1-\sigma(x))\big)
\end{aligned}
$$

:::recap
$\mathrm{Swish}(x) = x\,\sigma(x)$，按乘积法则得 $\mathrm{Swish}'(x) = \sigma(x)\big(1 + x(1-\sigma(x))\big)$。逐元素函数 $f$ 的导数记作 $f'$。
:::

## 标量对向量 {#partials}

前面讨论的函数只有一个标量输入，例如 $y = f(x)$。但神经网络中的一个输出通常同时依赖许多量，我们一般写成 $y = f(\mathbf{x})$。例如 lm head 的一个 logit：

$$
z_j = \sum_{k=1}^{d} x_k W_{kj}
$$

$z_j$ 同时依赖 $x_1, \ldots, x_d$ 和 $W_{1j}, \ldots, W_{dj}$。如果我们只想知道其中某一个量变化时 $z_j$ 如何变化，就需要在其他量保持不变的情况下对它求导。这就是偏导数。

我们先用一个只有两个输入的函数把这个概念讲清楚，再回到上面的 lm head。

### 偏导数 {#partial}

对多元函数，==只改变其中一个自变量、保持其他自变量不变==时得到的导数称为偏导数，通常用 $\partial$ 表示，写作 $\dfrac{\partial f}{\partial x}$，在 $(x_0, y_0)$ 处的值写作 $\left.\dfrac{\partial f}{\partial x}\right|_{(x_0,y_0)}$。

举个例子：设 $f(x, y) = 3x^2 y$ 有两个输入，可以沿 $x$ 方向改变，也可以沿 $y$。我们先只让一个输入变化。

==固定 $y$，只让 $x$ 变化==。固定 $y = y_0$ 后，$x \mapsto f(x, y_0)$ 就成为一个关于 $x$ 的单变量函数，因此可以直接使用前面的一元求导规则。它的图像是一条单变量曲线 $z = f(x, y_0)$。

计算时把 $y$ 当作常数：

$$
\frac{\partial}{\partial x}\,3x^2y = 3y \cdot \frac{d}{dx}x^2 = 3y \cdot 2x = 6xy
$$

==固定 $x$，只让 $y$ 变化==，得到 $f$ 对 $y$ 的偏导数：

$$
\frac{\partial}{\partial y}\,3x^2y = 3x^2 \cdot \frac{d}{dy}y = 3x^2
$$

所以，一个二元函数在同一点可以有两个不同的局部变化率 $\dfrac{\partial f}{\partial x}$ 和 $\dfrac{\partial f}{\partial y}$。前者描述沿 $x$ 方向移动时函数怎样变化，后者描述沿 $y$ 方向移动时函数怎样变化。如果函数有更多输入，道理完全一样。

:::gradient-field
左边是 $f(x, y)$ 的取值，经过选定的位置 $(x_0, y_0)$ 的曲线是 $f$ 的等值线，曲线上每一点的 $f$ 都等于 $f(x_0, y_0)$。

绿色箭头：$\dfrac{\partial f}{\partial x}$；粉色箭头：$\dfrac{\partial f}{\partial y}$。紫色箭头是两者合成的向量。

右边两张图是过 $(x_0, y_0)$、分别固定 $y = y_0$ 和固定 $x = x_0$ 切出的两条单变量曲线，各带一条切线，两条切线的斜率就是两个偏导数。
:::

现在重新回到 lm head：

$$
z_j = \sum_{k=1}^{d} x_k W_{kj}
$$

展开就是

$$
z_j = x_1W_{1j} + x_2W_{2j} + \cdots + x_dW_{dj}
$$

假设只改变 $x_k$，其他 $x$ 和所有权重都保持不变。与 $x_k$ 有关的只有 $x_kW_{kj}$ 这一项，因此

$$
\frac{\partial z_j}{\partial x_k} = W_{kj}
$$

$x_k$ 增加一个很小的量时，它对 $z_j$ 的影响会被权重 $W_{kj}$ 缩放。同样，如果只改变权重 $W_{kj}$，其他变量保持不变：

$$
\frac{\partial z_j}{\partial W_{kj}} = x_k
$$

所以在线性层里，输入对输出的影响由权重决定，而权重对输出的影响由对应的输入决定。

:::recap
$\dfrac{\partial f}{\partial x}$ 是其余输入固定、只让 $x$ 变化时的导数。例如 $\dfrac{\partial}{\partial x}\,3x^2y = 6xy$。
:::

### 梯度 {#gradient}

偏导数描述的是：保持其他输入不变，只改变其中一个输入分量时，输出如何变化。但训练模型时，多个参数通常会同时更新。我们还需要知道：当多个输入一起发生微小变化时，它们对输出的影响应该怎样组合？

先看前面的例子：

$$
f(x,y)=3x^2y
$$

我们已经知道

$$
\frac{\partial f}{\partial x}=6xy\qquad\frac{\partial f}{\partial y}=3x^2
$$

现在让它们同时变化，输入从 $(x,y)$ 变成 $(x+\Delta x,y+\Delta y)$，输出的实际变化为

$$
\begin{aligned}
\Delta f &=f(x+\Delta x,y+\Delta y)-f(x,y)\\
&=3(x+\Delta x)^2(y+\Delta y)-3x^2y\\
&=6xy\,\Delta x+3x^2\,\Delta y\\
&\quad+3y(\Delta x)^2 +6x\,\Delta x\,\Delta y +3(\Delta x)^2\Delta y
\end{aligned}
$$

前两项分别是两个偏导数乘以对应的输入变化。后面几项则包含变化量的==平方或乘积==：当 $\Delta x$ 和 $\Delta y$ 一起趋近于零时，这些项相对于输入变化的大小会==更快趋近于零==。因此，保留一阶项，就得到

$$
\Delta f \approx 6xy\,\Delta x+3x^2\,\Delta y = \frac{\partial f}{\partial x}\Delta x + \frac{\partial f}{\partial y}\Delta y
$$

这说明，对于这个函数，多个输入同时发生微小变化时，==输出的变化可以近似为各个输入的一阶影响之和==。输入之间共同变化产生的额外影响仍然存在，只是在这里落入了高阶项。

更一般地，若 $f=f(x_1,\ldots,x_n)$ 在当前点可微，就有这样的一阶近似：

$$
\begin{aligned}
\Delta f &= \sum_{i=1}^{n} \frac{\partial f}{\partial x_i}\Delta x_i + o(\|\Delta\mathbf{x}\|)\\
&= \left[ \frac{\partial f}{\partial x_1}\ \cdots\ \frac{\partial f}{\partial x_n}\right] \cdot \left[\Delta x_1 \cdots \Delta x_n\right] + o(\|\Delta\mathbf{x}\|)
\end{aligned}
$$

为了统一表示这些局部变化率，我们把偏导数按照输入分量的顺序排成一个向量，称为 ==$f$ 的梯度==。沿用这里的行向量约定：

$$
\mathbf{x}=[x_1\ \cdots\ x_n], \qquad \boxed{ \nabla_{\mathbf{x}}f = \left[ \frac{\partial f}{\partial x_1} \ \cdots\ \frac{\partial f}{\partial x_n} \right]}
$$

于是，上面的一阶近似可以写成点积：

$$
\Delta f\approx \nabla_{\mathbf{x}}f\cdot\Delta\mathbf{x}
$$

例如，对于 $f(x,y)=3x^2y$，

$$
\nabla f=[6xy\quad 3x^2]
$$

令 $d\mathbf{x}$ 表示输入增量，则

$$
\boxed{df=\nabla_{\mathbf{x}}f\cdot d\mathbf{x}}
$$

我们把这个用于近似实际变化的线性部分称为==全微分==，记作 $df$。

梯度还有一个重要的几何意义。由点积公式，

$$
df = \|\nabla f\|\,\|d\mathbf{x}\|\cos\theta
$$

其中 $\theta$ 是梯度与输入变化方向之间的夹角。在当前点梯度非零、输入变化的欧氏长度 $\|d\mathbf{x}\|$ 固定时，沿梯度方向移动，一阶变化最大。因此，==梯度指向函数局部增长最快的方向，负梯度指向局部下降最快的方向==。

:::recap
$\nabla f = \dfrac{\partial f}{\partial \mathbf{x}} = \Big[\,\dfrac{\partial f}{\partial x_1}\ \ \dfrac{\partial f}{\partial x_2}\ \ \cdots\ \ \dfrac{\partial f}{\partial x_n}\,\Big]$\
梯度指向函数局部增长最快的方向。
:::

### 全导数链式法则 {#chain-paths}

前面的链式法则只有一条依赖路径。更一般地，一个变量对输出的影响可能经过多条路径。设

$$
u_k = g_k(x),\qquad y = f(u_1, \ldots, u_n)
$$

那么 $x$ 的变化会同时通过所有 $u_k$ 影响 $y$。

按[“梯度”一节](#gradient)中得到的结论 $df=\nabla_{\mathbf{x}}f\cdot d\mathbf{x}$，$dy$ 是各个 $u_k$ 的贡献之和：

$$
dy = \nabla_{\mathbf{u}}f\cdot d\mathbf{u} = \sum_{k=1}^{n} \frac{\partial y}{\partial u_k}\,du_k
$$

==每个 $u_k$ 是 $x$ 的函数==，同样有 $du_k = \dfrac{du_k}{dx}\,dx$。代入后两边除以 $dx$：

$$
\boxed{\frac{dy}{dx} = \sum_{k=1}^{n} \frac{\partial y}{\partial u_k}\,\frac{du_k}{dx}}
$$

这里的 $\dfrac{dy}{dx}$ 称为 ==$y$ 对 $x$ 的全导数==（total derivative），它计入==$x$ 经过所有路径对 $y$ 的影响==。

:::backprop-paths{paths=total}
:::

求和的第 $k$ 项是经过 $u_k$ 的那条路径的贡献：从 $y$ 出发，先乘 $\dfrac{\partial y}{\partial u_k}$，再乘 $\dfrac{du_k}{dx}$，图中高亮的是经过 $u_1$ 的那条路径。$n$ 条路径的贡献相加，就是全导数。

:::aside
虽然 $y$ 表面上依赖多个中间变量 $u_k$，但这些 $u_k$ 都由同一个标量 $x$ 决定，因此最终 $y$ 仍然可以看成 $x$ 的单变量函数，导数写作 $\dfrac{dy}{dx}$。
:::

::::fold{title="为什么所有路径都要算？"}

取一个最简单的例子：

$$
y = x + x^2
$$

直接求导当然得到[^obvious]

[^obvious]: 这是我们觉得“显然正确”的结果。

$$
\frac{dy}{dx} = 1 + 2x
$$

现在引入中间变量，使用带有中间变量形式的求导计算

$$
u = x^2,\qquad y = x + u
$$

在这张计算图里，$x$ 通过两条路径影响 $y$：

$$
x \rightarrow y,\qquad x \rightarrow u \rightarrow y
$$

只看直接路径，对 $x$ 求偏导：

$$
\frac{\partial y}{\partial x} = 1
$$

这个结果没有错。它表示的是：假设 $u$ 保持不变，只改变 $x$，$y$ 会怎样变化。

但在实际计算图中，$u = x^2$ 也会随 $x$ 改变，因此还要计算另一条路径的贡献：

$$
\frac{\partial y}{\partial u}\,\frac{du}{dx} = 1 \cdot 2x = 2x
$$

把所有从 $x$ 到 $y$ 的路径贡献相加：

$$
\frac{dy}{dx} = \frac{\partial y}{\partial x} + \frac{\partial y}{\partial u}\,\frac{du}{dx} = 1 + 2x
$$

这才是 $x$ 变化时 $y$ 的实际变化率。

所以，全导数链式法则的关键不是“遇到中间变量就乘导数”，而是：沿每条路径把局部导数相乘，再把==所有路径的贡献相加==。

::::

模型里更常见的是==标量对向量的梯度==：输入是一个向量 $\mathbf{x} = [\,x_1\ \ x_2\ \ \cdots\ \ x_m\,]$，由它算出中间变量 $\mathbf{u} = [\,u_1\ \ u_2\ \ \cdots\ \ u_n\,]$，再由 $\mathbf{u}$ 算出标量 $y$（例如 Loss）：

$$
\begin{aligned}
u_k &= g_k(x_1, x_2, \ldots, x_m),\qquad k = 1, \ldots, n \\
y &= f(u_1, u_2, \ldots, u_n)
\end{aligned}
$$

:::backprop-paths{paths=vector}
:::

每个 $u_k$ 都可能依赖全部 $m$ 个分量，所以 $y$ 和每个 $x_i$ 之间都有 $n$ 条路径。反向传播时，$y$ 对 $x_i$ 的偏导数沿这 $n$ 条路径传回 $x_i$，图中高亮的是 $x_1$ 的 $n$ 条。

要求的梯度 $\dfrac{\partial y}{\partial \mathbf{x}}$ 由 $y$ 对每个分量 $x_i$ 的偏导数组成：

$$
\frac{\partial y}{\partial \mathbf{x}} = \Big[\,\frac{\partial y}{\partial x_1}\ \ \frac{\partial y}{\partial x_2}\ \ \cdots\ \ \frac{\partial y}{\partial x_m}\,\Big]
$$

$x_i$ 变化时，所有依赖它的 $u_k$ 都随之变化，按全导数链式法则，每个分量都要把 $n$ 条路径的贡献相加：

$$
\begin{aligned}
\frac{\partial y}{\partial x_i}
&= \sum_{k=1}^{n} \frac{\partial y}{\partial u_k}\,\frac{\partial u_k}{\partial x_i}\\
&= \boxed{\frac{\partial y}{\partial \mathbf{u}}\frac{\partial \mathbf{u}}{\partial x_i}}
\end{aligned}
$$

把所有 $x_i$ 的结果放在一起，上式正好就是一次矩阵乘法：

$$
\boxed{
\frac{\partial y}{\partial \mathbf{x}} = \frac{\partial y}{\partial \mathbf{u}}\,\frac{\partial \mathbf{u}}{\partial \mathbf{x}}
}
$$

这就是==标量对向量情况下的链式法则==。

:::recap

$$
x \rightarrow [u_1, u_2, \cdots, u_n] \rightarrow y
$$

经过多个中间变量影响 $y$ 时，各条路径的贡献相加：$\dfrac{dy}{dx} = \sum_k \dfrac{\partial y}{\partial u_k}\,\dfrac{du_k}{dx}$。输入是向量时，对每个分量 $x_i$ 分别求和。
:::

### 例：Loss 对 logits 的梯度 {#loss-grad}

:::lm-head{from=z to=loss}
:::

反向传播从 Loss 出发，第一步经过 cross-entropy 和 softmax，所以梯度 $\dfrac{\partial \ell}{\partial \mathbf{z}}$ 是模型里第一个要算的梯度。

先从 forward 角度看，lm head 在这个位置输出词表大小的向量 $\mathbf{z} = [\,z_1\ \ z_2\ \ \cdots\ \ z_V\,]$，softmax 把它们变成一个概率分布：

$$
p_j = \frac{e^{z_j}}{\sum_{k=1}^{V} e^{z_k}}
$$

$p_j$ 是模型给词表中第 $j$ 个 token 的概率。设这个位置的目标 token 在词表中的编号是 $y \in \mathbb{Z}$。

cross-entropy loss 是目标 token 的概率取负对数。

$$
\ell = -\ln p_y
$$

$p_y$ 越接近 1，$\ell$ 越接近 0。

$\ell$ 是一个标量，经过 softmax 依赖 $\mathbf{z}$ 的每一个分量，所以它对 $\mathbf{z}$ 的导数是一个梯度：$\dfrac{\partial{\ell}}{\partial{\mathbf{z}}} \in \mathbb{R}^{V}$。先把 $\ell$ 展开：

$$
\ell = -\ln \frac{e^{z_y}}{\sum_k e^{z_k}} = -z_y + \ln \sum_{k=1}^{V} e^{z_k}
$$

对 $z_j$ 求偏导时，其余的 logit 都当作常数，两项分别计算。

第一项 $-z_y$：$j = y$ 时，它对 $z_j$ 的导数是 $-1$；$j \neq y$ 时，$-z_y$ 不含 $z_j$，导数是 $0$。

第二项：记 $u = \sum_k e^{z_k}$。其余 logit 固定时，$u$ 是 $z_j$ 的单变量函数，按[单变量链式法则](#chain-scalar)，$\ln u$ 对 $z_j$ 的导数是 $\dfrac{1}{u}$ 乘 $u$ 对 $z_j$ 的导数。$u$ 的 $V$ 项里只有 $e^{z_j}$ 含 $z_j$，它的导数是 $e^{z_j}$，所以

$$
\frac{\partial}{\partial z_j} \ln \sum_k e^{z_k} = \frac{e^{z_j}}{\sum_k e^{z_k}} = p_j
$$

两项相加：

$$
\frac{\partial \ell}{\partial z_j} = \begin{cases} p_j - 1 & j = y \\ p_j & j \neq y \end{cases}
$$

把目标 token 写成一个 one-hot 向量 $\mathbf{y}$：第 $y$ 个分量是 1，其余分量是 0。$V$ 个偏导数排成一行，就是 $\ell$ 对 $\mathbf{z}$ 的梯度：

$$
\boxed{\frac{\partial \ell}{\partial \mathbf{z}} = \mathbf{p} - \mathbf{y}},\qquad \mathbf{p} = [\,p_1\ \ p_2\ \ \cdots\ \ p_V\,]
$$

例如 $V = 3$，$\mathbf{z} = [\,2\ \ 1\ \ 0\,]$，目标是第 1 个 token。这时 $\mathbf{p} \approx [\,0.665\ \ 0.245\ \ 0.090\,]$，梯度是 $[\,-0.335\ \ 0.245\ \ 0.090\,]$。

梯度的每个分量给出对应的 logit 增大时 Loss 的变化率。

- 目标 token 的分量是 $p_y - 1 < 0$，它的 logit 增大时 Loss 减小；
- 其余分量是 $p_j > 0$，这些 logit 增大时 Loss 增大，变化率等于该 token 的概率；
- $p_y$ 接近 1 时，所有分量都接近 0，Loss 几乎不再随 logits 变化。

:::loss-logits
调整 logit，观察概率、Loss 和梯度
:::

:::recap
$\ell = -\ln p_y$，$\mathbf{p} = \mathrm{softmax}(\mathbf{z})$\
$\rightarrow$ $\dfrac{\partial \ell}{\partial \mathbf{z}} = \mathbf{p} - \mathbf{y}$
:::

## 向量对向量：Jacobian {#vector}

### Jacobian {#jacobian}

现在考虑向量到向量的函数。一个向量输入

$$
\mathbf{x}=[\,x_1\ \ x_2\ \ \cdots\ \ x_n\,]\in\mathbb{R}^n
$$

经过某个函数后，得到另一个向量

$$
\mathbf{z}=f(\mathbf{x})=[\,z_1\ \ z_2\ \ \cdots\ \ z_m\,]\in\mathbb{R}^m
$$

每个输出分量 $z_j$ 都可能依赖每个输入分量 $x_i$。因此，对这样一个向量到向量的函数，需要考虑一整组偏导数：

$$
\frac{\partial z_j}{\partial x_i},\qquad j=1,\ldots,m,\quad i=1,\ldots,n
$$

一共有 $m\times n$ 个。把它们按照“输出在行、输入在列”排成矩阵：

$$
J=\frac{\partial\mathbf{z}}{\partial\mathbf{x}}=\begin{bmatrix}\dfrac{\partial z_1}{\partial x_1}&\dfrac{\partial z_1}{\partial x_2}&\cdots&\dfrac{\partial z_1}{\partial x_n}\\[6pt]\dfrac{\partial z_2}{\partial x_1}&\dfrac{\partial z_2}{\partial x_2}&\cdots&\dfrac{\partial z_2}{\partial x_n}\\\vdots&\vdots&\ddots&\vdots\\\dfrac{\partial z_m}{\partial x_1}&\dfrac{\partial z_m}{\partial x_2}&\cdots&\dfrac{\partial z_m}{\partial x_n}\end{bmatrix}\in\mathbb{R}^{m\times n}
$$

这个矩阵称为 $\mathbf{z}$ 对 $\mathbf{x}$ 的 Jacobian。

Jacobian 不只是把很多偏导数装进一个矩阵。它更重要的作用，是描述函数在当前位置附近如何把输入的微小变化==线性地==传递到输出。

:::aside{title="行对应输出，列对应输入"}
本文统一采用这个约定：行对应输出，列对应输入。有些资料会采用转置后的排列方式，因此比较不同资料里的公式时，要先确认 Jacobian 的定义约定。
:::

**输入的变化怎样传到输出 - 观察每行**

Jacobian 的第 $j$ 行是

$$
\frac{\partial z_j}{\partial\mathbf{x}}=\Big[\,\frac{\partial z_j}{\partial x_1}\ \ \frac{\partial z_j}{\partial x_2}\ \ \cdots\ \ \frac{\partial z_j}{\partial x_n}\,\Big]
$$

它是标量 $z_j$ 对整个输入向量 $\mathbf{x}$ 的梯度。按[“梯度”](#gradient)一节的全微分，输入有微小变化 $d\mathbf{x}$ 时，$z_j$ 的一阶变化是这一行与 $d\mathbf{x}$ 的点积：

$$
dz_j = \frac{\partial z_j}{\partial \mathbf{x}} \cdot d\mathbf{x} = \sum_{i=1}^{n} \frac{\partial z_j}{\partial x_i}\,dx_i
$$

对每一行都这样计算，就得到全部 $m$ 个输出分量的变化。所以 Jacobian 也可以写成各个输出分量的梯度叠在一起：

$$
J=\begin{bmatrix}\dfrac{\partial z_1}{\partial\mathbf{x}}\\[4pt]\dfrac{\partial z_2}{\partial\mathbf{x}}\\\vdots\\\dfrac{\partial z_m}{\partial\mathbf{x}}\end{bmatrix}
$$

**Loss 的导数怎样传回输入 - 观察每列**

第 $i$ 列是

$$
\frac{\partial\mathbf{z}}{\partial x_i}=\begin{bmatrix}\dfrac{\partial z_1}{\partial x_i}\\[4pt]\dfrac{\partial z_2}{\partial x_i}\\\vdots\\\dfrac{\partial z_m}{\partial x_i}\end{bmatrix}
$$

它描述只改变一个输入 $x_i$ 时，所有输出分量分别如何变化。

反向传播用到的是列。设 $\mathbf{z}$ 后面还有运算，最终得到标量 Loss $L$，并且已经求出 $L$ 对输出的导数 $\dfrac{\partial L}{\partial \mathbf{z}}$（行向量）。$x_i$ 经过 $z_1, \ldots, z_m$ 影响 $L$，按[全导数链式法则](#chain-paths)：

$$
\frac{\partial L}{\partial x_i} = \sum_{j=1}^{m} \frac{\partial L}{\partial z_j}\,\frac{\partial z_j}{\partial x_i}
$$

右边是行向量 $\dfrac{\partial L}{\partial \mathbf{z}}$ 与 $J$ 的第 $i$ 列的点积。对所有 $i$ 合起来，就是一次行向量乘矩阵：

$$
\boxed{\frac{\partial L}{\partial \mathbf{x}} = \frac{\partial L}{\partial \mathbf{z}}\,J}
$$

结果与 $\mathbf{x}$ 同形状。==已知 Loss 对一个运算输出的导数，乘这个运算的 Jacobian，就得到 Loss 对它输入的导数==，后面每一节的反向计算都用这个式子。

**线性映射的 Jacobian**

以 $\mathbf{z}=\mathbf{x}W$ 为例，$W\in\mathbb{R}^{n\times m}$。展开一个输出分量，有 $z_j=\sum_{i=1}^{n}x_iW_{ij}$，因此

$$
J_{ji}=\frac{\partial z_j}{\partial x_i}=W_{ij},\qquad J=W^{T}\in\mathbb{R}^{m\times n}
$$

$W_{ij}$ 在 $W$ 的第 $i$ 行、第 $j$ 列，在 Jacobian 中则位于第 $j$ 行、第 $i$ 列，所以这里需要转置。

下图取 $n = 2$、$m = 3$。下方是 $3 \times 2$ 的 Jacobian $J$，它的第 $i$ 列是 $\mathbf{z}$ 对 $x_i$ 的偏导数，正好是 $W$ 的第 $i$ 行。

:::linear-jacobian
:::

:::recap
第 $j$ 行是 $z_j$ 的梯度，$dz_j = \dfrac{\partial z_j}{\partial \mathbf{x}} \cdot d\mathbf{x}$。按列看：$\dfrac{\partial L}{\partial \mathbf{x}} = \dfrac{\partial L}{\partial \mathbf{z}}\,J$。
:::

### 逐元素运算的 Jacobian {#elementwise}

神经网络中有很多运算是逐元素进行的。例如 sigmoid、SiLU、ReLU 等激活函数，都对输入向量的每个分量独立执行同一个标量函数。设

$$
\mathbf x=[\,x_1\ \ x_2\ \ \cdots\ \ x_n\,]\in\mathbb R^n
$$

对它逐元素应用标量函数 $\phi$：

$$
\mathbf y=\phi(\mathbf x) = [\,\phi(x_1)\ \ \phi(x_2)\ \ \cdots\ \ \phi(x_n)\,]
$$

也就是 $y_i=\phi(x_i)$。

现在求

$$
J= \frac{\partial\mathbf y}{\partial\mathbf x}
$$

按照前面的定义，Jacobian 的第 $j$ 行、第 $i$ 列为

$$
J_{ji} = \frac{\partial y_j}{\partial x_i}
$$

这里有一个很重要的结构：$y_j$ 只依赖 $x_j$，与其他输入 $x_i$ 无关。因此，

$$
\frac{\partial y_j}{\partial x_i} = \begin{cases}
\phi'(x_i), & i=j,\\
0, & i\ne j.
\end{cases}
$$

把这些偏导排成 Jacobian：

$$
\boxed{ \frac{\partial\mathbf y}{\partial\mathbf x} = \begin{bmatrix}
\phi'(x_1) & 0 & \cdots & 0\\
0 & \phi'(x_2) & \cdots & 0\\
\vdots & \vdots & \ddots & \vdots\\
0 & 0 & \cdots & \phi'(x_n)
\end{bmatrix} }
$$

也可以简写为

$$
\boxed{ \frac{\partial\mathbf y}{\partial\mathbf x} = \operatorname{diag}\bigl(\phi'(\mathbf x)\bigr) }
$$

其中 $\phi'(\mathbf x) = [\,\phi'(x_1)\ \ \cdots\ \ \phi'(x_n)\,]$ 表示同样对每个分量分别求导。

:::aside
逐元素运算的每个输出只依赖对应位置的输入，因此它的 Jacobian 是对角矩阵。
:::

几个常见例子：

- ReLU：$f'(x_j) = \mathbb{1}[x_j > 0]$，所以 $J = \mathrm{diag}\big(\mathbb{1}[\mathbf{x} > 0]\big)$；
- sigmoid：$\sigma'(x_j) = \sigma(x_j)\big(1 - \sigma(x_j)\big)$，所以 $J = \mathrm{diag}\big(\sigma(\mathbf{x}) \otimes (1 - \sigma(\mathbf{x}))\big)$；
- $\exp$：$J = \mathrm{diag}(e^{\mathbf{x}})$；
- $\tanh$：$J = \mathrm{diag}\big(1 - \tanh^2(\mathbf{x})\big)$。

**反向传播时意味着什么**

已知 $\dfrac{\partial L}{\partial\mathbf y}$ 时，按[“Jacobian”](#jacobian)一节的式子：

$$
\frac{\partial L}{\partial\mathbf x} = \frac{\partial L}{\partial\mathbf y}\operatorname{diag}\bigl(\phi'(\mathbf x)\bigr)
$$

行向量乘对角矩阵，结果的第 $i$ 个分量只有 $\dfrac{\partial L}{\partial y_i}\,\phi'(x_i)$ 一项，所以这是一次逐元素乘：

$$
\boxed{\frac{\partial L}{\partial\mathbf x} = \frac{\partial L}{\partial\mathbf y} \otimes \phi'(\mathbf x)}
$$

计算它需要 $n$ 次乘法。如果先构造 $n \times n$ 的对角矩阵再相乘，需要 $n^2$ 次，其中绝大部分是乘 0。

逐元素函数之所以简单，是因为不同分量之间没有耦合。下一节的 Softmax 正好相反：一个输入 logit 的变化会影响所有输出概率，因此它的 Jacobian 不再是对角矩阵。

:::recap

$$
J = \frac{\partial\mathbf y}{\partial\mathbf x} = \operatorname{diag}\bigl(\phi'(\mathbf x)\bigr)
$$
:::

### softmax 的 Jacobian {#softmax}

softmax 的输入是 $\mathbf{x} \in \mathbb{R}^{n}$，输出是 $\mathbf{p} \in \mathbb{R}^{n}$：

$$
p_j = \frac{e^{x_j}}{\sum_k e^{x_k}}
$$

分子 $e^{x_j}$ 只在 $i = j$ 时依赖 $x_i$，分母则对每个 $x_i$ 的导数都有贡献：

$$
\frac{\partial p_j}{\partial x_i} = \frac{\delta_{ij}\,e^{x_j}}{\sum_k e^{x_k}} - \frac{e^{x_j}\,e^{x_i}}{\big(\sum_k e^{x_k}\big)^2} = \delta_{ij}\,p_j - p_j p_i
$$

其中 $\delta_{ij}$ 是 Kronecker delta：$i = j$ 时为 1，$i \neq j$ 时为 0。写成矩阵：

$$
J = \dfrac{\partial \mathbf{p}}{\partial \mathbf{x}} = \mathrm{diag}(\mathbf{p}) - \mathbf{p}^{T}\mathbf{p}
$$

例如 $\mathbf{x} = [\,\ln 4\ \ \ln 3\ \ \ln 2\ \ 0\,]$，这时 $e^{x_j}$ 依次是 4、3、2、1，$\mathbf{p} = [\,0.4\ \ 0.3\ \ 0.2\ \ 0.1\,]$：

$$
J = \begin{bmatrix} 0.24 & -0.12 & -0.08 & -0.04 \\ -0.12 & 0.21 & -0.06 & -0.03 \\ -0.08 & -0.06 & 0.16 & -0.02 \\ -0.04 & -0.03 & -0.02 & 0.09 \end{bmatrix}
$$

对角线元素为正：==$x_i$ 增大时，$p_i$ 增大==。非对角线元素为负：==$x_i$ 增大时，其余的 $p_j$（$j \neq i$）减小。==

**反向传播时意味着什么** ^softmax-vjp

设后面还有一个标量 Loss $L$，已知上游梯度 $\mathbf{g} = \dfrac{\partial L}{\partial \mathbf{p}}$。沿 softmax 继续反向传播，要计算 $\dfrac{\partial L}{\partial \mathbf{x}} = \mathbf{g}\,J$。它的第 $i$ 个分量是 $\mathbf{g}$ 与 $J$ 的第 $i$ 列的点积，代入 $J_{ji} = \dfrac{\partial p_j}{\partial x_i} = \delta_{ij}\,p_j - p_j p_i$：

$$
\frac{\partial L}{\partial x_i} = \sum_{j} g_j\,(\delta_{ij}\,p_j - p_j p_i) = g_i\,p_i - p_i \sum_j g_j\,p_j = p_i\,(g_i - c),\qquad c = \mathbf{g} \cdot \mathbf{p}
$$

$c$ 是一个标量。写成向量形式：

$$
\boxed{\frac{\partial L}{\partial \mathbf{x}} = \mathbf{p} \otimes (\mathbf{g} - c),\qquad c = \mathbf{g} \cdot \mathbf{p}}
$$

其中 $\mathbf{g} - c$ 表示 $\mathbf{g}$ 的每个分量都减去同一个数 $c$。计算它只需要一次点积、一次减法和一次逐元素乘，共约 $3n$ 次运算；先构造 $n \times n$ 的 $J$ 再相乘，需要约 $n^2$ 次。

用上面的 $\mathbf{p} = [\,0.4\ \ 0.3\ \ 0.2\ \ 0.1\,]$，取 $\mathbf{g} = [\,1\ \ 0\ \ -1\ \ 2\,]$。这时 $c = 0.4 + 0 - 0.2 + 0.2 = 0.4$，$\mathbf{g} - c = [\,0.6\ \ -0.4\ \ -1.4\ \ 1.6\,]$，逐元素乘 $\mathbf{p}$：

$$
\frac{\partial L}{\partial \mathbf{x}} = [\,0.24\ \ -0.12\ \ -0.28\ \ 0.16\,]
$$

用 $\mathbf{g}$ 乘上面写出的 $4 \times 4$ 的 $J$，得到同样的结果。

结果的各分量之和为零：$\sum_i p_i\,(g_i - c) = c - c = 0$。这是因为把所有 $x_i$ 加上同一个数，softmax 的输出不变，$L$ 也不变，所以沿这个方向的变化率为零。

:::recap

$$
J = \frac{\partial\mathbf p}{\partial\mathbf x} = \mathrm{diag}(\mathbf{p}) - \mathbf{p}^{T}\mathbf{p}
$$

反向传播时不构造 $J$：$\dfrac{\partial L}{\partial \mathbf{x}} = \mathbf{p} \otimes (\mathbf{g} - \mathbf{g} \cdot \mathbf{p})$，$\mathbf{g} = \dfrac{\partial L}{\partial \mathbf{p}}$。
:::

### 向量链式法则 {#chain-vector}

两个运算嵌套时，先由 $\mathbf{x} \in \mathbb{R}^{n}$ 算出 $\mathbf{u} \in \mathbb{R}^{q}$，再由 $\mathbf{u}$ 算出 $\mathbf{z} \in \mathbb{R}^{m}$。设两个运算各自的 Jacobian $\dfrac{\partial \mathbf{u}}{\partial \mathbf{x}}$（$q \times n$）和 $\dfrac{\partial \mathbf{z}}{\partial \mathbf{u}}$（$m \times q$）已经算出，我们要计算整体的 Jacobian $\dfrac{\partial \mathbf{z}}{\partial \mathbf{x}}$，即 $m \times n$ 个偏导数 $\dfrac{\partial z_j}{\partial x_i}$。

$x_i$ 经由 $u_1, u_2, \ldots, u_q$ 影响 $z_j$，属于[多条路径](#chain-paths)的情形，需要使用全导数：

$$
\frac{\partial z_j}{\partial x_i} = \sum_{k=1}^{q} \frac{\partial z_j}{\partial u_k}\,\frac{\partial u_k}{\partial x_i}
$$

右边对 $k$ 求和的形式正是矩阵乘法的定义：第一个矩阵的第 $j$ 行与第二个矩阵的第 $i$ 列的点积。所以整体的 Jacobian 是两个 Jacobian 的乘积：

$$
\boxed{
  \frac{\partial \mathbf{z}}{\partial \mathbf{x}} = \frac{\partial \mathbf{z}}{\partial \mathbf{u}}\,\frac{\partial \mathbf{u}}{\partial \mathbf{x}}
}
$$

例如先做矩阵乘法 $\mathbf{u} = \mathbf{x}W$，再逐元素平方 $z_j = u_j^2$。$W$ 取[“Jacobian”](#jacobian)一节图中的矩阵，$\mathbf{x} = [\,1\ \ -0.5\,]$，这时 $\mathbf{u} = [\,0.75\ \ -2.5\ \ 1\,]$。两个 Jacobian 分别是 $W^{T}$ 和 $\mathrm{diag}(2\mathbf{u})$：

$$
\frac{\partial \mathbf{z}}{\partial \mathbf{x}} = \mathrm{diag}(2\mathbf{u})\,W^{T} = \begin{bmatrix} 1.5 & 0 & 0 \\ 0 & -5 & 0 \\ 0 & 0 & 2 \end{bmatrix}\begin{bmatrix} 1 & 0.5 \\ -2 & 1 \\ 0.5 & -1 \end{bmatrix} = \begin{bmatrix} 1.5 & 0.75 \\ 10 & -5 \\ 1 & -2 \end{bmatrix}
$$

嵌套更多层时，把各层的 Jacobian 按从外到内的顺序相乘。**外**意味着更靠近输出，也就是和前向的计算顺序相反。例如前向是先 $\mathbf{x} \to \mathbf{u}$ 再 $\mathbf{u} \to \mathbf{z}$，那么计算 Jacobian 时的顺序就是 $\dfrac{\partial \mathbf{z}}{\partial \mathbf{u}}\,\dfrac{\partial \mathbf{u}}{\partial \mathbf{x}}$。

:::recap

$$
\dfrac{\partial \mathbf{z}}{\partial \mathbf{x}} = \dfrac{\partial \mathbf{z}}{\partial \mathbf{u}}\,\dfrac{\partial \mathbf{u}}{\partial \mathbf{x}}
$$
:::

### 例：分两步求 Loss 对 logits 的梯度 {#softmax-ce}

[“例：Loss 对 logits 的梯度”](#loss-grad)把 softmax 和 cross-entropy 合在一起直接求导，效率高且数值更稳定。

这里再给出一种分两步计算的方法，更方便理解概念：先求 $\ell$ 对 softmax 输出 $\mathbf{p}$ 的导数，再求 $\mathbf{p}$ 对 logits $\mathbf{z}$ 的导数。

列出前向公式以供回顾：

$$
\begin{aligned}
\ell &= -\ln p_y\\
p_j &= \frac{e^{z_j}}{\sum_k e^{z_k}},\quad j \in \{1,2,\ldots,V\}
\end{aligned}
$$

同样设 one-hot 向量 $\mathbf{y}$：第 $y$ 个分量是 1，其余分量是 0。则 $\dfrac{\partial \ell}{\partial \mathbf{p}}$ 和 $\dfrac{\partial \mathbf{p}}{\partial \mathbf{z}}$ 分别为：

$$
\begin{aligned}
\frac{\partial \ell}{\partial \mathbf{p}} &= -\dfrac{1}{p_y} \mathbf{y}\\
\frac{\partial \mathbf{p}}{\partial \mathbf{z}} &= \mathrm{diag}(\mathbf{p}) - \mathbf{p}^{T}\mathbf{p}
\end{aligned}
$$

根据链式法则

$$
\begin{aligned}
\frac{\partial \ell}{\partial \mathbf{z}}
&= \frac{\partial \ell}{\partial \mathbf{p}}\,\frac{\partial \mathbf{p}}{\partial \mathbf{z}}\\
&= -\dfrac{1}{p_y} \mathbf{y} \mathrm{diag}(\mathbf{p}) + \dfrac{1}{p_y} \mathbf{y} \mathbf{p}^{T}\mathbf{p}\\
&= -\dfrac{1}{p_y} (\mathbf{y} \mathrm{diag}(\mathbf{p})) + \dfrac{1}{p_y} (\mathbf{y} \mathbf{p}^{T})\mathbf{p}\\
&= \boxed{\mathbf{p} - \mathbf{y}}
\end{aligned}
$$

其中

$$
\mathbf y\operatorname{diag}(\mathbf p)=p_y\mathbf y,
\qquad
\mathbf y\mathbf p^{T}=p_y
$$

与直接求导的结果相同。

实现中 softmax 和 cross-entropy 通常合成一个运算[^cross-entropy]，原因有两个：

[^cross-entropy]: PyTorch 的 `F.cross_entropy`。

- 避免数值问题：分两步算时，反向会出现 $\dfrac{1}{p_y}$。$p_y$ 一旦下溢为 0，前向的 $\log$ 和反向的 $\dfrac{1}{p_y}$ 都会出问题。合成一个运算后，前向用 log-sum-exp，反向直接得到 $\mathbf{p}-\mathbf{y}$，两边都不会碰到这个除法。
- 反向传播更简单：两者合起来的梯度就是 $\mathbf{p} - \mathbf{y}$，直接一步求出 $\dfrac{\partial \ell}{\partial \mathbf{z}}$，无需先求 $\dfrac{\partial \ell}{\partial \mathbf{p}}$ 再求 $\dfrac{\partial \ell}{\partial \mathbf{z}}$。

:::recap

$$
\frac{\partial \ell}{\partial \mathbf{z}} = \frac{\partial \ell}{\partial \mathbf{p}}\,\frac{\partial \mathbf{p}}{\partial \mathbf{z}} = \mathbf{p} - \mathbf{y}
$$
:::

### 例：Loss 对 lm head 输入的梯度 {#head-jac}

:::lm-head{from=x to=z brace=true}
:::

考虑单个 token 位置。lm head 的输入是行向量 $\mathbf{x}\in\mathbb{R}^{d}$，权重记作 $W=W_{out}\in\mathbb{R}^{d\times V}$，输出是词表中 $V$ 个 token 的 logits：

$$
\mathbf{z}=\mathbf{x}W\in\mathbb{R}^{V},\qquad z_j=\sum_{k=1}^{d}x_kW_{kj}
$$

上一节已经求出这个位置的 Loss $\ell$ 对 logits 的梯度 $\dfrac{\partial\ell}{\partial\mathbf{z}}=\mathbf{p}-\mathbf{y}$。现在继续求 $\dfrac{\partial\ell}{\partial\mathbf{x}}$，求导时把权重 $W$ 视为常量。

**先求一个输入分量的梯度**

在 $z_j$ 的展开式中，只有 $x_iW_{ij}$ 这一项包含 $x_i$，因此 $\dfrac{\partial z_j}{\partial x_i}=W_{ij}$。$x_i$ 通过全部 $V$ 个 logits $z_1,z_2,\cdots,z_V$ 影响 Loss，按照全导数链式法则，要把经过各个 $z_j$ 的贡献相加：

$$
\begin{aligned}
\frac{\partial\ell}{\partial x_i}
&=\sum_{j=1}^{V}\frac{\partial\ell}{\partial z_j}\,\frac{\partial z_j}{\partial x_i}\\
&=\boxed{\sum_{j=1}^{V}(p_j-y_j)\,W_{ij}}
\end{aligned}
$$

:::backprop-paths{paths=head-input}
:::

图中经过 $z_j$ 的贡献是 $(p_j-y_j)W_{ij}$，对全部 $V$ 个 logits 求和，就得到 Loss 对 $x_i$ 的偏导数。

**把所有输入分量的梯度写成矩阵形式**

按 Jacobian“输出在行、输入在列”的约定，$J_{ji}=\dfrac{\partial z_j}{\partial x_i}=W_{ij}$，所以 $J=W^{T} \in \mathbb{R}^{V\times d}$。上式的求和正好是行向量 $\mathbf{p}-\mathbf{y}$ 与 $J$ 的第 $i$ 列相乘。把全部 $d$ 个输入分量的结果排成一行，就得到：

$$
\boxed{\frac{\partial\ell}{\partial\mathbf{x}}
=\frac{\partial\ell}{\partial\mathbf{z}}\,\frac{\partial\mathbf{z}}{\partial\mathbf{x}}}
$$

代入得

$$
\boxed{\frac{\partial\ell}{\partial\mathbf{x}}=(\mathbf{p}-\mathbf{y})\,W^{T}}
$$

:::recap

$$
\dfrac{\partial \ell}{\partial \mathbf{x}} = (\mathbf{p} - \mathbf{y})\,W^{T}
$$
:::

### 例：SwiGLU FFN 的 Jacobian {#ffn-jac}

SwiGLU FFN 在一个位置上的输入是 $\mathbf{x} \in \mathbb{R}^{d}$，前向计算是：

$$
\begin{aligned}
\mathbf{a} &= \mathbf{x}W_{gate}, & \mathbf{b} &= \mathbf{x}W_{up}, \\
\mathbf{u} &= \mathrm{Swish}(\mathbf{a}) \otimes \mathbf{b}, & \mathbf{h} &= \mathbf{u}W_{down}
\end{aligned}
$$

其中 $\mathbf{a}, \mathbf{b}, \mathbf{u} \in \mathbb{R}^{d_{ff}}$，$\mathbf{h} \in \mathbb{R}^{d}$。

下图描述了 SwiGLU 前向、反向计算梯度的过程，其中用到的 Jacobian 都来自本章讲过的运算：

- 矩阵乘法 $\mathbf{z} = \mathbf{x}W$ 的 Jacobian 是 $W^{T}$，三次矩阵乘法分别得到 $W_{gate}^{T}$、$W_{up}^{T}$ 和 $W_{down}^{T}$；
- Swish 是逐元素函数，Jacobian 是 $\mathrm{diag}\big(\mathrm{Swish}'(\mathbf{a})\big)$，$\mathrm{Swish}'$ 见[“例：Sigmoid 与 Swish 的导数”](#swish)；
- 逐元素乘 $\mathrm{Swish}(\mathbf{a}) \otimes \mathbf{b}$ 对其中一个输入的 Jacobian，是由另一个输入构成的对角矩阵：对 $\mathrm{Swish}(\mathbf{a})$ 是 $\mathrm{diag}(\mathbf{b})$，对 $\mathbf{b}$ 是 $\mathrm{diag}\big(\mathrm{Swish}(\mathbf{a})\big)$。

:::swiglu-jacobian
:::

**一条路径上的 Jacobian 相乘**。gate 路径 $\mathbf{x} \to \mathbf{a} \to \mathrm{Swish}(\mathbf{a}) \to \mathbf{u} \to \mathbf{h}$ 是四个运算的嵌套。按[向量链式法则](#chain-vector)，各层的 Jacobian 按从外到内的顺序相乘。从外到内就是从 $\mathbf{h}$ 出发沿反向箭头走回 $\mathbf{x}$ 的顺序，所以按经过的顺序从左到右写下箭头上的 Jacobian 即可：

$$
\underbrace{W_{down}^{T}}_{d \times d_{ff}}\,\underbrace{\mathrm{diag}(\mathbf{b})}_{d_{ff} \times d_{ff}}\,\underbrace{\mathrm{diag}\big(\mathrm{Swish}'(\mathbf{a})\big)}_{d_{ff} \times d_{ff}}\,\underbrace{W_{gate}^{T}}_{d_{ff} \times d}
$$

相邻两个因子中，左边的列数等于右边的行数，乘积是 $d \times d$，与 $\dfrac{\partial \mathbf{h}}{\partial \mathbf{x}}$ 的形状一致。up 路径同理，乘积是 $W_{down}^{T}\,\mathrm{diag}\big(\mathrm{Swish}(\mathbf{a})\big)\,W_{up}^{T}$。

**两条路径的结果相加**。$\mathbf{x}$ 同时经过两条路径影响 $\mathbf{h}$。对每个偏导数 $\dfrac{\partial h_j}{\partial x_i}$，按[全导数链式法则](#chain-paths)把两条路径的贡献相加，写成矩阵就是两条路径的乘积之和。两条路径从 $\mathbf{h}$ 到 $\mathbf{u}$ 的一段相同，可以把公共因子 $W_{down}^{T}$ 提到括号外：

$$
\frac{\partial \mathbf{h}}{\partial \mathbf{x}} = 
\underbrace{W_{down}^{T}}_{d \times d_{ff}}\,\Big(\underbrace{\mathrm{diag}(\mathbf{b})\,\mathrm{diag}\big(\mathrm{Swish}'(\mathbf{a})\big)\,W_{gate}^{T}}_{\text{gate},\ d_{ff} \times d}
+ \underbrace{\mathrm{diag}\big(\mathrm{Swish}(\mathbf{a})\big)\,W_{up}^{T}}_{\text{up},\ d_{ff} \times d}\Big)
$$

:::recap
由三次矩阵乘法的 $W^{T}$、Swish 的 $\mathrm{diag}\big(\mathrm{Swish}'(\mathbf{a})\big)$ 和逐元素乘的 $\mathrm{diag}$ 相乘得到。$\mathbf{x}$ 经过 gate 和 up 两条路径，两项相加。
:::

## 反向传播的计算顺序 {#vjp}

[“例：SwiGLU FFN 的 Jacobian”](#ffn-jac)把 $\dfrac{\partial \mathbf{h}}{\partial \mathbf{x}} \in \mathbb{R}^{d \times d}$ 写成了几个矩阵的乘积。训练时真正需要的不是这个 Jacobian，而是 $\dfrac{\partial \ell}{\partial \mathbf{x}} \in \mathbb{R}^d$。

这就给了我们一个优化的方向：==为了得到这个行向量，是否一定要先算出整个 Jacobian==？

### 两种乘法顺序 {#vjp-order}

设已经知道 Loss 对 FFN 输出的导数 $\mathbf{g} = \dfrac{\partial L}{\partial \mathbf{h}} \in \mathbb{R}^{1 \times d}$，它是一个行向量。按[“Jacobian”](#jacobian)一节的式子，$\dfrac{\partial L}{\partial \mathbf{x}} = \mathbf{g}\,\dfrac{\partial \mathbf{h}}{\partial \mathbf{x}}$。

$$
\begin{aligned}
\frac{\partial L}{\partial \mathbf{x}}
&= \underbrace{\dfrac{\partial L}{\partial \mathbf{h}}}_{1 \times d} \underbrace{\dfrac{\partial \mathbf{h}}{\partial \mathbf{x}}}_{d \times d}\\
&= \underbrace{\mathbf{g}}_{1 \times d}
\underbrace{W_{down}^{T}}_{d \times d_{ff}}\,\Big(\underbrace{\mathrm{diag}(\mathbf{b})}_{d_{ff} \times d_{ff}}\,\underbrace{\mathrm{diag}\big(\mathrm{Swish}'(\mathbf{a})\big)}_{d_{ff} \times d_{ff}}\,\underbrace{W_{gate}^{T}}_{d_{ff} \times d}
+ \underbrace{\mathrm{diag}\big(\mathrm{Swish}(\mathbf{a})\big)}_{d_{ff} \times d_{ff}}\,\underbrace{W_{up}^{T}}_{d_{ff} \times d}\Big)
\end{aligned}
$$

矩阵乘法满足结合律，可以从右往左算，也可以从左往右算，我们都尝试一下。[^flop]

[^flop]: 以下不计 $\operatorname{Swish}(\mathbf a)$ 及其导数的开销，且认为一次乘法或加法均为一个 FLOP。

**从右往左**

先从右往左分别计算 gate 和 up 两条路径，再合并得到完整 Jacobian，然后计算最终的 $\frac{\partial L}{\partial \mathbf{x}}$。

==gate 路径==：

$$
J_{\mathrm{gate}}
=
W_{\mathrm{down}}^\top
\operatorname{diag}(\mathbf b)
\operatorname{diag}\!\bigl(\operatorname{Swish}'(\mathbf a)\bigr)
W_{\mathrm{gate}}^\top.
$$

先计算最右边的 $\operatorname{diag}(\operatorname{Swish}'(\mathbf a))W_{\mathrm{gate}}^\top$，即对 $W_{\mathrm{gate}}^\top$ 的各行进行缩放，需要 $dd_{\mathrm{ff}}$ 次乘法。再左乘 $\operatorname{diag}(\mathbf b)$，对所得矩阵的各行再缩放一次，需要 $dd_{\mathrm{ff}}$ 次乘法。所得矩阵仍为 $d_{\mathrm{ff}}\times d$ 的稠密矩阵。

==up 路径==：

$$
J_{\mathrm{up}}
=
W_{\mathrm{down}}^\top
\operatorname{diag}\!\bigl(\operatorname{Swish}(\mathbf a)\bigr)
W_{\mathrm{up}}^\top.
$$

先计算右边的 $\operatorname{diag}(\operatorname{Swish}(\mathbf a))W_{\mathrm{up}}^\top$，即对 $W_{\mathrm{up}}^\top$ 的各行进行缩放，需要 $dd_{\mathrm{ff}}$ 次乘法，所得矩阵同样为 $d_{\mathrm{ff}}\times d$。

两条路径共用左侧的 $W_{\mathrm{down}}^\top$，因此可以先将上述两个结果相加，再统一左乘它：

$$
J=
W_{\mathrm{down}}^\top
\left[
\operatorname{diag}(\mathbf b)
\operatorname{diag}\!\bigl(\operatorname{Swish}'(\mathbf a)\bigr)
W_{\mathrm{gate}}^\top
+
\operatorname{diag}\!\bigl(\operatorname{Swish}(\mathbf a)\bigr)
W_{\mathrm{up}}^\top
\right].
$$

这最后一步是两个稠密矩阵相乘，需要 $d^2d_{\mathrm{ff}}$ 次乘法和 $d^2(d_{\mathrm{ff}}-1)$ 次加法，得到 $d\times d$ 的完整 Jacobian。

最后再计算 $\mathbf gJ$，需要 $d^2$ 次乘法和 $d(d-1)$ 次加法，得到 Loss 对输入的导数。

总计算量

- 乘法：$d^2d_{\mathrm{ff}}+3dd_{\mathrm{ff}}+d^2$
- 加法：$d^2d_{\mathrm{ff}}+dd_{\mathrm{ff}}-d$
- 总计：$2d^2d_{\mathrm{ff}}+4dd_{\mathrm{ff}}+d^2-d$

:::aside
稠密矩阵乘对角矩阵（或是对角矩阵乘稠密矩阵），虽然是矩阵乘，但是由于对角矩阵的特性，可以优化成对稠密矩阵各列（行）的缩放
:::

**从左往右**

从左往右计算时，先让上游导数 $\mathbf g$ 乘进来，每一步的结果都保持为行向量，无需构造完整 Jacobian。

首先计算两条路径共用的部分：

$$
\mathbf r=\mathbf gW_{\mathrm{down}}^\top.
$$

这是 $1\times d$ 的行向量乘 $d\times d_{\mathrm{ff}}$ 的矩阵，需要 $dd_{\mathrm{ff}}$ 次乘法和 $d_{\mathrm{ff}}(d-1)$ 次加法。

==gate 路径==：

$$
\mathbf q_{\mathrm{gate}}
=
\bigl[\mathbf r\odot\mathbf b
\odot\operatorname{Swish}'(\mathbf a)\bigr]
W_{\mathrm{gate}}^\top.
$$

先做两次逐元素乘法，需要 $2d_{\mathrm{ff}}$ 次乘法；再乘 $W_{\mathrm{gate}}^\top$，需要 $dd_{\mathrm{ff}}$ 次乘法和 $d(d_{\mathrm{ff}}-1)$ 次加法。

==up 路径==：

$$
\mathbf q_{\mathrm{up}}
=
\bigl[\mathbf r\odot\operatorname{Swish}(\mathbf a)\bigr]
W_{\mathrm{up}}^\top.
$$

先做一次逐元素乘法，需要 $d_{\mathrm{ff}}$ 次乘法；再乘 $W_{\mathrm{up}}^\top$，需要 $dd_{\mathrm{ff}}$ 次乘法和 $d(d_{\mathrm{ff}}-1)$ 次加法。

最后将两条路径的结果相加：

$$
\frac{\partial L}{\partial\mathbf x}
=\mathbf q_{\mathrm{gate}}+\mathbf q_{\mathrm{up}},
$$

需要 $d$ 次加法。

总计算量为：

- 乘法：$3dd_{\mathrm{ff}}+3d_{\mathrm{ff}}$
- 加法：$3dd_{\mathrm{ff}}-d_{\mathrm{ff}}-d$
- 总计：$6dd_{\mathrm{ff}}+2d_{\mathrm{ff}}-d$

以 Qwen3-8B 的 FFN 为例，$d = 4096$，$d_{ff} = 12288$：

| 顺序 | 主要计算量 | 数量级 |
|---|---|---|
| 从右往左 | $2d^2d_{\mathrm{ff}}$ | $4.1 \times 10^{11}$ |
| 从左往右 | $6dd_{\mathrm{ff}}$ | $3.0 \times 10^{8}$ |

两者相差==一千多倍==。只要不傻，一定是选择从左往右，不计算完整的 Jacobian。

:::recap
$\mathbf{g}\,J_1J_2\cdots$ 从左往右算，每一步都是行向量乘矩阵。
:::

### vector-Jacobian product {#vjp-def}

从左往右的每一步都是同一种运算：已知 Loss 对某个运算输出的导数（行向量），乘这个运算的 Jacobian，得到 Loss 对这个运算输入的导数（仍是行向量）。设运算的输入是 $\mathbf{x}$，输出是 $\mathbf{z}$，Jacobian 是 $J = \dfrac{\partial \mathbf{z}}{\partial \mathbf{x}}$：

$$
\boxed{\frac{\partial L}{\partial \mathbf{x}} = \frac{\partial L}{\partial \mathbf{z}}\,J}
$$

这个运算称为 vector-Jacobian product（VJP）。==反向传播就是从 $\dfrac{\partial L}{\partial L} = 1$ 开始，按前向的相反顺序，对每个运算做一次 VJP==。[^reverse-mode]

[^reverse-mode]: 在自动微分的文献中，这种计算顺序称为 reverse mode[@griewank2008]。

VJP 不需要先构造 $J$。本文出现过的几种运算：

- **逐元素函数** $\mathbf{y} = \phi(\mathbf{x})$：$J = \mathrm{diag}\big(\phi'(\mathbf{x})\big)$，VJP 是逐元素乘 $\dfrac{\partial L}{\partial \mathbf{y}} \otimes \phi'(\mathbf{x})$，见[“逐元素运算的 Jacobian”](#elementwise)。
- **逐元素乘** $\mathbf{u} = \mathbf{a} \otimes \mathbf{b}$：对 $\mathbf{a}$ 的 Jacobian 是 $\mathrm{diag}(\mathbf{b})$，VJP 是 $\dfrac{\partial L}{\partial \mathbf{u}} \otimes \mathbf{b}$；对 $\mathbf{b}$ 同理。
- **矩阵乘法** $\mathbf{z} = \mathbf{x}W$：$J = W^{T}$，VJP 是 $\dfrac{\partial L}{\partial \mathbf{z}}\,W^{T}$，直接用 $W$ 做一次矩阵乘法。
- **softmax**：$J$ 不是对角矩阵，VJP 是 $\mathbf{p} \otimes (\mathbf{g} - \mathbf{g} \cdot \mathbf{p})$，只需要一次点积、一次减法和一次逐元素乘，见[“softmax 的 Jacobian”](#softmax-vjp)。

每一种的计算量都与前向同一量级。

从左往右计算时每一步都是行向量，是因为最左边的因子是 $\dfrac{\partial L}{\partial \mathbf{h}}$，而 ==$L$ 是标量==。如果需要的是 $\dfrac{\partial \mathbf{h}}{\partial \mathbf{x}}$ 本身，就只能把矩阵乘出来。

:::recap
$\dfrac{\partial L}{\partial \mathbf{x}} = \dfrac{\partial L}{\partial \mathbf{z}}\,J$。反向传播从 $\dfrac{\partial L}{\partial L} = 1$ 开始，按前向的相反顺序对每个运算做一次 VJP，不构造 $J$。$L$ 是标量，每一步得到的都是 $L$ 对某个量的导数，与这个量同形状。
:::

## 标量对矩阵 {#matrix}

### 求 lm head 的权重的梯度 {#head-weight toc="lm head 的权重"}

:::lm-head{from=head to=head brace=true}
:::

[“例：Loss 对 lm head 输入的梯度”](#head-jac)求出了 $\dfrac{\partial \ell}{\partial \mathbf{x}}$，那时把权重 $W$ 当作常量。但训练要更新的是权重：梯度下降每一步把 $W$ 换成 $W - \eta\,\dfrac{\partial \ell}{\partial W}$，$\eta$ 是学习率。所以还需要 Loss 对 $W$ 的导数。

$W$ 的每个元素 $W_{ij}$ 都是 $\ell$ 的一个输入。对每个元素求偏导数，再按 $W$ 中的位置排好，就是 $\ell$ 对 $W$ 的导数：

$$
\frac{\partial \ell}{\partial W} = \begin{bmatrix} \dfrac{\partial \ell}{\partial W_{11}} & \cdots & \dfrac{\partial \ell}{\partial W_{1V}}\\ \vdots & & \vdots\\ \dfrac{\partial \ell}{\partial W_{d1}} & \cdots & \dfrac{\partial \ell}{\partial W_{dV}} \end{bmatrix} \in \mathbb{R}^{d \times V}
$$

所以==标量对矩阵的导数与这个矩阵同形状==。PyTorch 里 `W.grad` 的形状与 `W` 相同，存的就是这个矩阵。

**$W_{ij}$ 只经过一条路径影响 Loss**

前向公式仍是 $z_j = \sum_{k=1}^{d} x_k W_{kj}$。[“偏导数”](#partial)一节已经算过：

$$
\frac{\partial z_j}{\partial W_{ij}} = x_i
$$

$W$ 的第 $j$ 列只用来计算 $z_j$，其余 logits 都不含 $W_{ij}$，按[单变量链式法则](#chain-scalar)直接相乘：

$$
\frac{\partial \ell}{\partial W_{ij}} = \frac{\partial \ell}{\partial z_j}\,\frac{\partial z_j}{\partial W_{ij}} = \boxed{x_i\,(p_j - y_j)}
$$

:::backprop-paths{paths=head-weight}
:::

图中每条连线是 $W$ 的一个元素。$W_{ij}$ 是 $x_i$ 到 $z_j$ 的那条边，Loss 只经过 $z_j$ 传到它，乘上这条边另一端的输入 $x_i$，就是它的偏导数。

**排成矩阵**

第 $i$ 行第 $j$ 列是 $x_i$ 乘 $p_j - y_j$。这正是 $d \times 1$ 的列向量 $\mathbf{x}^{T}$ 乘 $1 \times V$ 的行向量 $\mathbf{p} - \mathbf{y}$，称为两个向量的外积（outer product）：

$$
\boxed{\frac{\partial \ell}{\partial W} = \mathbf{x}^{T}\,(\mathbf{p} - \mathbf{y})}
$$

下面尝试分析为什么==一步更新使模型对同一个输入给目标 token 更高的分数==。

对单个样本做一步梯度下降：

$$
W'=W-\eta\mathbf x^\top(\mathbf p-\mathbf y).
$$

固定输入 $\mathbf x$，只更新 LM head 的权重，新的 logits 为：

$$
\begin{aligned}
\mathbf z'
&=\mathbf xW'\\
&=\mathbf xW-\eta\mathbf x\mathbf x^\top(\mathbf p-\mathbf y)\\
&=\mathbf z+\eta\|\mathbf x\|^2(\mathbf y-\mathbf p).
\end{aligned}
$$

因此，每个 token 的分数变化是：

$$
\boxed{\Delta z_j=\eta\|\mathbf x\|^2(y_j-p_j)}.
$$

对于目标 token $t$，$y_t=1$，所以：

$$
\Delta z_t=\eta\|\mathbf x\|^2(1-p_t)\ge0.
$$

对于其他 token，$y_j=0$，所以：

$$
\Delta z_j=-\eta\|\mathbf x\|^2p_j\le0.
$$

也就是说，这一步更新会提高目标 token 的分数，同时降低其他 token 的分数；哪个非目标 token 原本的概率越高，它的分数就降得越多。 当 $\mathbf x\ne0$、学习率 $\eta>0$ 时，目标 token 的 softmax 概率随之提高，交叉熵损失下降。

这里描述的是单个样本、固定输入、普通梯度下降的效果；多个样本的梯度合并后，不保证每个样本的目标分数都同时提高。

**为什么不需要三维数组**

按[向量链式法则](#chain-vector)的写法，$\dfrac{\partial \ell}{\partial \mathbf{W}}$ 似乎要经过 $\dfrac{\partial \mathbf{z}}{\partial \mathbf{W}}$。这是向量对矩阵的导数，共有 $V \times d \times V$ 个元素。写出来如下：

$$
\frac{\partial z_k}{\partial W_{ij}}
=
\begin{cases}
x_i,&k=j,\\
0,&k\ne j.
\end{cases}
$$

因此

$$
\begin{aligned}
\frac{\partial \ell}{\partial W_{ij}}
&=\frac{\partial \ell}{\partial \mathbf{z}} \frac{\partial \mathbf{z}}{\partial W_{ij}}\\
&=\sum_{k}\frac{\partial \ell}{\partial z_k}\frac{\partial z_k}{\partial W_{ij}}\\
&=\frac{\partial \ell}{\partial z_j}\frac{\partial z_j}{\partial W_{ij}},\quad\text{其余项均为 0}
\end{aligned}
$$

所以==计算 $\dfrac{\partial \ell}{\partial W}$ 不需要写出这个三维数组==。

这个数组如果真的写出来，规模很大。按 Qwen3-8 的尺寸（$d = 4096$，$V = 151936$），它在一个位置上就有 $V \times d \times V \approx 9.4 \times 10^{13}$ 个元素，用 BF16 存储约 188 TB；而 $\dfrac{\partial \ell}{\partial W}$ 只有 $d \times V \approx 6.2 \times 10^{8}$ 个元素，用 BF16 存储约 1.2 GB，与 $W$ 相同。这和上一章的结论一致：反向传播只计算 Loss 对各个量的导数。

到这里只看了一个位置。训练时一个序列的 $T$ 个位置同时计算，同一个 $W$ 被 $T$ 个位置共用，下一节处理这种情况。

:::recap
标量对矩阵的导数与矩阵同形状。$W_{ij}$ 只经过 $z_j$ 一条路径，$\dfrac{\partial \ell}{\partial W_{ij}} = x_i(p_j - y_j)$，合起来是外积 $\dfrac{\partial \ell}{\partial W} = \mathbf{x}^{T}(\mathbf{p} - \mathbf{y})$。计算时不需要三维的 $\dfrac{\partial \mathbf{z}}{\partial W}$。
:::

### $T$ 个位置一起计算 {#sequence}

训练时，一个序列的 $T$ 个位置同时经过 lm head。把各位置的输入按行堆成 $T \times d$ 的矩阵 $X$，第 $t$ 行是位置 $t$ 的输入 $\mathbf{x}_t$。$Z = XW$ 是 $T \times V$ 的矩阵，第 $t$ 行是 $\mathbf{z}_t = \mathbf{x}_tW$。

每个位置有自己的 cross-entropy $\ell_t$。训练用的 Loss 是它们的平均：

$$
L = \frac{1}{T}\sum_{t=1}^{T} \ell_t
$$

==从这里开始，$L$ 表示整个序列的 Loss，$\ell_t$ 表示位置 $t$ 的 Loss==。$L$ 对每个 $\ell_t$ 的偏导数是 $\dfrac{1}{T}$，$\mathbf{z}_t$ 只通过 $\ell_t$ 影响 $L$，所以

$$
\frac{\partial L}{\partial \mathbf{z}_t} = \frac{1}{T}\,(\mathbf{p}_t - \mathbf{y}_t)
$$

把这 $T$ 个行向量按位置堆成 $T \times V$ 的矩阵，记作 $G$：

$$
G = \frac{\partial L}{\partial Z} = \frac{1}{T}\,(P - Y)
$$

$P$ 和 $Y$ 分别由 $\mathbf{p}_t$ 和 $\mathbf{y}_t$ 按行堆成。$G$ 与 $Z$ 同形状，第 $t$ 行第 $j$ 列是 $\dfrac{\partial L}{\partial Z_{tj}}$。后文的 $G$ 都表示 Loss 对某个运算输出的导数。

**对输入的导数：逐行计算**

$\mathbf{x}_t$ 只用来计算 $\mathbf{z}_t$，其他位置的输出都不含它，所以 $L$ 对 $\mathbf{x}_t$ 的导数只经过 $\mathbf{z}_t$。按[“例：Loss 对 lm head 输入的梯度”](#head-jac)的结果，每一行单独计算：

$$
\frac{\partial L}{\partial \mathbf{x}_t} = \frac{\partial L}{\partial \mathbf{z}_t}\,W^{T}
$$

$T$ 行合起来：

$$
\boxed{\frac{\partial L}{\partial X} = G\,W^{T}}
$$

**对权重的导数：各位置相加**

$W$ 被 $T$ 个位置共用。$W_{ij}$ 经过 $Z_{1j}, Z_{2j}, \ldots, Z_{Tj}$ 共 $T$ 条路径影响 $L$，每个位置一条。按[全导数链式法则](#chain-paths)，把 $T$ 条路径的贡献相加，每个位置的贡献都是上一节的外积：

$$
\frac{\partial L}{\partial W} = \sum_{t=1}^{T} \mathbf{x}_t^{T}\,\frac{\partial L}{\partial \mathbf{z}_t} = \boxed{X^{T}G}
$$

右边的等号来自矩阵乘法的定义：$(X^{T}G)_{ij} = \sum_t X_{ti}\,G_{tj}$，==矩阵乘法中对 $t$ 的求和就是对位置的求和==。下图把三个位置的外积分别画出来，它们的和就是 $X^{T}G$。

:::outer-product
:::

:::recap
$L = \frac{1}{T}\sum_t \ell_t$，$G = \dfrac{\partial L}{\partial Z} = \frac{1}{T}(P - Y)$。对输入逐行计算，$\dfrac{\partial L}{\partial X} = GW^{T}$；权重被各位置共用，贡献相加，$\dfrac{\partial L}{\partial W} = X^{T}G$。
:::

## 速查表 {#cheatsheet}

### 求导规则汇总 {#rules-summary}

$\mathbf{g}$ 和 $G$ 是 Loss 对运算输出的导数，与输出同形状。一个位置时写成行向量，$T$ 个位置堆成矩阵时把 $\mathbf{x}$、$\mathbf{g}$ 换成 $X$、$G$。

| 运算 | 前向 | Jacobian | Loss 对输入的导数 | Loss 对权重的导数 |
|---|---|---|---|---|
| 逐元素函数 | $\mathbf{y} = \phi(\mathbf{x})$ | $\mathrm{diag}\big(\phi'(\mathbf{x})\big)$ | $\mathbf{g} \otimes \phi'(\mathbf{x})$ | 无 |
| 逐元素乘 | $\mathbf{u} = \mathbf{a} \otimes \mathbf{b}$ | 对 $\mathbf{a}$：$\mathrm{diag}(\mathbf{b})$ | 对 $\mathbf{a}$：$\mathbf{g} \otimes \mathbf{b}$；对 $\mathbf{b}$：$\mathbf{g} \otimes \mathbf{a}$ | 无 |
| 矩阵乘法 | $Z = XW$ | 一个位置：$W^{T}$ | $GW^{T}$ | $X^{T}G$ |
| 矩阵乘法（两边都是输入） | $Z = AB$ | 对 $A$ 的一行：$B^{T}$ | 对 $A$：$GB^{T}$；对 $B$：$A^{T}G$ | 无 |
| softmax | $\mathbf{p} = \mathrm{softmax}(\mathbf{x})$ | $\mathrm{diag}(\mathbf{p}) - \mathbf{p}^{T}\mathbf{p}$ | $\mathbf{p} \otimes (\mathbf{g} - \mathbf{g} \cdot \mathbf{p})$ | 无 |
| softmax 与 cross-entropy | $\ell = -\ln p_y$ | $\ell$ 是标量，对 logits 的导数是 $1 \times V$ 的梯度 | 对 logits：$\mathbf{p} - \mathbf{y}$；$T$ 个位置取平均时 $\frac{1}{T}(P - Y)$ | 无 |

链式法则：一条路径上的导数相乘，多条路径的贡献相加。反向传播从 $\dfrac{\partial L}{\partial L} = 1$ 开始，按前向的相反顺序，对每个运算用上表计算一次 vector-Jacobian product。

:::recap
本文各种运算的前向、Jacobian、Loss 对输入的导数和 Loss 对权重的导数。
:::

### 符号说明 {#notation}

| 符号 | 含义 |
|---|---|
| $x$，$\mathbf{x}$，$X$ | 标量；向量（行向量，一个位置）；矩阵（$T$ 个位置堆成，$T \times d$） |
| $T$，$d$，$V$，$N$ | 序列长度；模型宽度；词表大小；Decoder 层数 |
| $d_{ff}$，$n_h$，$n_{kv}$，$d_h$ | FFN 中间宽度；query head 数；K/V head 数；每个 head 的宽度 |
| $\Delta x$，$\Delta\mathbf{x}$ | 输入的变化量（有限大小）；变化量很小时 $\Delta y \approx \dfrac{dy}{dx}\,\Delta x$ |
| $\dfrac{df}{dx}$，$\dfrac{\partial f}{\partial x}$ | 单变量导数；偏导数（其他输入固定） |
| $\nabla f$，$\dfrac{\partial f}{\partial \mathbf{x}}$ | 梯度，$f$ 对每个输入的偏导数排成一行 |
| $J$，$\dfrac{\partial \mathbf{z}}{\partial \mathbf{x}}$ | Jacobian，第 $j$ 行第 $i$ 列是 $\partial z_j / \partial x_i$（行对应输出，列对应输入） |
| $\ell$，$\ell_t$，$L$ | 一个位置的 cross-entropy；位置 $t$ 的 cross-entropy；整个序列的 Loss，$L = \frac{1}{T}\sum_t \ell_t$ |
| $G$ | Loss 对某个运算输出的导数，与输出同形状 |
| $dZ$，$dL$ | 全微分：输入有微小变化时输出的一阶变化，$dL = \sum_{t,j} G_{tj}\,dZ_{tj}$ |
| $\eta$，$\varepsilon$，$E_{ij}$ | 学习率；梯度检验中加到一个权重上的小量；第 $i$ 行第 $j$ 列为 1、其余为 0 的矩阵 |
| $\otimes$ | 逐元素相乘（Hadamard product） |
| $\mathrm{diag}(\mathbf{v})$ | 以 $\mathbf{v}$ 为对角线的方阵 |
| $I$，$\mathbf{y}_t$，$Y$ | 单位矩阵；目标 token 的 one-hot 向量；它们堆成的 $T \times V$ 矩阵 |
| $\mathbf{p}_t$，$P$ | 位置 $t$ 的 softmax 输出；它们堆成的 $T \times V$ 矩阵 |
| $\sigma$，$\mathrm{Swish}$ | $\sigma(z) = 1/(1+e^{-z})$；$\mathrm{Swish}(z) = z\,\sigma(z)$ |
| $\mathrm{Swish}'$，$f'$ | 只有一个输入的标量函数的导数，$\mathrm{Swish}'(z) = \dfrac{d\,\mathrm{Swish}(z)}{dz}$；作用在向量或矩阵上时逐元素计算，结果与输入同形状 |

:::recap
$T$、$d$、$V$、$N$ 是序列长度、模型宽度、词表大小和 Decoder 层数。$\ell_t$ 是位置 $t$ 的 Loss，$L$ 是它们的平均。$G$ 是 Loss 对运算输出的导数，$\otimes$ 是逐元素相乘。
:::

### 参考文献 {#references}

:::references
- [@parr2018] Parr, T. & Howard, J. [The Matrix Calculus You Need For Deep Learning](https://arxiv.org/abs/1802.01528), 2018. 中文翻译见[旧站](https://yhnocoder.github.io/learn_by_visualization/topics/matrix-calculus/)。
- [@griewank2008] Griewank, A. & Walther, A. [Evaluating Derivatives: Principles and Techniques of Algorithmic Differentiation](https://doi.org/10.1137/1.9780898717761), 2nd ed., SIAM, 2008.
- [@giles2008] Giles, M. B. [An extended collection of matrix derivative results for forward and reverse mode algorithmic differentiation](https://people.maths.ox.ac.uk/gilesm/files/NA-08-01.pdf), Oxford University Computing Laboratory, Report NA-08-01, 2008.
- [@zhang2019] Zhang, B. & Sennrich, R. [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467), NeurIPS 2019.
- [@su2021] Su, J. et al. [RoFormer: Enhanced Transformer with Rotary Position Embedding](https://arxiv.org/abs/2104.09864), 2021.
:::

:::recap
Parr 与 Howard 的原文，自动微分教材，Giles 整理的矩阵求导结果，RMSNorm 和 RoPE 的论文。
:::
