---
title: Bake 写法一览
slug: syntax
date: 2026-10-19
summary: Bake 支持的全部 Markdown 写法。每种写法先给出原文，再给出它生成的样子。
tags: [Bake, 写法]
toc: notes
---

这篇文章列出 Bake 的全部写法。每种写法先用代码块给出 Markdown 原文，紧接着是同一段原文生成的样子。新增或修改写法时，先改这篇文章。

## 文章开头的 front matter {#front-matter toc="front matter"}

每篇文章是 `content/posts/` 下的一个文件夹，文件夹里的 `index.md` 以 front matter 开头。这篇文章的 front matter 是：

```markdown
---
title: Bake 写法一览
slug: syntax
date: 2026-10-19
summary: Bake 支持的全部 Markdown 写法。每种写法先给出原文，再给出它生成的样子。
tags: [Bake, 写法]
toc: notes
---
```

网址由 `date` 的年月和 `slug` 组成，这篇文章的网址是 `/2026-10/syntax/`。文件夹放在 `content/posts/` 下的哪一层都可以，网址不受影响。全部字段如下：

| 字段 | 必填 | 含义 |
|---|---|---|
| `title` | 是 | 文章标题。 |
| `slug` | 是 | 网址的最后一段，只能用小写字母、数字和 `-`。 |
| `date` | 是 | 写作日期，格式 `YYYY-MM-DD`，年月进入网址。 |
| `summary` | 否 | 一句摘要，用于页头导语、首页卡片、网页描述和 RSS。 |
| `category` | 站点配置了分类时必填 | 分类的 id，取自 `bake.config.js` 的 `categories`。 |
| `tags` | 否 | 标签列表，用于首页筛选。 |
| `preview` | 否 | 首页卡片的动画预览脚本，放在文章文件夹里。 |
| `cover` | 否 | 分享图片，不写时由 Bake 生成。 |
| `theme` | 否 | 主题，`essay` 或 `bento`，不写时用站点默认值。 |
| `toc` | 否 | 目录样式：`notes`、`tabs`、`dots`、`ticks`，分别是 T1 前文笔记、T2 书签索引、T3 圆点胶囊、T4 刻度线，不写时用站点默认值。 |
| `draft` | 否 | 写 `true` 时不发布，只在 `bake dev` 里显示。 |
| `page` | 否 | 纯 HTML 页面要原样发布的文件，写了它的 `index.md` 没有正文。 |

## 标题与锚点 {#headings toc="标题"}

二级标题自动编号 01、02，三级标题不编号。标题后面的花括号可以写三种属性：`#id` 固定这一节的锚点，不写时按标题文字生成；`toc` 是目录里显示的短标题；`width` 是这一节在 bento 主题里的卡片宽度，essay 主题忽略它。

```markdown
## 标题与锚点 {#headings toc="标题"}
```

### 三级标题

```markdown
### 三级标题
```

段落末尾写 `^名字`，给这一段一个锚点，页面上不显示。站内链接和 `:::embed` 都可以指向它。

```markdown
每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到。^local-grad
```

每一层的梯度都由上一层传回的梯度乘以本层的局部导数得到。^local-grad

### 小节要点 {#recap}

`:::recap` 写这一小节的要点。要点不显示在正文里，读者读过这一小节后，它出现在 T1 前文笔记目录的小节标题下面。要点里可以写行内公式和公式块。

```markdown
:::recap
梯度 $\nabla f$ 由各个偏导数组成，指向函数局部增长最快的方向。
:::
```

:::recap
梯度 $\nabla f$ 由各个偏导数组成，指向函数局部增长最快的方向。
:::

## 段落内的写法 {#inline}

粗体、斜体、删除线、重点标记、行内代码、链接和行内公式：

```markdown
激活函数 $\phi$ ==逐元素==作用，能不能融合进 GEMM 的 [epilogue](https://docs.nvidia.com/cutlass/)，要看 `act_fn` 的实现。**粗体**、*斜体* 和 ~~删除线~~ 是标准写法。
```

激活函数 $\phi$ ==逐元素==作用，能不能融合进 GEMM 的 [epilogue](https://docs.nvidia.com/cutlass/)，要看 `act_fn` 的实现。**粗体**、*斜体* 和 ~~删除线~~ 是标准写法。

链接到同一页的标题时，地址写 `#` 加锚点：

```markdown
标题的写法见[标题与锚点](#headings)。
```

标题的写法见[标题与锚点](#headings)。

## 列表与引用 {#lists}

无序列表、有序列表和嵌套列表。列表项开头可以用重点标记作为小标题：

```markdown
- ==$f(0)$ 是多少==：输入为零时是否输出零。
- ==导数在原点是否连续==：不连续意味着梯度跳变。
  - 嵌套的列表项缩进两个空格。
```

- ==$f(0)$ 是多少==：输入为零时是否输出零。
- ==导数在原点是否连续==：不连续意味着梯度跳变。
  - 嵌套的列表项缩进两个空格。

```markdown
1. 前向计算得到 loss。
2. 从 loss 开始逐层计算梯度。
3. 用梯度更新参数。
```

1. 前向计算得到 loss。
2. 从 loss 开始逐层计算梯度。
3. 用梯度更新参数。

引用块的最后一段以「— 」开头时，这一段显示为出处，页面上不显示「— 」：

```markdown
> We find that some of these variants yield quality improvements over the typically-used ReLU or GELU activations.
>
> — Shazeer, *GLU Variants Improve Transformer*, 2020
```

> We find that some of these variants yield quality improvements over the typically-used ReLU or GELU activations.
>
> — Shazeer, *GLU Variants Improve Transformer*, 2020

## 提示框与折叠块 {#aside-fold}

提示框只有一种样式，`title` 是第一行的小标题，可以不写：

```markdown
:::aside{title="阅读约定"}
本文的 $\sigma(x)$ 表示 logistic sigmoid，$\Phi(x)$ 表示标准正态分布的累积分布函数。
:::
```

:::aside{title="阅读约定"}
本文的 $\sigma(x)$ 表示 logistic sigmoid，$\Phi(x)$ 表示标准正态分布的累积分布函数。
:::

```markdown
:::aside
没有小标题的提示框。
:::
```

:::aside
没有小标题的提示框。
:::

折叠块默认收起，点标题展开：

```markdown
:::fold{title="推导：GELU 的导数"}
对 $x\Phi(x)$ 用乘积法则，得到 $\Phi(x) + x\varphi(x)$，其中 $\varphi$ 是标准正态分布的密度函数。
:::
```

:::fold{title="推导：GELU 的导数"}
对 $x\Phi(x)$ 用乘积法则，得到 $\Phi(x) + x\varphi(x)$，其中 $\varphi$ 是标准正态分布的密度函数。
:::

块可以互相包含。外层的冒号要比内层多：

```markdown
::::fold{title="实现细节"}
:::aside{title="注意"}
融合内核要求激活函数是逐元素的。
:::
::::
```

::::fold{title="实现细节"}
:::aside{title="注意"}
融合内核要求激活函数是逐元素的。
:::
::::

## 旁注 {#sidenotes}

旁注用标准脚注写法。正文里显示编号，旁注显示在右侧，和编号所在的那一行对齐；窄屏时点编号在段落下方展开。旁注里可以写公式和链接。

```markdown
推理时这个逐元素操作要能融合进 GEMM 的 epilogue[^gemm]，不额外占带宽。soft-capping 把输出平滑地限制在 $\pm c$ 之内[^cap]。

[^gemm]: epilogue 是矩阵乘法内核里对结果逐元素处理的阶段。在这里做激活，结果不需要写回显存再读一次。
[^cap]: 做法是 $c \cdot \tanh(x / c)$，见[段落内的写法](#inline)里的例子。
```

推理时这个逐元素操作要能融合进 GEMM 的 epilogue[^gemm]，不额外占带宽。soft-capping 把输出平滑地限制在 $\pm c$ 之内[^cap]。

[^gemm]: epilogue 是矩阵乘法内核里对结果逐元素处理的阶段。在这里做激活，结果不需要写回显存再读一次。
[^cap]: 做法是 $c \cdot \tanh(x / c)$，见[段落内的写法](#inline)里的例子。

## 参考文献 {#citations}

正文里写 `[@名字]`，页面上按第一次出现的顺序编号为 [1]、[2]。列表写在 `:::references` 里，引用了列表中没有的名字时构建报错。

```markdown
门控形式能在同参数量下压低 loss [@shazeer2020]，GELU 的定义见 [@gelu]。

:::references
- [@shazeer2020] Shazeer. *GLU Variants Improve Transformer*. 2020.
- [@gelu] Hendrycks, Gimpel. *Gaussian Error Linear Units*. 2016.
:::
```

门控形式能在同参数量下压低 loss [@shazeer2020]，GELU 的定义见 [@gelu]。

:::references
- [@shazeer2020] Shazeer. *GLU Variants Improve Transformer*. 2020.
- [@gelu] Hendrycks, Gimpel. *Gaussian Error Linear Units*. 2016.
:::

## 公式与公式宏 {#math}

行内公式写在 `$…$` 里，独立公式写在 `$$` 之间，都在生成时排好版。写了 `\label` 的公式在右边显示编号，正文里用 `\eqref` 引用它。

```markdown
$$
\mathrm{FFN}(x) = \phi(xW_1 + b_1)\,W_2 + b_2 \label{eq:ffn}
$$

由式 \eqref{eq:ffn} 可知，FFN 的参数集中在 $W_1$ 和 $W_2$ 里。
```

$$
\mathrm{FFN}(x) = \phi(xW_1 + b_1)\,W_2 + b_2 \label{eq:ffn}
$$

由式 \eqref{eq:ffn} 可知，FFN 的参数集中在 $W_1$ 和 $W_2$ 里。

多行公式用 `aligned` 等 MathJax 支持的环境：

```markdown
$$
\begin{aligned}
\mathrm{GELU}(x) &= x\,\Phi(x) \\
&\approx 0.5x\left(1 + \tanh\left[\sqrt{2/\pi}\,(x + 0.044715x^3)\right]\right)
\end{aligned}
$$
```

$$
\begin{aligned}
\mathrm{GELU}(x) &= x\,\Phi(x) \\
&\approx 0.5x\left(1 + \tanh\left[\sqrt{2/\pi}\,(x + 0.044715x^3)\right]\right)
\end{aligned}
$$

全站共用的公式宏写在博客根目录的 `preamble.sty` 里，所有文章都能用：

```latex
\ProvidesPackage{preamble}
\RequirePackage{amsmath}

\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator{\softmax}{softmax}
\newcommand{\norm}[1]{\lVert #1 \rVert}
```

```markdown
设 $x \in \R^d$，$p = \softmax(z)$，$\norm{x}$ 是 $x$ 的范数。
```

设 $x \in \R^d$，$p = \softmax(z)$，$\norm{x}$ 是 $x$ 的范数。

## 代码 {#code}

代码块按语言高亮，颜色取主题变量，深色模式自动切换：

````markdown
```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down
```
````

```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down
```

最长一行放不下正文宽时，代码块扩展到 wide；还放不下就在块内横向滚动：

````markdown
```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down  # one GEMM for gate and up, then the elementwise product runs in the epilogue
```
````

```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down  # one GEMM for gate and up, then the elementwise product runs in the epilogue
```

## 表格与 list-table {#tables}

单元格里只有单行内容时用竖线表格，单元格里可以写行内公式、图片和链接。表格的自然宽度超过正文时扩展到 wide。

```markdown
| 模型 | 激活函数 | 上界 | $d_{ff} / d$ | 参数量 | 发布 |
|---|---|---|---|---|---|
| Llama 3 8B | SwiGLU | 无 | 3.5 | 8B | 2024-04 |
| gpt-oss-120b | SwiGLU + clamp | $\pm 7$ | — | 117B | 2025-08 |
| Nemotron | Squared ReLU | 无 | — | — | — |
```

| 模型 | 激活函数 | 上界 | $d_{ff} / d$ | 参数量 | 发布 |
|---|---|---|---|---|---|
| Llama 3 8B | SwiGLU | 无 | 3.5 | 8B | 2024-04 |
| gpt-oss-120b | SwiGLU + clamp | $\pm 7$ | — | 117B | 2025-08 |
| Nemotron | Squared ReLU | 无 | — | — | — |

公式里的 `|` 直接写，不需要写成 `\|`：

```markdown
| 范数 | 定义 |
|---|---|
| L1 | $|x|_1 = \sum_i |x_i|$ |
| L2 | $\norm{x}_2 = \sqrt{\sum_i x_i^2}$ |
```

| 范数 | 定义 |
|---|---|
| L1 | $|x|_1 = \sum_i |x_i|$ |
| L2 | $\norm{x}_2 = \sqrt{\sum_i x_i^2}$ |

单元格里要放列表、多段文字、代码或公式块时，用 `:::list-table`。每个顶层列表项是一行，它下面的子项是这一行的单元格，第一行是表头。各行的单元格数必须相同。

```markdown
:::list-table
* - 激活函数
  - 公式
  - 特点
  - 曲线
* - ReLU
  - $\max(0, x)$
  - - 计算只需要一次比较
    - 负半轴梯度为 0
  - ![](relu.svg){width=64px}
* - GELU
  - $x\Phi(x)$
  - 在 0 附近平滑。

    定义见[公式与公式宏](#math)。
  - ![](gelu.svg){width=64px}
:::
```

:::list-table
* - 激活函数
  - 公式
  - 特点
  - 曲线
* - ReLU
  - $\max(0, x)$
  - - 计算只需要一次比较
    - 负半轴梯度为 0
  - ![](relu.svg){width=64px}
* - GELU
  - $x\Phi(x)$
  - 在 0 附近平滑。

    定义见[公式与公式宏](#math)。
  - ![](gelu.svg){width=64px}
:::

## 图片与浮动 {#images}

图片放在和交互组件相同的图框里，引号里的文字是图注。图片文件放在文章文件夹里。

```markdown
![FFN 的形状](ffn-shapes.svg "FFN 中间层的形状：先升维到 $d_{ff}$，再降回 $d$。")
```

![FFN 的形状](ffn-shapes.svg "FFN 中间层的形状：先升维到 $d_{ff}$，再降回 $d$。")

图片后面紧跟 `{…}` 指定尺寸和浮动。`width` 和 `height` 写像素或百分比（相对正文宽度），只写一个时另一个按原始比例。

```markdown
![神经元](neuron.svg){width=50%}
```

![神经元](neuron.svg){width=50%}

`float=left` 或 `float=right` 时图片靠一边，文字环绕在另一边，图片最宽为正文的一半。新的浮动图片和紧跟它的段落从前面所有浮动图片的下方开始；窄于 600px 时浮动取消。

```markdown
![ReLU](relu.svg){width=280px float=left}
ReLU 在负半轴输出 0，正半轴原样输出输入。它的导数在原点不连续，左边是 0，右边是 1。

![GELU](gelu.svg){width=280px float=right}
GELU 用标准正态分布的累积分布函数给输入加权，曲线在 0 附近是平滑的，负半轴有一小段负值。两者在正半轴几乎重合，差别集中在 0 附近和负半轴。
```

![ReLU](relu.svg){width=280px float=left}
ReLU 在负半轴输出 0，正半轴原样输出输入。它的导数在原点不连续，左边是 0，右边是 1。

![GELU](gelu.svg){width=280px float=right}
GELU 用标准正态分布的累积分布函数给输入加权，曲线在 0 附近是平滑的，负半轴有一小段负值。两者在正半轴几乎重合，差别集中在 0 附近和负半轴。

## 宽度写法 {#width width=wide}

公式、代码、表格、图片和交互组件默认按内容决定宽度：放得下就和正文同宽，放不下就扩展到 wide，还放不下就在块内横向滚动。只有在自动的结果不合适时，才用 `:::{width=…}` 把块包起来，`width` 取 `body`、`wide` 或 `page`。这一章的标题写了 `{width=wide}`，在 bento 主题里占两列。

```markdown
:::{width=page}
| 激活函数 | 有界 | 光滑 | 单调 | 零点输出 | 负半轴 | 门控 | 常见模型 |
|---|---|---|---|---|---|---|---|
| ReLU | 否 | 否 | 是 | 0 | 0 | 否 | Transformer (2017) |
| GELU | 否 | 是 | 否 | 0 | 小的负值 | 否 | BERT、GPT-2 |
| SwiGLU | 否 | 是 | 否 | 0 | 小的负值 | 是 | PaLM、Llama |
:::
```

:::{width=page}
| 激活函数 | 有界 | 光滑 | 单调 | 零点输出 | 负半轴 | 门控 | 常见模型 |
|---|---|---|---|---|---|---|---|
| ReLU | 否 | 否 | 是 | 0 | 0 | 否 | Transformer (2017) |
| GELU | 否 | 是 | 否 | 0 | 小的负值 | 否 | BERT、GPT-2 |
| SwiGLU | 否 | 是 | 否 | 0 | 小的负值 | 是 | PaLM、Llama |
:::

````markdown
:::{width=body}
```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down  # stays at body width and scrolls inside the block
```
:::
````

:::{width=body}
```python
def swiglu(x, w_gate, w_up, w_down):
    return (F.silu(x @ w_gate) * (x @ w_up)) @ w_down  # stays at body width and scrolls inside the block
```
:::

```markdown
:::{width=wide}
![FFN 的形状](ffn-shapes.svg "加宽到 wide 的图片。")
:::
```

:::{width=wide}
![FFN 的形状](ffn-shapes.svg "加宽到 wide 的图片。")
:::

包住的块本身是 `:::` 块时，外层的冒号要多一个：

```markdown
::::{width=wide}
:::list-table
* - 宽度
  - 范围
* - `body`
  - 正文栏，820px。
* - `wide`
  - 正文加旁注栏，1100px。
* - `page`
  - 整个版面，1340px。
:::
::::
```

::::{width=wide}
:::list-table
* - 宽度
  - 范围
* - `body`
  - 正文栏，820px。
* - `wide`
  - 正文加旁注栏，1100px。
* - `page`
  - 整个版面，1340px。
:::
::::

## 交互组件 {#components}

交互组件是博客 `components/` 下的 custom element，名字里必须有 `-`。参数写在花括号里，没写的用默认值；开头和结尾之间的文字是图注。组件只有块写法。

```markdown
:::act-fn-plot{fn=gelu}
实线是精确 GELU，虚线是两种近似。拖动「横轴范围」查看差异。
:::
```

:::act-fn-plot{fn=gelu}
实线是精确 GELU，虚线是两种近似。拖动「横轴范围」查看差异。
:::

不需要图注时，中间空着。组件本身就是 `:::` 块，宽度直接写在花括号里：

```markdown
:::act-fn-plot{fn=silu range=6 beta=2 width=body}
:::
```

:::act-fn-plot{fn=silu range=6 beta=2 width=body}
:::

`height` 覆盖组件声明的占位高度：

```markdown
:::glu-heatmap{height=420}
颜色表示 GLU 门控后的输出。
:::
```

:::glu-heatmap{height=420}
颜色表示 GLU 门控后的输出。
:::

## 站内链接与嵌入 {#links}

链接到另一篇文章时，地址写目标文章的网址加锚点。锚点可以是标题的 `#id`，也可以是段落的 `^名字`。读者鼠标停在站内链接上时显示预览卡。

```markdown
SwiGLU 的反向传播同样遵循[链式法则](/2026-10/syntax-linked/#chain-rule)，门控的梯度按[这一段](/2026-10/syntax-linked/#local-grad)的方法计算。整篇文章见[被引用的文章](/2026-10/syntax-linked/)。
```

SwiGLU 的反向传播同样遵循[链式法则](/2026-10/syntax-linked/#chain-rule)，门控的梯度按[这一段](/2026-10/syntax-linked/#local-grad)的方法计算。整篇文章见[被引用的文章](/2026-10/syntax-linked/)。

`:::embed` 把其他文章的内容嵌入这里，每行写一个地址。地址指向标题时嵌入整节，到下一个同级标题为止；指向段落锚点时只嵌入这一段。

```markdown
:::embed
/2026-10/syntax-linked/#chain-rule
/2026-10/syntax-linked/#vjp
:::
```

:::embed
/2026-10/syntax-linked/#chain-rule
/2026-10/syntax-linked/#vjp
:::

```markdown
:::embed
/2026-10/syntax-linked/#topo-order
:::
```

:::embed
/2026-10/syntax-linked/#topo-order
:::

## 附录：构建报错的写法 {#errors}

下面的写法会让 `bake build` 报错并且不写出 `dist/`。报错格式是 `文件:行:列 说明`，全部检查完后一起报告。每一行在 `test/fixtures/syntax-errors/` 里有对应的测试文件。

| 写错的地方 | 原文 | 报错 |
|---|---|---|
| front matter 缺少必填字段 | 没有 `slug:` 一行 | `front matter is missing "slug"` |
| slug 含有不允许的字符 | `slug: LLM_Act` | `slug "LLM_Act" may only contain lowercase letters, digits and "-"` |
| front matter 有不认识的字段 | `layout: wide` | `unknown front matter field "layout"` |
| toc 取值不对 | `toc: sidebar` | `toc must be notes, tabs, dots or ticks, got "sidebar"` |
| 同一页的锚点重复 | 两个标题都写 `{#intro}` | `duplicate anchor "intro", first defined at 7:7` |
| 标题有不认识的属性 | `## 引言 {color=red}` | `unknown attribute "color" on heading` |
| 不认识的块 | `:::warning` | `unknown block ":::warning"` |
| 宽度取值不对 | `:::{width=full}` | `width must be body, wide or page, got "full"` |
| 脚注没有定义 | `[^gemm]` 没有对应的 `[^gemm]:` | `footnote "gemm" has no definition` |
| 引用了列表里没有的文献 | `[@vaswani2017]` | `citation "vaswani2017" is not in :::references` |
| 引用了不存在的公式编号 | `\eqref{eq:fnn}` | `\eqref{eq:fnn} refers to an unknown \label` |
| list-table 各行单元格数不同 | 第二行只有两个单元格 | `list-table row 2 has 2 cells, the header row has 3` |
| 图片宽度写了宽度档 | `{width=wide}` 写在图片后面 | `image width must be pixels or a percentage, got "wide"; use :::{width=wide} around the image` |
| 组件参数名写错 | `:::act-fn-plot{bta=2}` | `unknown parameter "bta" for act-fn-plot` |
| 组件参数超出范围 | `:::act-fn-plot{range=20}` | `parameter "range" of act-fn-plot must be between 1 and 10, got 20` |
| 站内链接的目标不存在 | `[链式法则](/2026-10/syntax-linked/#chain)` | `link target /2026-10/syntax-linked/#chain does not exist` |
| 嵌入本文自己 | `:::embed` 里写本文的地址 | `:::embed cannot embed the article itself` |
| 同一个地址写两次 | `:::embed` 里两行相同 | `:::embed lists /2026-10/syntax-linked/#vjp twice` |
| 一个地址包含另一个 | 同时写 `#chain-rule` 和它里面的 `#local-grad` | `:::embed address /2026-10/syntax-linked/#chain-rule contains /2026-10/syntax-linked/#local-grad` |
