---
title: 写交互组件
slug: components
date: 2026-10-20
summary: 交互组件的文件、参数和布局怎么写，部件库 bake/kit 里每个部件的用法，以及参数和组件内部状态的配合方式。
tags: [Bake, 组件]
category: writing
---

交互组件是文章里可以操作的图。它是一个 JavaScript 文件，文章用一个 `:::` 块显示它。这篇文章从一个完整的组件讲起，再逐个介绍部件库 `bake/kit` 里的部件。文章里怎么摆放组件，例如宽度、高度和图注，见[写法一览的交互组件一章](/2026-10/syntax/#交互组件)。

## 一个完整的组件

下面的组件画出 softmax 在不同温度下的分布。拖动滑块改变温度：

:::softmax-bars{logits="2, 1, 0.5, -1"}
四个 token 的概率。温度越低，最大的 logit 占的概率越多。
:::

它的文件是 `components/softmax-bars.jsx`，放在这篇文章的文件夹里，所以只有这篇文章能用：

```jsx
import { createEffect, createMemo, createSignal, For } from 'solid-js'
import { Controls, Slider, formatNumber } from 'bake/kit'
import './softmax-bars.css'

export const params = {
  logits: { label: 'logits', type: 'numbers', min: -10, max: 10, default: [2, 1, 0.5, -1] },
  temperature: { label: '初始温度', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
}

export const layout = { placeholder: { narrow: 250, wide: 230 } }

function softmax(logits, temperature) {
  const scaled = logits.map((z) => z / temperature)
  const top = Math.max(...scaled)
  const weights = scaled.map((z) => Math.exp(z - top))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

export default function SoftmaxBars(props) {
  const [temperature, setTemperature] = createSignal(props.temperature)
  createEffect(() => setTemperature(props.temperature))
  const probabilities = createMemo(() => softmax(props.logits, temperature()))
  return (
    <div class="softmax-bars">
      <Controls>
        <Slider label="温度 T" min={0.1} max={5} step={0.1} value={temperature()} onInput={setTemperature} />
      </Controls>
      <div class="softmax-bars-plot">
        <For each={probabilities()}>
          {(p, index) => (
            <div class="softmax-bars-column">
              <span class="softmax-bars-value">{formatNumber(p, 2)}</span>
              <div class="softmax-bars-bar" style={{ height: `${p * 110}px`, background: `var(--series-${index() + 1})` }} />
              <span class="softmax-bars-label">z = {formatNumber(props.logits[index()], 1)}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
```

文件由四部分组成：

- 默认导出是组件本身。这里是一个 [SolidJS](https://www.solidjs.com/) 组件，它收到的 `props` 就是参数的值。默认导出也可以是继承 `HTMLElement` 的类，见[不用 SolidJS 的组件](#不用-solidjs-的组件)。
- `params` 声明文章可以设置的参数。文章里的 `logits="2, 1, 0.5, -1"` 设置了 `logits`，没写的 `temperature` 取默认值 1。
- `layout` 声明组件在页面上的框，这里只声明了加载前占位框的高度。
- 组件可以引入 CSS 文件、博客里的其他文件和博客安装的 npm 包。Bake 把每个组件打包成单独的脚本，只有用到它的页面才下载。

文件名就是组件名，也是文章里块的名字。组件名用小写字母和数字，至少有一个 `-`。所有文章都能用的组件放在博客根目录的 `components/` 下，只有一篇文章用的组件放在这篇文章文件夹的 `components/` 下。

## 参数

`params` 的每一项是一个参数。每个参数都有 `label`、`type` 和 `default`：`label` 是 `bake dev` 参数栏里控件旁边的文字，`type` 是类型，`default` 是文章不写这个参数时的值。

:::list-table
- - 类型
  - 文章里的写法
  - 组件收到的值
  - 其他字段
- - `number`
  - `range=6`
  - 数
  - `min`、`max`、`step`，都可以不写
- - `numbers`
  - `logits="2, 1, 0.5"`，数之间用逗号分开
  - 数的列表，例如 `[2, 1, 0.5]`
  - `min`、`max`，每个数都要在这个范围里
- - `text`
  - `title="两个词"`，有空格时加引号
  - 字符串
  -
- - `boolean`
  - `zoom` 或 `zoom=true` 是真，`zoom=false` 是假
  - `true` 或 `false`
  -
- - `enum`
  - `fn=silu`
  - 字符串
  - `options`，可选值的列表
- - `file`
  - `data=points.json`，文章文件夹里的文件
  - 发布后这个文件的地址
  -
:::

Bake 在生成时读 `params` 和 `layout`，不运行文件，所以两者都要写成 `export const` 和字面量：字符串、数、`true`、`false`、`null`、列表、对象、不含 `${…}` 的模板字符串，以及同一个文件里值为这些的 `const` 常量名。函数调用、算式和引入的名字都会报错。`width`、`height`、`id` 和 `class` 不能做参数名。

在 `bake dev` 里，每个组件上方有一个参数栏：数显示为数字框，声明了 `min` 和 `max` 时旁边有滑块；`numbers`、`text` 和 `file` 显示为文本框；`enum` 显示为下拉列表；`boolean` 显示为开关。改动控件时组件立刻更新，Write to file 把新值写回 `index.md` 里这个组件的 `:::` 行。

## 布局

`layout` 描述组件在页面上的框，三个字段都可以不写：

| 字段 | 含义 |
|---|---|
| `width` | `body`、`wide`、`page`，像素宽度如 `560px`，或正文栏宽度的百分比，最多 `100%`。默认是 `body`。 |
| `height` | 像素数，或 `{ ratio }`，表示宽度除以高度。写了它，组件的框在每种屏幕宽度下都是这个高度，适合按框的大小画图的组件，例如热力图。 |
| `placeholder` | 没有 `height` 的组件加载前占位框的高度：`{ narrow, wide }`，分别是窄于 600 像素和 600 像素以上的屏幕。写得接近内容的高度，组件加载时页面就不会跳动。 |
| `frame` | 写 `false` 时不画主题给组件加的边框和背景。 |

没有 `height` 的组件加载后和它的内容一样高，所以组件要自己适应各种宽度。上面的 softmax 柱状图用 CSS grid 让每根柱子平分宽度。

## 参数和组件内部的状态

参数栏是写作者调参用的，组件里的滑块是给读者用的。两者控制同一个值时，组件用参数作为初始值，再保存一份自己的状态：

```jsx
const [temperature, setTemperature] = createSignal(props.temperature)
createEffect(() => setTemperature(props.temperature))
```

只写第一行时，`createSignal` 只在组件启动时读一次 `props.temperature`，之后在参数栏里改「初始温度」，组件不会变。第二行让参数每次改变时都把内部的值重置为参数的值。读者拖动滑块只改内部的值，不改参数。

组件不需要读者操作的值，直接读 `props`，不要再保存一份：上面的 `props.logits` 就是这样用的。

## 部件库 bake/kit

`bake/kit` 是 Bake 提供的 SolidJS 部件。它们的颜色和字体来自主题的 CSS 变量，切换深色模式时跟着变化。部件库是可选的。

下面的组件用到了控件、函数图和图例。切换函数、打开导数，指针停在图上读出数值：

:::kit-plot
:::

```jsx
import { createEffect, createSignal, Show } from 'solid-js'
import { Axes, Controls, Crosshair, Curve, Legend, Plot, Segmented, Toggle } from 'bake/kit'

const NAMES = ['tanh', 'sigmoid', 'softplus']

const FUNCTIONS = {
  tanh: { tex: '\\tanh x', f: Math.tanh, d: (x) => 1 - Math.tanh(x) ** 2 },
  sigmoid: { tex: '\\sigma(x)', f: (x) => 1 / (1 + Math.exp(-x)), d: (x) => Math.exp(-x) / (1 + Math.exp(-x)) ** 2 },
  softplus: { tex: '\\log(1 + e^x)', f: (x) => Math.log1p(Math.exp(x)), d: (x) => 1 / (1 + Math.exp(-x)) },
}

export const params = {
  fn: { label: '函数', type: 'enum', options: NAMES, default: 'tanh' },
  range: { label: '横轴范围 ±', type: 'number', min: 1, max: 10, step: 1, default: 4 },
}

export const layout = { placeholder: { narrow: 330, wide: 330 } }

export default function KitPlot(props) {
  const [chosen, setChosen] = createSignal(props.fn)
  createEffect(() => setChosen(props.fn))
  const [derivative, setDerivative] = createSignal(false)
  const fn = () => FUNCTIONS[chosen()]
  return (
    <div>
      <Controls>
        <Segmented label="函数" options={NAMES} value={chosen()} onChange={setChosen} />
        <Toggle label="导数" checked={derivative()} onChange={setDerivative} />
      </Controls>
      <Legend items={[{ color: 'var(--series-1)', tex: fn().tex }, ...(derivative() ? [{ color: 'var(--series-2)', dashed: true, label: '导数' }] : [])]} />
      <Plot x={[-props.range, props.range]} y={[-1.5, 2.5]} height={240} label={`${chosen()} 的曲线`}>
        <Axes />
        <Curve f={fn().f} color="var(--series-1)" label={`$${fn().tex}$`} />
        <Show when={derivative()}>
          <Curve f={fn().d} color="var(--series-2)" dashed label="导数" />
        </Show>
        <Crosshair />
      </Plot>
    </div>
  )
}
```

### 控件

| 部件 | 属性 | 说明 |
|---|---|---|
| `Controls` | 子元素 | 把一组控件排成一行，放不下时换行。 |
| `Slider` | `label`、`min`、`max`、`step`、`value`、`onInput`、`format` | 滑块，右边显示当前值。`onInput` 收到新的数。`format` 把数变成显示的文字，不写时按 `step` 的小数位数显示。 |
| `Segmented` | `label`、`options`、`value`、`onChange` | 一组互斥的按钮。`options` 的每一项是字符串，或 `{ value, label }`。 |
| `Toggle` | `label`、`checked`、`onChange` | 开关。`onChange` 收到 `true` 或 `false`。 |
| `Button` | `onClick`、`disabled`、子元素 | 按钮。 |

### 函数图

`Plot` 是一张 SVG 图，`Axes`、`Curve` 和 `Crosshair` 写在它里面。

| 部件 | 属性 | 说明 |
|---|---|---|
| `Plot` | `x`、`y`、`width`、`height`、`margin`、`label` | `x` 和 `y` 是两个轴的范围，例如 `[-4, 4]`。不写 `width` 或 `height` 时，图填满外面的框。`label` 是给屏幕阅读器的说明。 |
| `Axes` | `grid` | 刻度和网格，范围包含 0 时画出坐标轴。`grid={false}` 不画网格。 |
| `Curve` | `f`、`color`、`dashed`、`label`、`samples`、`breaks` | 函数 `f` 的曲线。`label` 是悬停读数里的名字，可以带 `$…$` 公式。`breaks` 是曲线断开的横坐标列表。 |
| `Crosshair` | `xLabel`、`xDigits`、`yDigits` | 指针停在图上时的竖线、交点和读数。 |
| `usePlot()` |  | 在 `Plot` 里面自己画图时，用它取得比例尺 `x()`、`y()` 和绘图区 `area()`。 |

### 图例与颜色

| 部件 | 属性 | 说明 |
|---|---|---|
| `Legend` | `items` | 图例。每一项是 `{ color, label }`，或用 `tex` 代替 `label` 显示公式，`dashed` 画成虚线。 |
| `Swatch` | `color`、`dashed` | 图例里的一小段色条。 |
| `divergingColors(element)` |  | 返回一个函数，把 −1 到 1 的值映射到主题的发散色 `--diverge-low`、`--diverge-mid`、`--diverge-high`，结果是 `[红, 绿, 蓝]`。 |

系列颜色用 `var(--series-1)` 到 `var(--series-7)`，文字颜色用 `var(--ink)`、`var(--ink-2)` 和 `var(--ink-3)`。

### 公式

公式用 `preamble.sty` 里的宏，和正文相同。

| 部件 | 属性 | 说明 |
|---|---|---|
| `Tex` | `tex`、`display`、`label` | 在 HTML 里排一个公式。 |
| `SvgTex` | `tex`、`x`、`y`、`anchor`、`baseline` | 在 SVG 里排一个公式。`anchor` 是 `start`、`middle` 或 `end`。 |
| `MathText` | `text` | 一行文字，`$…$` 之间是行内公式，`$$…$$` 之间是独立公式。 |
| `SvgMathText` | `text`、`x`、`y`、`anchor`、`within` | SVG 里的一行带公式的文字。`within={[left, right]}` 把文字左右移动，保持在两个横坐标之间。 |

不用 SolidJS 的组件用 `bake/kit` 的 `typeset(element)` 排公式：它把元素里文字中的 `$…$` 和 `$$…$$` 换成公式，排法和 `MathText` 相同，返回一个在全部公式排好后完成的 Promise。没有配对的 `$` 和 SVG 里的文字保持不变。`bake/math` 还导出 `texToSvg(formula, { display })`，它把一个公式排成 SVG 元素。

### 数值、尺寸和动画

| 函数 | 说明 |
|---|---|
| `linearScale(domain, range)` | 线性比例尺，`scale.invert` 是它的反函数。 |
| `niceTicks(low, high, count)` | 大约 `count` 个整齐的刻度，每个刻度是 `{ value, label }`。 |
| `samplePath(f, domain, x, y, samples, breaks)` | 把函数采样成 SVG 路径。 |
| `formatNumber(value, digits)` | 按小数位数显示数，负号用 −。 |
| `stepDigits(step)` | 步长的小数位数。 |
| `createElementSize(() => element)` | 元素大小的 signal，值是 `{ width, height }`。 |
| `createTween(() => target, { duration })` | 目标值变化时平滑过渡的 signal，读者要求减少动画时直接跳到目标值。 |
| `prefersReducedMotion()` | 读者是否要求减少动画。 |

## 不用 SolidJS 的组件

默认导出是继承 `HTMLElement` 的类时，Bake 把它注册为同名的 custom element。组件连接到页面时，参数的值在 `this.params` 里。参数改变时，Bake 重新设置 `this.params`，并调用元素的 `update()` 方法（如果有）。[写法一览](/2026-10/syntax/#交互组件)里的柱状图就是这样写的，它只用了部件库里计算刻度的 `niceTicks`。
