---
title: 大模型里的激活函数：从 ReLU 到 SiTU-GLU
slug: llm-act-fns
date: 2026-09-17
summary: 本文介绍激活函数如何引入非线性、现代 LLM 为什么采用 SwiGLU，以及 clamp 和 soft-capping 如何限制激活值。每一节都将给出公式、导数、可交互的曲线图，以及设计动机和取舍。
tags: [LLM, 激活函数]
toc: notes
category: llm
---

## 引言 {#s0}

### 激活函数在 LLM 里的位置 {#where}

一个 decoder block 由注意力和前馈网络（FFN）两部分组成。激活函数出现在 FFN 中间：输入先被升维，过一个逐元素的非线性，再被降回来[^softmax]。写成最朴素的形式就是

[^softmax]: 注意力里的 softmax 严格来说也是非线性，但它的角色是归一化权重，不是我们平时说的“激活函数”。

$$
\mathrm{FFN}(x) = \phi(xW_1 + b_1)\,W_2 + b_2,\qquad W_1\in\mathbb{R}^{d\times d_{ff}},\; W_2\in\mathbb{R}^{d_{ff}\times d}.
$$

这里保留偏置 $b_1$、$b_2$ 是为了推导完整，现代 LLM 的 FFN 通常不带偏置。不计 embedding 时，这一层在使用多头注意力（MHA）的 dense 模型中约占三分之二的参数（Llama 2 7B 约为 67%），在使用分组查询注意力（GQA）的模型中比例更高（Llama 3 8B 约为 81%），对于 MoE 模型，更是包含了几乎全部的参数。这一层的计算开销和训练行为直接决定整个模型的开销和训练行为，所以对激活函数的任何要求，最终都要回到三个问题上：==在同等算力下 loss 能不能更低==；==在几百亿到几万亿参数的规模下训练会不会不稳定==；以及==推理时这个逐元素操作能不能以轻量的方式融合进 GEMM 的 [epilogue](https://docs.nvidia.com/cutlass/latest/media/docs/cpp/gemm_api_3x.html)==[^epilogue]中，不额外占带宽。

[^epilogue]: 对矩阵乘法结果执行逐元素操作的阶段。

2017 年的原始 Transformer 用 ReLU，2018 年 BERT 和 GPT 换成 GELU，2020 年 Shazeer 的实验显示门控形式的 GLU 能在同参数量下压低 loss[@shazeer2020]，之后 PaLM 和 Llama 把 SwiGLU 变成了事实标准。2025 到 2026 年的变化则来自另一个方向：模型大到一定程度之后，GLU 的乘积无界成了训练稳定性的隐患，于是 gpt-oss、DeepSeek-V4、Kimi K3 各自给它加了上界（clamp 或 soft-capping）；与此同时 NVIDIA 的 Nemotron 用回了 Squared ReLU。综合这些变化，激活函数的选择其实是在“表达力、稳定性、内核效率”三个目标之间取平衡。

:::recap
FFN 占大部分参数；选激活函数要看 loss、训练稳定性、内核效率。
:::

### 一个神经元收到的是什么 {#unit-input}

上面的 FFN 公式对一个 token 的表示 $x\in\mathbb{R}^{d}$ 进行计算。中间层有 $d_{ff}$ 个神经元，第 $i$ 个神经元收到的数是

$$
z_i = x\,w_i + b_i ,
$$

其中 $w_i$ 是 $W_1$ 的第 $i$ 列，$b_i$ 是 $b_1$ 的第 $i$ 个分量。$z_i$ 称为预激活值（pre-activation），它是 $x$ 在方向 $w_i$ 上的投影加上一个偏置，是一个实数。激活函数 $\phi$ ==逐元素==作用，所以它对第 $i$ 个神经元的计算只用到 $z_i$ 这一个数，不用到 $x$ 的其他分量，也不用到同一层其他神经元的 $z_j$。一个长度为 $T$ 的序列经过这一层时，输入是矩阵 $X\in\mathbb{R}^{T\times d}$，每一行是一个 token 的表示；预激活值是矩阵 $Z=XW_1+b_1\in\mathbb{R}^{T\times d_{ff}}$，第 $t$ 行第 $i$ 列是第 $t$ 个 token 在第 $i$ 个神经元上的 $z_i$。$\phi$ 对这 $T\times d_{ff}$ 个实数中的每一个都独立地计算一次，输出 $\phi(Z)$ 的形状仍是 $T\times d_{ff}$。

本文的曲线图把激活函数记作 $f$，横轴记作 $x$，也就是预激活值 $z_i$。每张图都有 $f(x)$ 和 $\frac{df(x)}{dx}$ 两个图，它们分别对应如下概念：

**$f(x)$ 决定这个神经元在前向传播中贡献多少**。FFN 的输出是

$$
\mathrm{FFN}(x)=\sum_{i=1}^{d_{ff}} f(z_i)\,W_2[i,:]+b_2 ,
$$

也就是把 $W_2$ 的每一行按 $f(z_i)$ 加权后相加。$f(z_i)=0$ 时第 $i$ 行完全不参与，$f(z_i)$ 越大这一行的权重越大，$f(z_i)$ 为负时这一行以相反的方向参与。所以，看 $f(x)$ 的纵轴，就是在看==当预激活值取某个数时，这个神经元对应的 $W_2$ 行被放大多少倍==。

**$\frac{df(x)}{dx}$ 决定这个神经元在反向传播中传回多少梯度**。记第 $i$ 个神经元的输出为 $h_i=f(z_i)$，loss 对 FFN 输出的梯度为 $\delta$。$h_i$ 只通过 $W_2$ 的第 $i$ 行影响输出；又因为 $f$ 逐元素作用，$z_j\,(j\neq i)$ 不参与 $h_i$ 的计算，故梯度从 $h_i$ 传到 $z_i$ 时只乘一个标量 $\frac{df(z_i)}{dz_i}$：

$$
\begin{aligned}
\frac{\partial L}{\partial h_i}&=\delta\,W_2[i,:]^{\top},\\[4pt]
\frac{\partial L}{\partial z_i}&=\frac{\partial L}{\partial h_i}\,\frac{df(z_i)}{dz_i}=\bigl(\delta\,W_2[i,:]^{\top}\bigr)\,\frac{df(z_i)}{dz_i},\\[4pt]
\frac{\partial L}{\partial w_i}&=x^{\top}\frac{\partial L}{\partial z_i},\qquad
\frac{\partial L}{\partial b_i}=\frac{\partial L}{\partial z_i},\qquad
\frac{\partial L}{\partial x}=\sum_{i=1}^{d_{ff}}\frac{\partial L}{\partial z_i}\,w_i^{\top}.
\end{aligned}
$$

$\frac{df(z_i)}{dz_i}$ 同时控制两条路径：一条是流向本神经元参数 $w_i$ 和 $b_i$ 的梯度，决定这个神经元是否会因这个 token 而更新；另一条是经过 $w_i$ 流回 $x$ 的梯度，决定这个神经元是否把误差信号传给更靠前的层。$\frac{df(z_i)}{dz_i}=0$ 时两条路径都被切断；$\frac{df(z_i)}{dz_i}$ 大于 1 时梯度被放大；$\frac{df(z_i)}{dz_i}$ 为负时梯度的符号被翻转。

:::recap
激活函数逐元素作用于预激活值 $z_i$：$f(z_i)$ 决定 $W_2$ 的第 $i$ 行在前向传播中被放大多少倍，$\frac{df(z_i)}{dz_i}$ 决定反向传播中传回多少梯度。
:::

### 读图时要看的四个要素 {#four-regions}

常见情况下，预激活值 $z_i$ 在训练中的分布大致以零为中心：多数落在原点附近的一个有限范围内，两侧各有一部分落在较远处。

**要素一：负半轴远端（$x\to-\infty$）**。落在这里的神经元收到的是与 $w_i$ 方向相反的强输入，按设计意图它们不应当响应。要关注的点：

- ==$f(x)$ 是否严格为零，还是只是趋近零==，以及趋近极限的快慢。严格为零时，这个神经元对应的 $W_2$ 行完全不参与求和，推理时可以跳过这一行的计算，这是激活稀疏性的前提；只是趋近零时，仍有一个很小的输出通过，不能跳过。如果 $f(x)$ 趋近的不是零而是某个非零常数，这个常数会以固定比例把 $W_2$ 的这一行加进输出。
- ==$\frac{df(x)}{dx}$ 是否为零==。为零时，落在这里的神经元不会因这个 token 得到任何更新；如果一个神经元对所有 token 都落在这里，它的 $w_i$、$b_i$ 收到的梯度恒为零，不会再更新。$\frac{df(x)}{dx}$ 很小但非零时，更新仍在进行，只是缓慢。

:::llm-act-plot{fns="relu,silu,tanh" xmin=-6 xmax=2 ymin=-1.5 ymax=2 dymin=-0.3 dymax=1.2 guides=far-negative}
三条曲线展示三种不同的极限行为：ReLU 的输出与导数在整个负半轴严格为零；SiLU 的输出从负值一侧趋近零，导数也趋近零，但在有限输入下都不等于零；tanh 的输出趋近 −1 而不是零，导数趋近零。
:::

**要素二：零点（$x=0$）**。预激活值的分布以零为中心，有大量神经元落在零附近。零点是“响应”与“不响应”的分界。要关注的点：

- ==$f(0)$ 是多少==：输入为零时是否输出零；如果输出一个非零常数，这个常数与输入无关，会固定地加进 $W_2$ 的求和。用作门控系数时，$f(0)$ 就是零输入对应的缩放系数。
- ==$\frac{df}{dx}(0)$ 是多少==：零附近的小扰动以多大比例通过。
- ==$f$ 在原点是否可导==：如果不可导，数学上这一点的导数没有定义，实现时必须约定一个值，并且 $\frac{df(x)}{dx}$ 在这里跳变，一个神经元的预激活值从零的一侧跨到另一侧时，它收到的梯度会突然改变。

:::llm-act-plot{fns="relu,silu,sigmoid" xmin=-2 xmax=2 ymin=-0.5 ymax=1.5 dymin=-0.2 dymax=1.2 guides=zero}
只看原点附近。$f(x)$ 面板：ReLU 和 SiLU 在原点输出 0，sigmoid 在原点输出 0.5，这个 0.5 与输入无关。$\frac{df(x)}{dx}$ 面板：SiLU 在原点导数为 0.5，sigmoid 为 0.25，两者都连续；ReLU 的导数从左侧的 0 跳到右侧的 1，两个空心圆表示左右极限，原点本身没有导数。
:::

**要素三：过渡区**。这是 $f$ 从负半轴的行为切换到正半轴的行为所经过的输入范围，也是不同激活函数的曲线差异最大的地方。落在这里的神经元处于部分响应的状态，它们的输出和梯度都对输入的变化敏感。要关注的点：

- ==过渡有多宽==：宽度决定了有多少神经元处于部分响应的状态。过渡集中在一个点上时函数接近硬开关，过渡很宽时多数神经元都在部分响应。
- ==$\frac{df(x)}{dx}$ 是否连续==：不连续意味着神经元跨过某个输入值时梯度跳变。
- ==$f$ 是否单调，$\frac{df(x)}{dx}$ 是否越过零或超过 1==：如果 $f$ 在这一段有一个最低点，那么最低点左侧有一段区间 $\frac{df(x)}{dx}$ 为负，落在这里的神经元收到的梯度符号被翻转；如果 $\frac{df(x)}{dx}$ 超过 1，落在这里的神经元收到的梯度被放大。

图中的色带标出过渡区的范围，色带的定义随函数改变，见各图图注。

:::llm-act-plot{fns="relu,gelu,sigmoid" ymax=3 dymin=-0.4 dymax=1.6 guides=transition}
三种过渡方式。ReLU 的过渡集中在 x = 0 这一个点上，竖虚线标出这个位置，$\frac{df(x)}{dx}$ 在这里跳变。sigmoid 的过渡分布在一段宽区间内，单调，导数连续且不超过 0.25。GELU 的过渡集中在色带范围内，导数连续，但函数在负半轴有一个最低点，最低点左侧导数为负，正半轴上导数一度超过 1，两个标记点分别标出导数的最小值与最大值。
:::

**要素四：正半轴远端（$x\to+\infty$）**。落在这里的神经元收到与 $w_i$ 方向一致的强输入，处于完全响应的状态。这也是激活值幅度最大的区域，第 8 节介绍的几个模型所限制的正是这一区域的激活值。要关注的点：

- ==$f(x)$ 有没有上界==：没有上界时，$W_2$ 的求和中可能出现很大的项，需要考虑数值范围和后续归一化能否承受；有上界时，不同的强输入给出近似相同的输出，它们之间的差异被压缩。
- ==$f(x)$ 以什么速度增长==：与 $x$ 同速、比 $x$ 快，还是趋于停止。
- ==$\frac{df(x)}{dx}$ 的极限==：趋近一个常数，意味着强输入的梯度按固定比例通过；趋近零，意味着强输入几乎收不到梯度；没有上界，意味着梯度随输入增大而增大。

图中的虚线表示极限行为，不表示饱和从某个固定位置开始。

:::llm-act-plot{fns="silu,tanh,relu2" colors="1,3,2" xmin=-2 xmax=6 ymin=-1 ymax=7 dymin=-0.3 dymax=3 guides=far-positive}
淡色区域是正半轴远端。三条曲线展示三种增长方式：SiLU 的输出趋近 x，导数趋近 1，没有上界但增长速度不再增加；tanh 的输出趋近 1，导数趋近 0，有上界；ReLU² 的输出按 x² 增长，导数为 2x，输出和导数都没有上界，曲线在图内就已经超出纵轴范围。
:::

:::aside{title="阅读约定"}
本文的 $\sigma(x)=\dfrac{1}{1+e^{-x}}$ 表示 logistic sigmoid，$\Phi(x)$ 表示标准正态分布的累积分布函数，$\odot$ 表示逐元素乘。
:::

:::recap
读图时依次看负半轴远端、零点、过渡区、正半轴远端：输出是否严格为零、原点是否可导、过渡有多宽、输出和导数有没有上界。
:::

## 总览 {#s1}

比较各函数的输出、导数和极限行为。

:::llm-act-plot{fns="relu,relu2,gelu,silu,softplus,sigmoid,tanh" colors="1,2,3,4,6,7,8" off="softplus,sigmoid,tanh" dymin=-0.5 dymax=2.5 toggle=true}
**勾选曲线进行比较**。读图时先看负半轴的输出与斜率，再看原点和过渡宽度，最后看大正输入是近似线性增长、饱和还是加速增长。色带、参考线、关键点和详细定义见各函数的单独图。
:::

### Logistic sigmoid {#logistic}

$$
\sigma(x)=\frac{1}{1+e^{-x}},\qquad \frac{d\sigma(x)}{dx}=\sigma(x)\bigl(1-\sigma(x)\bigr).
$$

:::llm-act-plot{fns="logistic" xmin=-6 xmax=6 ymin=-0.05 ymax=1.05 dymin=-0.02 dymax=0.45}
**当输入趋向负无穷**：输出趋近 0，导数趋近 0，进入饱和区。

**原点**：输出 0.5，导数 0.25；零输入对应门控系数 0.5。

**过渡区**：色带覆盖输出从 0.1 到 0.9 的范围，约 [−2.20, 2.20]，宽 4.39。曲线和导数都连续光滑。

**当输入趋向正无穷**：输出趋近 1，导数趋近 0，进入饱和区。水平虚线表示极限值，不表示饱和从某个固定位置开始。
:::

:::recap
Logistic sigmoid 在原点输出 0.5、导数 0.25，过渡区约为 $[-2.20, 2.20]$，两端都饱和。
:::

### $\Phi(x)$：标准正态分布的累积概率 {#normal-cdf toc="标准正态累积分布 Φ(x)"}

$$
\Phi(x)=\int_{-\infty}^{x}\frac{e^{-t^2/2}}{\sqrt{2\pi}}\,dt,\qquad \frac{d\Phi(x)}{dx}=p(x)=\frac{e^{-x^2/2}}{\sqrt{2\pi}}.
$$

:::llm-act-plot{fns="normal-cdf" colors="3" xmin=-6 xmax=6 ymin=-0.05 ymax=1.05 dymin=-0.02 dymax=0.45}
**当输入趋向负无穷**：$\Phi(x)$ 趋近 0，导数趋近 0，门控系数趋近 0。

**原点**：输出 0.5，导数约 0.399；导数就是标准正态密度，在这里最高。

**过渡区**：色带覆盖输出从 0.1 到 0.9 的范围，约 [−1.28, 1.28]，宽 2.56。它比 logistic 的过渡更集中，但曲线仍处处光滑。

**当输入趋向正无穷**：输出趋近 1，导数趋近 0。GELU 用 $x\Phi(x)$ 将这个有界 gate 与输入相乘，所以 GELU 自身的正半轴并不饱和。
:::

:::recap
$\Phi(x)$ 的导数是标准正态密度，过渡区约为 $[-1.28, 1.28]$，比 logistic 更集中；GELU 用它作 gate。
:::

## Sigmoid 与 Tanh：门控与 soft-capping {#s2 toc="Sigmoid 与 Tanh"}

它们较少直接用作现代 LLM 的 FFN 激活函数，但常用于门控和限制输出范围。

$$
\begin{aligned}
\sigma(x)&=\frac{1}{1+e^{-x}},&\qquad \frac{d\sigma(x)}{dx}&=\sigma(x)\bigl(1-\sigma(x)\bigr)\le\tfrac14;\\[8pt]
\tanh(x)&=2\sigma(2x)-1,&\qquad \frac{d\tanh(x)}{dx}&=1-\tanh^2(x)\le 1.
\end{aligned}
$$

:::llm-act-plot{fns="sigmoid,tanh" xmin=-6 xmax=6 ymin=-1.2 ymax=1.2 dymin=-0.1 dymax=1.1 guides=sigmoid-tanh}
:::

==当输入趋向负无穷==：sigmoid 的输出趋近 0，用作门控时会使被乘的信号趋近零；tanh 的输出趋近 −1，保留饱和的负信号。两者的导数都为正，并随输入趋向负无穷而趋近零：输出逐渐不再变化，局部梯度也越来越弱。

==原点==：sigmoid 输出 0.5，导数为 0.25。若它的输出被送入带 bias 的线性层，这个常数分量可以由后续 bias 抵消；若它直接乘在信号上做 gate，0.5 表示信号减半，不能靠后续 bias 抵消；不过 gate 的作用本来就是按比例缩放信号，零输入对应减半是这个设计的一部分，不需要抵消。tanh 输出 0，导数为 1，因此在零附近近似原样传递输入。

==过渡区==：两者都光滑、单调，导数连续。相同输入尺度下，tanh 的过渡区更窄、更陡，sigmoid 的更宽、更缓。统一用“完成输出变化的 10% 到 90%”衡量：sigmoid 约为 −2.20 到 2.20（宽 4.39），tanh 约为 −1.10 到 1.10（宽 2.20，对应输出 −0.8 到 0.8）。

==当输入趋向正无穷==：两者的输出都趋近 1，导数都趋近零。强正信号被压到有限范围内；输入继续增大，输出也几乎不再增加。这适合使门控系数接近 1，或限制输出幅度，但会削弱大输入之间的差异。

在现代模型中，sigmoid 常用于门控：SiLU 本身就是 $x\,\sigma(x)$，DeepSeek-V3 的 MoE 路由用 sigmoid 给专家打分，Qwen3-Next 的 gated attention[@qiu2025] 在注意力输出后乘一个 sigmoid gate，Gated DeltaNet 的写入强度 $\beta_t$ 也是 sigmoid。它有界、单调、输出天然落在 $(0,1)$，这些性质便于将它用作乘法系数。但接近 0 或 1 时，梯度仍会因饱和而减小。

tanh 也用于 soft-capping：对一个无界量 $z$，用 $c\cdot\tanh(z/c)$ 代替它，这样在 $|z|\ll c$ 时几乎是恒等映射，导数接近 1；在 $|z|\gg c$ 时被平滑地压到 $\pm c$ 以内。Gemma 2 用它处理 logits，Gemma 3 一度去掉，Gemma 4 又把最终 logits 的 soft-capping 加了回来（`final_logit_softcapping: 30.0`）；Kimi K3 用它处理 GLU 的两个分支，这个思路我们在第 8 节还会展开。和 clamp 到固定值的做法相比，它的导数处处连续，饱和区域的梯度不是直接归零，而是按 $1-\tanh^2$ 平滑衰减。

## ReLU：计算开销与激活稀疏性 {#s3 toc="ReLU"}

它计算开销小，能让 FFN 的中间层出现大量精确为零的输出。这两点在 2024 年之后重新变得重要。

$$
\mathrm{ReLU}(x)=\max(0,x),\qquad \frac{d\,\mathrm{ReLU}(x)}{dx}=\mathbb{1}[x>0].
$$

:::llm-act-plot{fns="relu" dymin=-0.2 dymax=1.2}
:::

==负半轴==：输出和导数严格为零。淡色区域表示整个输出为零的区域，不是过渡区。

==原点==：输出为 0；左侧斜率 0、右侧斜率 1，函数连续但不可导。导数图的空心圆表示左右极限，不代表原点的导数值。实现通常约定原点的反向值为 0。

==过渡区==：没有有限宽度的过渡，切换集中在 x=0 的竖虚线上。两个导数分支分开绘制，不用斜线连接。

==正半轴==：输出等于输入，导数恒为 1。信号线性增长，没有上界。

原始 Transformer 用的是 ReLU。GPT-1 改用 GELU，BERT 论文写明沿用 GPT-1 的选择，此后的模型陆续沿用，ReLU 由此退出了主流 LLM。ReLU 的负半轴梯度恒为零，预激活值长期为负的神经元不再更新[^dead-relu]。

[^dead-relu]: 具体参考：[dead ReLU](https://app.heptabase.com/p/card/78579053-4d9a-4387-b8ab-e53d245c2078)。

稀疏推理研究重新关注了 ReLU。SiLU 和 GELU 的输出通常非零；ReLU 在整个负半轴上输出严格为零，输出为零的通道可以在推理时跳过。Apple 在“ReLU Strikes Back”[@mirzadeh2024]中观察到，FFN 使用 ReLU 时，各层中间输出的稀疏度都超过 90%，每个零值对应 $W_2$ 中一整行不需要读取、不需要参与乘法的权重。不过能跳过的只有 $W_2$：要知道哪些神经元输出为零，必须先算出全部预激活值 $XW_1$，这一步要完整读取 $W_1$。所以即使 90% 的输出为零，省下的也只是 $W_2$ 中对应行的访存和乘法。[^predictor]对于内存带宽受限的推理场景（尤其是端侧和 CPU offloading），论文结合其他改动，报告推理计算量最多可以降到约三分之一；用 ReLU 重新微调一个 GELU 或 SiLU 模型（论文称之为 [ReLUfication](https://arxiv.org/abs/2310.04564)，即将激活函数替换为 ReLU 后继续训练），模型质量下降很小。后续的 TurboSparse[@song2024] 将这一方法扩展到门控结构，提出 [dReLU](https://arxiv.org/html/2406.05955v1#S3.SS2)：对 gate projection 和 up projection 的输出分别应用 ReLU，再逐元素相乘，

[^predictor]: Deja Vu、PowerInfer 等方法先用一个小的预测器估计哪些神经元会输出零，再把 $W_1$ 的对应列也一起跳过。

$$
\mathrm{dReLU}(x)=\mathrm{ReLU}(xW_g)\odot\mathrm{ReLU}(xW_u),
$$

论文报告，TurboSparse-Mistral-7B 的 FFN 平均有 90% 的神经元不激活，TurboSparse-Mixtral-47B 每个专家 FFN 平均约为 85%；按摘要给出的数字，两者每次推理分别只激活 2.5B 和 4.3B 参数。

主流开源模型的训练目标是同等算力下的 loss。在 Shazeer 2020 的实验中，普通 ReLU FFN 的 log-perplexity（1.997）高于 SwiGLU（1.944）；稀疏推理带来的带宽收益不在这些模型的优先级内。

## GELU：定义、导数与常用近似 {#s4 toc="GELU"}

把 dropout 和 ReLU 合并成一个确定性的函数。

$$
\mathrm{GELU}(x)=x\,\Phi(x)=x\int_{-\infty}^{x}\frac{1}{\sqrt{2\pi}}e^{-t^2/2}\,dt,\qquad \frac{d\,\mathrm{GELU}(x)}{dx}=\Phi(x)+x\,p(x),
$$

其中 $p(x)$ 是标准正态分布的概率密度函数。Hendrycks 和 Gimpel[@hendrycks2016] 的出发点是：ReLU 是把输入乘以 $\mathbb{1}[x>0]$，dropout 是把输入乘以一个伯努利随机变量，那么不妨把这个随机变量的概率设成与输入相关的 $\Phi(x)$，再对随机性取期望，得到的就是 $x\Phi(x)$。这样输入越大越可能被“保留”，越小越可能被“丢弃”，而整个过程是确定性且光滑的。

:::fold{title="展开了解：为什么期望恰好是 $x\Phi(x)$？"}
这里的随机操作只有两个结果：保留输入 $x$，或者把它置为 $0$。设 $B$ 是一个取值为 $0$ 或 $1$ 的随机变量，并规定

$$
P(B=1\mid x)=\Phi(x),\qquad P(B=0\mid x)=1-\Phi(x).
$$

给定输入 $x$，输出就是 $xB$。对这次随机选择取期望：

$$
\mathbb E[xB\mid x]=\underbrace{x\cdot\Phi(x)}_{\text{保留时的输出}\times\text{概率}}+\underbrace{0\cdot\bigl[1-\Phi(x)\bigr]}_{\text{置零时的输出}\times\text{概率}}=x\,\Phi(x).
$$

例如，若某个输入的保留概率为 $0.8$，那么平均输出就是 $0.8x$。ReLU 对应 $P(B=1\mid x)=\mathbb{1}[x>0]$，dropout 对应 $P(B=1\mid x)=p$ 且与 $x$ 无关；GELU 把这个概率改成随 $x$ 单调增加的 $\Phi(x)$，再取期望，就得到确定性的 $x\Phi(x)$。
:::

:::llm-act-plot{fns="gelu-erf" dashed="gelu-tanh,gelu-quick" guides=gelu-approx zoom=true}
左图是 GELU 的输出 $f(x)$，右图是导数 $\frac{df(x)}{dx}$；实线是精确 GELU，虚线是两种近似。三条曲线在默认视野下几乎重合，拖动“横轴范围”、“横轴中心”查看差异。
:::

==当输入趋向负无穷==：输出从负值一侧趋近零，导数也从负值一侧趋近零，幅度按高斯尾部快速衰减，所以强负输入几乎不输出信号，也几乎不传递梯度。与 ReLU 的区别是这里没有整段严格为零的区域，输出和导数只是接近零，不等于零。

==原点==：输出为 0，导数为 0.5。零输入不产生输出，但原点附近的小扰动仍能通过，局部响应约为输入变化的一半。

==过渡区==：曲线和导数都连续光滑。输出先在约 −0.75 处降到最低点 −0.17，再回升并穿过原点。注意函数最低点与导数最低点不同：导数在 −√2 处最低，约 −0.129；在 √2 处最高，约 1.129，随后回落。

==当输入趋向正无穷==：输出越来越接近输入本身，导数趋近 1。强正信号以近似线性的方式通过，没有上界，但其增长速度不会随输入持续增加。

### 两种近似 {#gelu-approximations}

$\Phi(x)$ 可以通过误差函数 $\mathrm{erf}$ 计算。相比 ReLU，它的数值求值更复杂，因此也常使用近似形式；实际性能收益取决于硬件和实现。

:::fold{title="展开了解：erf 是什么，计算机怎样计算它？"}
误差函数（error function）的定义是

$$
\operatorname{erf}(x)=\frac{2}{\sqrt{\pi}}\int_0^x e^{-t^2}\,dt.
$$

它表示曲线 $e^{-t^2}$ 从 0 到 $x$ 的有符号面积，再乘一个固定系数。“误差”这个名字与正态分布中的误差概率有关，并不是指神经网络的 loss。

**它与 $\Phi(x)$ 是同一种积分的不同写法**。标准正态分布关于 0 对称，左半边面积为 $1/2$。先把积分拆在 0 处，再令 $u=t/\sqrt2$，就有

$$
\begin{aligned}
\Phi(x)&=\frac12+\frac{1}{\sqrt{2\pi}}\int_0^x e^{-t^2/2}\,dt\\[6pt]
&=\frac12+\frac{1}{\sqrt\pi}\int_0^{x/\sqrt2}e^{-u^2}\,du\\[6pt]
&=\frac12\left[1+\operatorname{erf}\left(\frac{x}{\sqrt2}\right)\right].
\end{aligned}
$$

把积分写成 erf，并没有自动消除计算难度，**实际求值通常依靠近似公式**。数学库可以用多项式或两个多项式之比来逼近 erf，并按输入区间选择适合的公式，以控制误差。多项式又可以写成嵌套的乘加形式，例如

$$
a_0+a_1x+a_2x^2+a_3x^3=a_0+x\bigl(a_1+x(a_2+xa_3)\bigr).
$$

这样只需有限次运算就能得到近似值，无须每次把积分面积切成大量小块逐一相加。这里的多项式只是计算方式的示例，具体系数、次数和区间由实现及精度要求决定。[NIST 的数值近似资料](https://dlmf.nist.gov/7.24)列出了 erf 的多项式和有理函数近似方法。

**开销主要来自更多计算**。ReLU 只需比较并选择，而 erf 的求值通常需要一组乘加及可能的区间判断等操作。FFN 的每个中间元素都要计算一次，大量重复后就可能影响速度；这并不意味着 erf 天然需要大量显存。tanh 近似能否更快，还要看硬件支持、精度和内核融合方式，不能只看公式长短。
:::

常用的近似有两个。第一个是 tanh 近似：

$$
\mathrm{GELU}_{\tanh}(x)=\tfrac12 x\bigl[1+\tanh s\bigr],\qquad s=\sqrt{\tfrac{2}{\pi}}\,(x+0.044715\,x^3),
$$

它的导数由乘积法则给出，其中 $\frac{d\tanh s}{ds}=1-\tanh^2 s$：

$$
\frac{d\,\mathrm{GELU}_{\tanh}(x)}{dx}=\tfrac12\bigl[1+\tanh s\bigr]+\tfrac12 x\,\bigl(1-\tanh^2 s\bigr)\,\sqrt{\tfrac{2}{\pi}}\,\bigl(1+0.134145\,x^2\bigr).
$$

BERT、GPT-2 以及现在的 Gemma 系列用的都是它。第二个常被叫作 Quick GELU：

$$
\begin{aligned}\mathrm{GELU}_{\text{quick}}(x)&=x\,\sigma(1.702x),\\ \frac{d\,\mathrm{GELU}_{\text{quick}}(x)}{dx}&=\sigma(1.702x)\bigl[1+1.702\,x\,\bigl(1-\sigma(1.702x)\bigr)\bigr].\end{aligned}
$$

系数 1.702 用来让 $\sigma(1.702x)$ 逼近 $\Phi(x)$。OpenAI 的 CLIP 用过，第 8 节介绍的 gpt-oss 在 gate 分支里用的系数 $\alpha=1.702$ 也来自这个近似。

近似的存在带来一个工程上的规则：*训练用哪个版本，推理就必须用哪个版本*。Gemma 刚开源时 Hugging Face 的实现用了精确 GELU，而官方权重是用 tanh 近似训的，两者在大多数位置只差万分之几，但一层层累积之后足以影响生成质量。transformers 在 [PR #29729](https://github.com/huggingface/transformers/pull/29729) 中新增 `hidden_activation` 配置字段，把 Gemma 的激活指定为 tanh 近似实现 `gelu_pytorch_tanh`[@hf-docs]，解决了这个问题。做权重转换、编写推理内核、做量化校准时，这类不一致不会报错，只能通过逐层对比输出发现。

:::recap
GELU 常用 tanh 近似和 quick 近似 $x\,\sigma(1.702x)$；训练用哪个版本，推理就必须用哪个版本。
:::

## SiLU / Swish：输入与 sigmoid 的乘积 {#s5 toc="SiLU / Swish"}

它的曲线与 GELU 接近，但只需要一次 sigmoid 和一次乘法。

$$
\mathrm{Swish}_\beta(x)=x\,\sigma(\beta x),\qquad \frac{d\,\mathrm{Swish}_\beta(x)}{dx}=\sigma(\beta x)\bigl[1+\beta x\bigl(1-\sigma(\beta x)\bigr)\bigr].
$$

$\beta=1$ 的特例叫 SiLU（Sigmoid Linear Unit）。这个名字由 Hendrycks 和 Gimpel 在 GELU 论文中提出[^iclr]；Elfwing 等人 2017 年在强化学习中使用了这个函数，起初称为 SiL，后改称 SiLU；Google 的 Ramachandran 等人[@ramachandran2017]用自动搜索重新发现了它，并把 $\beta$ 设为可学参数，取名 Swish。现在 LLM 里说 SiLU、Swish 基本指同一个东西，$\beta$ 也基本都固定为 1。

[^iclr]: 据作者在论文附录中的说明，最早见于 2016 年的 ICLR 投稿。

:::llm-act-plot{fns="swish" reference="relu" beta=1}
拖动 β，色带和最低点随曲线移动；色带或最低点超出视野时，图下方会给出提示。
:::

==当输入趋向负无穷==：固定 $\beta>0$ 时，输出和导数都从负值一侧趋近零，绝对值很大的负输入对应的输出接近零。

==原点==：输出为 0，导数为 0.5，不随 $\beta$ 改变。函数最低点位于原点左侧，$\beta=1$ 时约为 $(-1.28,\,-0.28)$。

==过渡区==：色带按内部 sigmoid gate 从 10% 变到 90% 的范围定义，约为 $[-2.20/\beta,\ 2.20/\beta]$；$\beta$ 越大，过渡越集中。曲线与导数都连续光滑。

==当输入趋向正无穷==：固定 $\beta>0$ 时，输出逐渐接近 $x$，导数趋近 1。$\beta$ 很小时，在当前的横轴范围内曲线可能仍接近 $x/2$。

SiLU 有三个性质。第一，它是非单调的，在负半轴有一个局部最小值，所以网络可以输出小的负数，而不是像 ReLU 那样输出 0。第二，它在原点附近可以展开为 $\mathrm{SiLU}(x)\approx x/2 + x^2/4$，$|x|\ll 1$ 时近似线性函数 $x/2$。第三，它的导数只依赖 $\sigma(\beta x)$ 一个中间量。实现上可以在前向存下 $\sigma$ 值，反向不再计算任何超越函数；也可以只存输入 $x$，反向重算一次 sigmoid 换取更少的显存占用。

SiLU 是通过 SwiGLU 进入主流 LLM 的。PaLM 论文引用 Shazeer 2020 的结果选用 SwiGLU，理由是它相比 ReLU、GELU、Swish 能明显提高模型质量；论文也指出 SwiGLU 的 FFN 需要三次矩阵乘法，但 Shazeer 2020 在计算量相同的对比中仍观察到了质量提升。Llama 沿用了这一选择，此后跟随 Llama 架构的模型都采用 SwiGLU。到 2026 年，SiLU 单独作为 FFN 激活的情况已经很少，它几乎总是用于 SwiGLU 的门控分支。

## GLU 家族：门控前馈网络 {#s6 toc="GLU 家族"}

SwiGLU、GeGLU、ReGLU 的区别只是 gate 用什么函数；重要的是“gate 乘以线性分支”这个结构本身。

$$
\begin{aligned}
g=xW_g,\qquad u=xW_u,&\qquad g,u\in\mathbb{R}^{d_{ff}},\\
\mathrm{GLU}_\phi(x)=\bigl(\phi(g)\odot u\bigr)W_d,&\qquad W_g,W_u\in\mathbb{R}^{d\times d_{ff}},\; W_d\in\mathbb{R}^{d_{ff}\times d}.
\end{aligned}
$$

输入 $x$ 先经过两个不同的线性投影，得到门控分支 $g$ 和线性分支 $u$，两者都是 $d_{ff}$ 维向量。对 $g$ 应用激活函数，再与 $u$ 逐元素相乘，得到中间表示 $h=\phi(g)\odot u$；最后通过 $W_d$ 将中间表示投影为输出。名字里的前缀就是门控分支所用的函数：SwiGLU 用 SiLU，GeGLU 用 GELU，ReGLU 用 ReLU。

下图对照普通 FFN 与 GLU 的一次前向计算。图中 $T$ 是序列长度。

:::llm-glu-diagram
:::

### SwiGLU 的单个通道 {#swiglu-channel}

暂时不看最后的输出投影 $W_d$，只观察逐元素相乘这一步。取出第 $i$ 个通道（维度）后，$g_i$ 和 $u_i$ 都是一个数，这个通道的输出（默认使用 SiLU）就是：

$$
h_i=\mathrm{SiLU}(g_i)\,u_i=g_i\,\sigma(g_i)\,u_i.
$$

这里的门控系数不局限于 0 到 1。$\mathrm{SiLU}(g_i)$ 可以为负，也可以大于 1，因此它既能减小信号幅度，也能翻转符号或放大信号。下面的热力图展示 $g_i$、$u_i$ 不同组合产生的 $h_i$：横轴改变门控输入 $g_i$，纵轴改变待传递的数值 $u_i$（图中省略下标，记作 g、u）。

:::llm-glu-heatmap{width=600px}
横轴是门控输入 g，纵轴是线性分支 u；每个位置的颜色表示两者相乘后的输出 SiLU(g)·u。

图中左侧颜色较浅，因为较大的负门控输入会减小输出幅度；右侧颜色更鲜明，因为 g 超过约 1.28 时 SiLU(g)>1，线性分支被放大，0<g<1.28 时线性分支仍被缩小。
:::

:::recap
SwiGLU 单个通道的输出是 $\mathrm{SiLU}(g_i)\,u_i$，门控系数可以为负，也可以大于 1。
:::

### 两个分支的梯度 {#glu-gradients}

训练时两个分支都会更新（推导过程见[SwiGLU FFN 的 Jacobian](/2026-09/matrix-calculus/#ffn-jac)）。沿用上面的 $g$、$u$，记 $h=\phi(g)\odot u$，上游梯度为 $\delta_h=\partial L/\partial h$。那么

$$
\frac{\partial L}{\partial u}=\delta_h\odot\phi(g),\qquad \frac{\partial L}{\partial g}=\delta_h\odot u\odot\frac{\partial\phi(g)}{\partial g}.
$$

$u$ 的梯度被 gate 的输出 $\phi(g)$ 缩放，$g$ 的梯度被 $u$ 缩放。如果某个通道上 $g$ 和 $u$ 同时变大，两条路径的梯度幅度就同时变大，两个分支的梯度幅度相互放大。在 SwiGLU 里 $\frac{\partial\phi(g)}{\partial g}$ 在 $g$ 很大时趋近 1，$\phi(g)\approx g$，所以在较大的正输入区域，固定任一非零分支时，输出幅度可随另一分支近似线性地无界增长，这是 2025 年之后多个模型采用输出范围限制的动机之一。

从图中还能看出两个分支的乘性交互：输出由门控分支和线性分支共同决定；当同一通道上 $g_i$、$u_i$ 同时取很大的正值时，SwiGLU 的输出近似 $g_iu_i$。如果去掉非线性调制，两个线性投影的乘积 $(xW_g)_i(xW_u)_i$ 是输入的二次型；一般的 GLU 则在乘法之前多了一个非线性函数 $\phi$。

:::recap
$u$ 的梯度被 $\phi(g)$ 缩放，$g$ 的梯度被 $u$ 缩放；两个分支同时变大时梯度幅度相互放大，SwiGLU 的输出没有上界。
:::

### 从 GLU 到 SwiGLU：历史与实验 {#glu-history toc="历史与实验"}

门控线性单元最早由 Dauphin 等人在 2016 年提出，$\phi=\sigma$。Shazeer 在 2020 年的短文[@shazeer2020]里系统地试了 $\phi$ 取 sigmoid、ReLU、GELU、Swish 以及 Bilinear（省略激活函数）的版本，发现在 T5 的设定下 GeGLU 和 SwiGLU 的预训练困惑度最低（65,536 步时 log-perplexity 分别为 1.942 和 1.944，普通 ReLU 和 GELU FFN 为 1.997 和 1.983）。论文没有给出这些变体效果更好的理论解释，结论段原话是“we attribute their success, as all else, to divine benevolence”。

:::recap
Shazeer 2020 在 T5 的设定下比较 GLU 变体，GeGLU 和 SwiGLU 的预训练困惑度最低。
:::

### 参数量的对齐：为什么 $d_{ff}$ 是 $\tfrac{8}{3}d$ {#glu-parameters toc="参数量对齐"}

GLU 比普通 FFN 多一个矩阵。为了在同参数量下比较，Shazeer 把中间维度从 $4d$ 缩到 $\tfrac{2}{3}\cdot 4d=\tfrac{8}{3}d$，这样三个矩阵的总参数量 $3\cdot d\cdot\tfrac{8}{3}d=8d^2$ 恰好等于原来两个矩阵的 $2\cdot d\cdot 4d$。Llama 沿用了这个约定，并把结果向上取整到 256 的倍数：Llama 2 7B 的 $d=4096$，$\tfrac{8}{3}d\approx10923$，取整后是 11008。看到一个模型的 `intermediate_size` 大约是 `hidden_size` 的 2.7 倍，通常可以推断它用的是 GLU 结构。反过来，用 GLU 的模型并不一定取 $\tfrac{8}{3}d$，这只是 Llama 一系的习惯：Gemma 3 4B 的 `hidden_size` 是 2560，`intermediate_size` 是 10240，也就是 GeGLU 配 $4d$ 的宽度；Gemma 4 31B 同样是 5376 对 21504，比例不变。Gemma 系列没有按同参数量去对齐，各代的比例也不统一：Gemma 1 7B 是 3072 对 24576（$8d$），Gemma 3 1B 是 1152 对 6912（$6d$）。

:::recap
$d_{ff}=\tfrac{8}{3}d$ 让三个矩阵的参数量等于普通 FFN 的 $8d^2$；这是 Llama 一系的约定，Gemma 用 $4d$ 等其他比例。
:::

### 工程实现 {#glu-implementation}

实际实现里 $W_g$ 和 $W_u$ 几乎总是被拼成一个 $d\times 2d_{ff}$ 的矩阵一次算完，激活函数和逐元素乘写在 GEMM 的 epilogue 里，或者由一个专门的 fused kernel 完成，这样中间结果不必写入显存再读回来。vLLM、SGLang、FlashInfer 这类推理框架都有 `silu_and_mul`、`gelu_and_mul` 之类的算子，名字直接对应 SwiGLU 和 GeGLU。在训练侧，反向传播需要 $\phi(g)$、$\frac{\partial\phi(g)}{\partial g}$ 和 $u$，通常只存 $g$ 和 $u$，在反向时重算 $\phi$，通过重计算减少保存激活值所需的显存。

:::recap
$W_g$ 和 $W_u$ 拼成一个矩阵一次算完，激活函数与逐元素乘在 GEMM 的 epilogue 或专门的 fused kernel 里完成。
:::

## 限制 GLU 的输出：2025–2026 年的共同选择 {#s7 toc="限制 GLU 的输出"}

gpt-oss、DeepSeek-V4、Kimi K3 都在解决同一个问题：SwiGLU 的乘积无界。

问题的表现是训练后期或者模型规模增大之后，FFN 中间层偶尔会出现极大的激活值，这类大幅值激活可能引发 loss spike[^loss-spike]。DeepSeek-V4 的技术报告[@deepseek-v4]观察到，loss spike 的出现总是与 MoE 层中的离群值相关。Kimi K3 的技术报告[@kimi-k3]指出，SwiGLU 的两个乘法因子都没有上界，同一坐标上两者同时取大值时会产生激活离群值，并增加低精度运算中的溢出风险。既然 $\phi(g)\cdot u$ 没有固定的幅度上界，那限制其中一个或两个分支的数值范围就是最直接的办法。需要区分的是，[文献中的 massive activations](https://arxiv.org/abs/2402.17762) 指少数固定维度上稳定出现的大幅值，那是模型学到的正常结构；这里要限制的是训练过程中偶发的、幅度失控的激活。

[^loss-spike]: 训练损失突然增大。

限制的办法有两种。gpt-oss 和 DeepSeek-V4 用 clamp，超过阈值的值直接取阈值；Kimi K3 用 tanh soft-capping，用第 3 节介绍的 $c\cdot\tanh(z/c)$ 把分支输出平滑地压进有限范围。gpt-oss 还在线性分支上加了一个常数 1。

### gpt-oss：clamp 加偏置 {#gpt-oss-clamp}

$$
h=\bigl(\tilde g\,\sigma(1.702\,\tilde g)\bigr)\odot\bigl(\tilde u+1\bigr),\qquad \tilde g=\min(g,7),\quad \tilde u=\mathrm{clamp}(u,-7,7).
$$

OpenAI 2025 年 8 月开源的 gpt-oss[@gpt-oss-notes] 做了三处改动。gate 分支用的是 quick GELU 形式的 $\alpha=1.702$，并且只在上方 clamp 到 7（该分支的输出在输入趋向负无穷时趋近零，因此没有设置下限）；线性分支两侧都 clamp 到 $\pm7$；线性分支还加了一个常数 1。加 1 的作用是给 gate 分支一条直接通路：输出可展开为 $\phi(\tilde g)\odot\tilde u+\phi(\tilde g)$，即使 $\tilde u=0$，gate 分支的输出 $\phi(\tilde g)$ 也能直接进入输出投影。这三处改动都是逐元素的，对内核几乎没有额外成本。Hugging Face 上的 `config.json` 里对应的字段是 `hidden_act: "silu"` 和 `swiglu_limit: 7.0`，transformers 的 `modeling_gpt_oss.py` 里的实现只有四行：`gate.clamp(max=limit)`、`up.clamp(-limit, limit)`、`glu = gate * sigmoid(gate * 1.702)`、`(up + 1) * glu`。需要注意的是，transformers 的实现不读取这两个字段：$\alpha=1.702$ 和阈值 7 都写死在代码里，实际计算的是 $x\sigma(1.702x)$，不是配置里写的 SiLU。只看配置文件会误以为 gpt-oss 用的是标准 SwiGLU。另外，gate 和 up 的权重在拼接后的矩阵中按列交错存放（代码中为 `gate_up[..., ::2]` 和 `gate_up[..., 1::2]`），而不是前后两半拼接，做权重转换时要按这个顺序拆分。

:::recap
gpt-oss 用 $x\,\sigma(1.702x)$ 作 gate，gate 分支上方 clamp 到 7，线性分支 clamp 到 $\pm7$ 并加 1；这些常数写死在 transformers 的代码里。
:::

### DeepSeek-V4：SwiGLU clamping {#deepseek-clamp}

DeepSeek-V4 的技术报告在“训练稳定性”一章里单独列出了 SwiGLU clamping，作为 loss spike 缓解手段之一。报告称，实际训练中 SwiGLU clamping 能有效消除离群值、明显提高训练稳定性，并且不损失模型性能；具体做法是把线性分支限制在 $[-10,10]$，gate 分支的上界设为 10。transformers 里 `modeling_deepseek_v4.py` 采用与 gpt-oss 相同的 clamp 方式：gate 分支 `clamp(max=limit)`，线性分支 `clamp(-limit, limit)`，然后 `act_fn(gate) * up`；区别是没有那个“加 1”，阈值由 `swiglu_limit` 控制。DeepSeek-V4-Pro 的 `config.json` 里就是 `hidden_act: "silu"`、`swiglu_limit: 10.0`，384 个路由专家取 top-6 外加 1 个共享专家。同一份配置里的 `expert_dtype: "fp4"` 表示专家权重以 FP4 存储。同一份报告还把 MoE 路由的打分函数从 V3 的 sigmoid 换成了 $\sqrt{\mathrm{softplus}(\cdot)}$（配置字段 `scoring_func: "sqrtsoftplus"`），这一改动不在 FFN 里，第 10 节讨论 softplus 时再介绍。

:::recap
DeepSeek-V4 用与 gpt-oss 相同的 clamp 方式，阈值为 10，没有“加 1”。
:::

### Kimi K3：SiTU-GLU，用 tanh 做 soft-capping {#situ-glu toc="Kimi K3：SiTU-GLU"}

$$
\mathrm{SiTU\text{-}GLU}(x)=\Bigl[\beta_1\tanh\bigl(\tfrac{g}{\beta_1}\bigr)\odot\sigma(g)\Bigr]\odot\Bigl[\beta_2\tanh\bigl(\tfrac{u}{\beta_2}\bigr)\Bigr],\qquad \beta_1=4,\;\beta_2=25.
$$

Moonshot 对两个分支都使用 tanh soft-capping。gate 分支里 SiLU 的那个 $x$ 换成了 $\beta_1\tanh(x/\beta_1)$，于是 gate 的输出被限制在 $(-\beta_1,\beta_1)$；线性分支同样用 tanh 压到 $(-\beta_2,\beta_2)$；乘积的绝对值上界就是 $\beta_1\beta_2=100$。在原点附近 $\beta\tanh(x/\beta)\approx x$，所以输入远小于 $\beta$ 时它和 SwiGLU 几乎完全一样，主要在输入绝对值较大时发生变化。相比 clamp，tanh soft-capping 的导数处处连续，饱和区域梯度按 $1-\tanh^2$ 衰减，而不是直接归零；代价是每个元素多两次 tanh。在小 batch 解码时，MoE 专家的 GEMM 受带宽限制，两次 tanh 的额外计算通常被访存时间覆盖。Kimi K3 的 `config.json` 里可以直接看到这三个值：`hidden_act: "situ"`、`activation_situ_beta: 4.0`、`activation_situ_linear_beta: 25.0`，以及 `num_experts: 896`、`num_experts_per_token: 16`。

:::llm-act-plot{fns="silu,gpt-oss-gate,situ-gate" xmax=12 ymax=12 dymax=1.5 guides=gate-clamp}
**当输入趋向负无穷**：三种 gate 的输出与导数都趋近零，但具体衰减形状不同。

**原点与过渡区**：三者输出均为 0，斜率均为 0.5；淡色带用标准 SiLU 内部 gate 的 10%–90% 区间作参照，各曲线并非完全相同。

**大正输入**：标准 SiLU 不受限制，继续近似线性增长。gpt-oss 先令 $\tilde g=\min(g,7)$，再计算 $\tilde g\,\sigma(1.702\,\tilde g)$，所以 g>7 后输出恒定约为 7、导数严格为零；g=7 处不可导，导数分支用空心圆分开表示。

**平滑饱和**：SiTU 的输出逐渐趋近 4，导数连续趋近零，没有 clamp 造成的折点。图中同时标出零附近的过渡过程与 g=7 的 clamp 位置；水平参考线表示输出上限或导数极限。
:::

:::aside{title="设计判断"}
三个模型选用的阈值是：gpt-oss 为 7，DeepSeek-V4 为 10，Kimi K3 的 gate 分支上界为 4、线性分支为 25，乘积上界为 100。阈值远大于正常激活范围时，三种方案只改变少数绝对值较大的元素。阈值要根据实际激活分布来定：阈值过小会限制表达能力，过大则无法限制极端激活值。另外，在已经训练好的 SwiGLU 模型上加 clamp 会改变函数本身，需要继续训练。
:::

:::recap
Kimi K3 用 tanh 把 gate 分支限制在 $(-4,4)$、线性分支限制在 $(-25,25)$，乘积上界为 100，导数处处连续。
:::

## Squared ReLU：正半轴上的二次激活 {#s8 toc="Squared ReLU"}

GLU 在两个分支之间引入乘法。Squared ReLU 则直接对正输入求平方，使用普通 FFN 的输入、输出两个投影矩阵。

$$
\mathrm{ReLU}^2(x)=\max(0,x)^2,\qquad \frac{d\,\mathrm{ReLU}^2(x)}{dx}=2\max(0,x).
$$

它来自 Google 2021 年的 Primer[@so2021]，那篇工作用进化搜索在 Transformer 的计算图上找改进。论文指出，Primer 的收益主要来自两处简单的修改：把 FFN 的 ReLU 平方，以及在自注意力的 Q、K、V 投影后各加一个 depthwise 卷积；其中平方 ReLU 是效果最明显的一处。它的导数是 $2\max(0,x)$，在原点连续（值为零），比 ReLU 光滑了一阶；正半轴是二次增长，大的输入会被进一步放大，这在功能上与 GLU 的乘积类似，但只需要普通 FFN 的两个矩阵。NVIDIA 从 Nemotron-4 开始一直用它：Nemotron-H 是 Mamba-2、注意力和 FFN 混合的 dense 模型，FFN 用 Squared ReLU；2025 年底的 Nemotron 3 系列改为 MoE，专家仍用 Squared ReLU，路由用 sigmoid[@nemotron]。Nemotron 3 Nano 的配置里写作 `mlp_hidden_act: "relu2"`，128 个路由专家取 top-6，外加 1 个共享专家。它同时保留了 ReLU 的精确零，所以可以采用基于零激活值的稀疏推理方法。

:::llm-act-plot{fns="relu2" reference="relu" xmin=-3 xmax=3 ymin=-0.5 ymax=6 dymin=-0.5 dymax=6}
**负半轴**：输出和导数严格为零，淡色背景表示输出为零的区域。

**原点**：输出和导数都为 0。左右导数相同，函数在原点可导，这一点与 ReLU 不同；但二阶导数左右不同，左侧为 0，右侧为 2。

**过渡区**：没有单独一段有限宽度的过渡区间，正半轴的斜率从原点开始持续增加，因此不用过渡色带。

**正半轴**：输出为 x²，导数为 2x。图中 x=2 时输出和斜率都是 4；ReLU 在同一位置的输出是 2、斜率是 1。平方激活会进一步放大大输入，也放大对应的梯度。
:::

它的局限也来自二次增长：没有任何上界，正半轴的导数随输入线性变大，对预激活值的尺度非常敏感。工程上通常靠 RMSNorm 控制输入的数值尺度，再依赖较小的初始化和 learning rate warmup；从 Nemotron 系列多年一直沿用这个选择来看，这些问题在他们的训练配置下是可控的。

## Softplus 与正值参数化 {#s9}

作为隐藏层激活它从来没流行过，但它是 ReLU 的光滑版，也是产生“保证为正”的量的标准工具。

$$
\mathrm{softplus}(x)=\log\bigl(1+e^{x}\bigr),\qquad \frac{d\,\mathrm{softplus}(x)}{dx}=\sigma(x).
$$

:::llm-act-plot{fns="softplus" reference="relu" xmin=-5 xmax=5 ymin=-0.5 ymax=5 dymin=-0.1 dymax=1.1}
**当输入趋向负无穷**：输出从正值一侧趋近零，导数也趋近零；有限输入下输出始终为正。

**原点**：输出 ln 2≈0.693，导数为 0.5。它并不经过坐标原点。

**过渡区**：导数恰好是 sigmoid。色带表示斜率从 0.1 增加到 0.9 的范围，约 [−2.20, 2.20]；输出单调增加，曲线与导数都光滑，没有局部最低点。

**当输入趋向正无穷**：输出从上方接近 y=x，导数趋近 1。它对大正输入近似线性，没有上界。
:::

它在现代架构里出现在三类位置。第一类是状态空间模型的步长：Mamba 用 $\Delta=\mathrm{softplus}(\cdot)$ 生成离散化步长，因为 $\Delta$ 必须为正，而且在大部分范围内希望它近似线性、在负半轴平滑地趋于零，而不是在零处被 clamp。第二类是可学参数的约束：需要一个保证为正的标量时，先训练一个无约束参数，再经过 softplus 使用，例如高斯分布的标准差参数，或者强化学习策略网络输出的动作方差。第三类是 2026 年新出现的用法，DeepSeek-V4 把 MoE 路由计算专家得分的函数从 sigmoid 换成了 $\sqrt{\mathrm{softplus}(\cdot)}$。从函数形状可以推测这一改动的原因：sigmoid 有上界 1，得分较高的专家在饱和区难以区分；softplus 没有上界，开方后增长比线性慢。

数值上要注意 $\log(1+e^x)$ 在 $x$ 很大时会溢出，标准实现是当 $x$ 超过某个阈值（PyTorch 默认 20）时直接返回 $x$，或者写成 $\max(x,0)+\log(1+e^{-|x|})$ 这种稳定形式。

## 近期开源模型对照表 {#s10}

按发布时间排列，最后一行合并列出其他采用 SwiGLU 的模型。“FFN 激活”一栏指 dense 层或 MoE 专家内部的激活函数，不含注意力和路由。

:::list-table
* - 模型
  - 发布
  - FFN 激活
  - 值得注意的地方
* - Grok-1
  - 2024-03 开源
  - GeGLU
  - xAI 开源的 JAX 代码里 MoE 专家用 GELU gate，与 Gemma 系列相同。
* - DeepSeek-V3 / R1
  - 2024-12 / 2025-01
  - SwiGLU
  - MoE 路由用 sigmoid 打分而非 softmax，配合无辅助 loss 的负载均衡；后来的 V3.1、V3.2 沿用。
* - Gemma 3
  - 2025-03
  - GeGLU `gelu_pytorch_tanh`
  - Gemma 系列一直用 GELU gate，且是 tanh 近似版本；Gemma 3 的 4B、12B、27B 为 $d_{ff}=4d$，1B 为 $6d$。Gemma 2 曾在 logits 上用 tanh soft-capping，Gemma 3 的配置里两个 soft-capping 字段都是 null。
* - Llama 4
  - 2025-04
  - SwiGLU
  - Llama 系列从第一代起就是 SwiGLU，$d_{ff}\approx\tfrac{8}{3}d$ 向上取整到 256 的倍数。
* - Qwen3 / Qwen3-Next / Qwen3.5
  - 2025-04 起
  - SwiGLU
  - `hidden_act: silu`。Qwen3-Next 起在注意力输出后加 sigmoid gate（gated attention），Gated DeltaNet 与门控注意力 3:1 混合（`full_attention_interval: 4`）。
* - Kimi K2
  - 2025-07
  - SwiGLU
  - DeepSeek-V3 式架构，1T 参数。
* - gpt-oss 20B / 120B
  - 2025-08
  - SwiGLU 变体
  - $\alpha=1.702$，gate 分支上方 clamp 到 7，线性分支 clamp 到 $\pm7$ 并加 1；`swiglu_limit: 7.0`。
* - Nemotron 3 Nano / Super
  - 2025-12 / 2026-03
  - Squared ReLU
  - Mamba-2 与注意力混合的 MoE，专家用 $\mathrm{ReLU}^2$（`mlp_hidden_act: relu2`），路由用 sigmoid；延续 Nemotron-4 和 Nemotron-H 的选择。
* - Cohere Tiny Aya
  - 2026-02
  - SwiGLU
  - 3.35B dense，多语言小模型。
* - Gemma 4 31B
  - 2026-03
  - GeGLU `gelu_pytorch_tanh`
  - 仍是 tanh 近似 GELU gate，$d_{ff}=4d$（5376 → 21504）；最终 logits 再次使用 soft-capping，`final_logit_softcapping: 30.0`。
* - DeepSeek-V4
  - 2026-04
  - SwiGLU + clamping
  - 与 gpt-oss 相同的 clamp 方式、无“加 1”，`swiglu_limit: 10.0`；路由打分 `scoring_func: sqrtsoftplus`；专家权重 `expert_dtype: fp4`。
* - Kimi K3
  - 2026-07
  - SiTU-GLU
  - `hidden_act: situ`，`activation_situ_beta: 4.0`，`activation_situ_linear_beta: 25.0`，乘积上界 100；896 专家激活 16 个。
* - GLM-4.5、Mistral Small 3、OLMo 2/3、SmolLM3、MiniMax-M1 等
  - 2024-11 至 2025-11
  - SwiGLU
  - Llama 式 dense 或 MoE 架构的常规选择，配置文件里写作 `hidden_act: silu`。
:::

表里引用的配置字段大多来自各模型在 Hugging Face 上的 `config.json`[@configs]，实现细节来自 transformers 对应的 `modeling_*.py`[@transformers-code]，链接在文末。表中除 Grok-1 和 Gemma 系列用 GeGLU、Nemotron 用 Squared ReLU 外，其余模型都用 SwiGLU 或它的变体。近两年的变化集中在两个方向：一是限制 GLU 的输出范围（gpt-oss、DeepSeek-V4、Kimi K3），二是回到非门控的分段二次激活（Nemotron 的 Squared ReLU）。前者的目标是训练稳定性，后者的目标是用两个投影矩阵得到二次增长的 FFN。

## 选择建议 {#s11}

没有一个函数在所有目标上都最好。下面按最常见的几种处境给出判断。

**训练常规规模的 dense 或 MoE 模型时**，可以优先评估 SwiGLU。它有最多的训练配置、最成熟的 fused kernel、最多的量化和推理框架支持，任何替代方案带来的收益都要先付出“生态不兼容”的成本。选 GeGLU 也没问题，两者的效果需在相同设置下比较，唯一要确认的是 GELU 用精确版还是 tanh 近似版，并且训练推理保持一致。

**模型规模大到开始出现 loss spike，或者 MoE 的专家稀疏度很高时**，在设计阶段就限制 GLU 的输出范围。两种方案里，clamp 实现简单、内核改动最小；tanh soft-capping 的梯度更平滑，但需要多两次超越函数，两者可以分别评估。阈值根据模型实际的激活统计确定。

**如果主要目标是降低推理成本，并且部署环境是带宽受限的**（端侧、CPU、单卡跑大模型），可以评估利用激活稀疏性减少计算和访存。从头训练可以直接用 Squared ReLU 或 dReLU；已有 SwiGLU 模型可以做 ReLUfication 微调，需要继续训练，并评估对模型质量的影响。这条路的收益完全取决于推理引擎能不能真正跳过零对应的权重，应先确认推理框架是否支持。

**做量化或者编写推理内核时**，关注的不是 loss 而是数值范围和实现细节：有界的激活（clamp 过的 GLU、SiTU）限制了离群值的幅度，Kimi K3 的技术报告把降低低精度运算中的溢出风险列为 SiTU-GLU 的动机之一；GELU 的两个版本不能混用；SiLU 的反向只依赖 sigmoid 一个中间量；Squared ReLU 的输出动态范围大，低比特激活量化要小心。

激活函数与归一化位置、初始化尺度、learning rate warmup、路由函数一起决定训练是否稳定。只替换激活函数时，loss 的变化无法归因于激活函数本身。

## 速查表与参考文献 {#s12}

### 函数速查表 {#activation-reference}

| 函数 | $f(x)$ | $\frac{df(x)}{dx}$ | 值域 | 典型位置 |
|---|---|---|---|---|
| Sigmoid | $\sigma(x)=\frac{1}{1+e^{-x}}$ | $\sigma(x)(1-\sigma(x))$ | $(0,1)$ | 各类 gate、MoE 路由 |
| Tanh | $\tanh(x)$ | $1-\tanh^2(x)$ | $(-1,1)$ | soft-capping $c\tanh(x/c)$ |
| ReLU | $\max(0,x)$ | $\mathbb{1}[x>0]$ | $[0,\infty)$ | 稀疏推理 |
| Squared ReLU | $\max(0,x)^2$ | $2\max(0,x)$ | $[0,\infty)$ | Nemotron FFN |
| GELU | $x\,\Phi(x)$ | $\Phi(x)+x\,p(x)$ | $[-0.17,\infty)$ | GeGLU 的 gate |
| SiLU | $x\,\sigma(x)$ | $\sigma(x)(1+x(1-\sigma(x)))$ | $[-0.28,\infty)$ | SwiGLU 的 gate |
| Softplus | $\log(1+e^x)$ | $\sigma(x)$ | $(0,\infty)$ | Mamba 步长、参数约束 |
| SiTU gate | $\beta_1\tanh(x/\beta_1)\,\sigma(x)$ | $(1-\tanh^2)\sigma+\beta_1\tanh\cdot\sigma(1-\sigma)$ | $\approx[-0.27,\,\beta_1)$，$\beta_1=4$ | Kimi K3 FFN |

:::recap
八个函数的公式、导数、值域和典型位置汇总在这张表里。
:::

### 参考文献 {#references}

:::references
- [@shazeer2020] Shazeer, N. [GLU Variants Improve Transformer](https://arxiv.org/abs/2002.05202), 2020.
- [@hendrycks2016] Hendrycks, D. & Gimpel, K. [Gaussian Error Linear Units (GELUs)](https://arxiv.org/abs/1606.08415), 2016.
- [@ramachandran2017] Ramachandran, P. et al. [Searching for Activation Functions](https://arxiv.org/abs/1710.05941), 2017.
- [@so2021] So, D. et al. [Primer: Searching for Efficient Transformers for Language Modeling](https://arxiv.org/abs/2109.08668), 2021.
- [@mirzadeh2024] Mirzadeh, I. et al. [ReLU Strikes Back: Exploiting Activation Sparsity in Large Language Models](https://arxiv.org/abs/2310.04564), ICLR 2024.
- [@song2024] Song, Y. et al. [Turbo Sparse: Achieving LLM SOTA Performance with Minimal Activated Parameters](https://arxiv.org/abs/2406.05955), 2024.
- [@nemotron] NVIDIA. [Nemotron 3 Nano: Open, Efficient Mixture-of-Experts Hybrid Mamba-Transformer Model](https://arxiv.org/abs/2512.20848), 2025；[Nemotron-H](https://arxiv.org/abs/2504.03624), 2025.
- [@deepseek-v4] DeepSeek. [DeepSeek-V4: Towards Highly Efficient Million-Token Context Intelligence](https://arxiv.org/abs/2606.19348), 2026.
- [@kimi-k3] Moonshot AI. [Kimi K3 技术报告](https://arxiv.org/abs/2607.24653)（[GitHub PDF](https://github.com/MoonshotAI/Kimi-K3/blob/main/k3_tech_report.pdf)）, 2026；Huang, J. [Kimi K3 技术报告解读（SiTU-GLU 公式与常数）](https://jianyuh.github.io/llm/architecture/2026/07/18/Kimi-K3.html), 2026.
- [@gpt-oss-notes] Ceramic AI. [What's actually different about GPT-OSS?](https://www.ceramic.ai/blog/gpt-oss-swiglu)；Adrian. [GPT-OSS Model](https://www.adrian.idv.hk/2026-03-25-gptoss/), 2026.
- [@qiu2025] Qiu, Z. et al. [Gated Attention for Large Language Models: Non-linearity, Sparsity, and Attention-Sink-Free](https://arxiv.org/abs/2505.06708), NeurIPS 2025.
- [@raschka] Raschka, S. [The Big LLM Architecture Comparison](https://magazine.sebastianraschka.com/p/the-big-llm-architecture-comparison), 2025；[A Dream of Spring for Open-Weight LLMs](https://magazine.sebastianraschka.com/p/a-dream-of-spring-for-open-weight), 2026.
- [@hf-docs] Hugging Face. [Gemma 文档（gelu_pytorch_tanh 说明）](https://huggingface.co/docs/transformers/model_doc/gemma)；[DeepSeek-V4 文档（swiglu_limit、scoring_func）](https://huggingface.co/docs/transformers/model_doc/deepseek_v4)。
- [@configs] 配置文件：[gpt-oss-20b](https://huggingface.co/openai/gpt-oss-20b/blob/main/config.json)、[Kimi-K3](https://huggingface.co/moonshotai/Kimi-K3/blob/main/config.json)、[Nemotron-3-Nano](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16/blob/main/config.json)、[Qwen3-Next](https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct/blob/main/config.json)、[Gemma-3-4b](https://huggingface.co/google/gemma-3-4b-it/blob/main/config.json)、[DeepSeek-V4-Pro](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/config.json)、[Gemma-4-31b](https://huggingface.co/google/gemma-4-31b-it/blob/main/config.json)、[Llama-4-Scout](https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E/blob/main/config.json)、[Kimi-K2](https://huggingface.co/moonshotai/Kimi-K2-Instruct/blob/main/config.json)、[GLM-4.5](https://huggingface.co/zai-org/GLM-4.5/blob/main/config.json)、[Nemotron-H-8B](https://huggingface.co/nvidia/Nemotron-H-8B-Base-8K/blob/main/config.json)、[DeepSeek-V3](https://huggingface.co/deepseek-ai/DeepSeek-V3/blob/main/config.json)。
- [@transformers-code] 实现代码（transformers）：[modeling_gpt_oss.py](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gpt_oss/modeling_gpt_oss.py)、[modeling_deepseek_v4.py](https://github.com/huggingface/transformers/blob/main/src/transformers/models/deepseek_v4/modeling_deepseek_v4.py)、[activations.py](https://github.com/huggingface/transformers/blob/main/src/transformers/activations.py)。
:::
