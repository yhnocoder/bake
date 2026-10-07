---
title: 块的移动
slug: blocks
layout: essay
---

:::lede
这一页用来测试编辑器里块的拖动、删除、复制和键盘移动。
:::

第一段正文。

第二段正文。

第三段正文。

## 带副标题的标题

::subtitle[副标题跟随标题]

标题之后的段落。

## 带显式 id 的标题 {#fixed-id}

第一条旁注所在的段落[^first]。

[^first]: 第一条旁注的内容。

第二条旁注所在的段落[^second]。

[^second]: 第二条旁注的内容。

:::callout{kind=note}
提示框的第一段。

提示框的第二段。
:::

:::callout{kind=tip}
只有一段的提示框。
:::

:::wide
加宽块的第一段。

加宽块的第二段。
:::

::::bento
:::card{title=甲}
第一张卡片。
:::

:::card{title=乙}
第二张卡片。
:::

:::card{title=丙}
第三张卡片。
:::
::::

- 无序列表第一项
- 无序列表第二项
- 无序列表第三项

1. 有序列表第一项
2. 有序列表第二项

| 函数 | 导数 |
| - | - |
| ReLU | 0 或 1 |
| SiLU | 平滑 |

::demo-plot{x0=0.5}

$$
\label{eq:moved}
y = \max(0, x)
$$

带块 id 的段落。 ^moved-block

> 引用块里的文字。
>
> ::source[引用的出处]

最后一段正文。
