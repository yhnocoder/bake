# Article page mock

A hand-built mock of the Bake article page (essay theme), made from two real articles of the old blog
`learn_by_visualization`:

- `topics/llm-act-fns/index.html` → `content/posts/llm-act-fns/index.md`
- `topics/matrix-calculus/deep-learning.html` → `content/posts/matrix-calculus/index.md`

The mock checks, before any generator code exists, how the design canvas "Bake 重新设计线稿" looks with real
content: fonts, line length, the three-column grid, the body / wide / page widths, the four TOC styles,
numbered sidenotes, internal link previews, components, dark mode, phones and print.

Nothing here is Bake code. `scripts/` is a throwaway renderer that turns the Markdown into static HTML so the
long articles are not transcribed by hand twice. The Markdown files and `components/` follow the Bake syntax
and the component contract, so the migration of the blog can reuse them.

## Commands

```sh
npm install
npm run build          # Markdown → dist/, then Vite bundles the page code and components
npm run serve          # serves dist/ on http://127.0.0.1:4173
npm run shots          # Playwright screenshots: 1440, 1024, 375 px, light and dark, into shots/
```

## Layout

| Path | What it is |
|---|---|
| `content/posts/<folder>/index.md` | An article. Images and data sit next to it. |
| `preamble.sty` | Math macros shared by all articles. |
| `components/<name>.jsx` or `.js` | One component per file; the file name is the element name and the directive name. |
| `components/lib/` | Shared code imported by components. Not components. |
| `page/` | Hand-written page shell: CSS, TOC styles, sidenote layout, link preview, component runtime. |
| `scripts/` | The mock renderer, the static server and the screenshot script. |

## Syntax used by the articles

Most items below come from a canvas board (in brackets). Where the articles needed something the canvas does
not cover, Linda or the coordinator decided it on 2026-10-19 after the first review of the mock; those items
have no board number. What is still open is listed at the end.

- Front matter (01-2): `title`, `slug`, `date`, `summary`, `tags`, `toc`. URL is `/YYYY-MM/slug/`.
  `toc` is `notes`, `tabs`, `dots` or `ticks` for T1 to T4.
- T1 notes (Linda, 2026-10-19 14:00): a `:::recap` block inside a `###` section holds that section's
  summary. It is not shown in the body, only under the section title in the T1 TOC, and may contain math.
- Headings (02-2): `##` chapters are numbered 01, 02 automatically; `###` sections are not numbered.
  `{#id}` fixes the anchor; `{toc="short title"}` sets the TOC text.
- Inline (02-2): `==mark==`, links, inline code, `$math$`, `**bold**`, `*italic*`.
- Chapter subtitles are the first paragraph of the chapter.
- Lists and quotes (02-2): a quote whose last paragraph starts with `— ` shows that paragraph as the source.
- Callout (02-2): `:::aside{title="阅读约定"}` … `:::`. One style only. Short notes that the old blog wrote as
  quotes use `:::aside` too.
- Fold (02-2): `:::fold{title="推导：GELU 的导数"}` … `:::`. Closed by default.
- Citations (02-2): `[@key]` in text, the list in `:::references` with items `- [@key] text`.
  Numbered [1], [2] by first use. Entries the text never cites are listed after the numbered ones without a
  number. Right after a heading, `:::references` omits its own 「参考文献」 label.
- Display math (02-3): `$$ … $$`. `\label{eq:x}` numbers the equation; `\eqref{eq:x}` renders as a link
  "式 (n)" with a hover preview. Macros live in `preamble.sty` (01-2).
- Code (02-3): fenced blocks with a language; highlighted with theme variables.
- Tables (02-3, 02-4): pipe tables; `|` inside `$…$` needs no escaping. Pipe-table cells keep their text on one
  line where they can, so sentence-length cells belong in `:::list-table`, which takes block content (MyST
  layout: each top-level item is a row, its sub-items are cells, the first row is the header). Table cells have
  no state syntax; the text names cells by position. Tags such as `gelu_pytorch_tanh` are inline code.
- Images (02-3, 02-4): `![alt](file.svg "caption")`; `{width=160px float=left}` right after the image.
- Widths (02-1): wrap any block in `:::{width=body|wide|page}` … `:::`. Unwrapped blocks are `auto`.
- Component width (Linda, 2026-10-19): a component also accepts `width=560px` or `width=70%` (up to 100%).
  The frame takes that width inside the body column and is centred. Wider than the column, it shrinks to the
  column.
- Sidenotes (03-5): standard footnotes `[^name]` with `[^name]: text` definitions.
- Internal links (02-8): plain links to `/YYYY-MM/slug/#anchor`. `^name` at the end of a paragraph gives the
  paragraph an anchor. A link to an article that is not migrated yet is an absolute URL to the old site.
- Embeds (02-4): `:::embed` with one internal address per line.
- Components (02-7): block form only.

  ```md
  :::act-fn-plot{fn=gelu range=4}
  Caption text, rendered by Bake, never by the component. Leave the middle empty for no caption.
  :::
  ```

## Component contract (02-7, mock version)

A component file has three exports:

```js
export const params = {
  fn: { label: '函数', type: 'enum', options: ['relu', 'gelu'], default: 'gelu' },
  range: { label: '横轴范围', type: 'number', min: 1, max: 10, step: 1, default: 4 },
  title: { label: '标题', type: 'text', default: '' },
  approx: { label: '显示近似', type: 'boolean', default: false },
}
export const layout = {
  width: 'wide',
  height: (params) => (params.fn === 'relu' ? 320 : 360),
  narrowHeight: 560,
}
export default function ActFnPlot(props) { … }
```

- `params`: the types are `number`, `text`, `boolean` and `enum`. The renderer converts the Markdown
  attributes to these types and fails on unknown names, wrong types and values out of range. `width` and
  `height` are reserved for Bake. The coordinator decided to add a `file` type that names a data file next to
  the article; the mock does not implement it yet, so llm-act-fns still selects its annotation presets in
  `components/lib/act/guides.js` with the enum param `guides`.
- `layout.width`: which width `auto` resolves to: `body` (820px), `wide` (1100px), `page` (1340px), pixels
  (`560px`) or a percentage of the body column (`70%`). Markdown `width=` overrides it.
- `layout.height`: placeholder height before the code loads, in pixels (`360`), as a ratio
  (`{ ratio: 16 / 9 }`), or a function of the params that returns either. Make the component fit the declared
  height at desktop width so the page does not jump when it loads.
- `layout.narrowHeight`: optional placeholder height below 600px, in the same forms. Components that stack
  their panels on phones declare it. Markdown `height=420` overrides both heights.
- `layout.frame: false`: no border or background, only width and caption.
- Default export: either a SolidJS function component, which receives the params as props, or a class that
  extends `HTMLElement`, which reads `this.params` and gets `update()` calls.
- The module must not use browser APIs (`window`, `document`, `localStorage` and similar) at the top level,
  because the build reads `params` and `layout` in Node. A module that does fails the build with the line
  `file:line:col <name>: components/<file> uses the browser API window at the top level; …`.
- Components may import CSS from `components/lib/`. Class names in that CSS start with the component's own
  prefix, for example `.act-heat`.
- TeX inside a component: both articles still use their own MathJax helper in `components/lib/`. The
  coordinator decided the kit will provide one TeX helper that also reads `preamble.sty`.
- Components load when they come within 800px of the viewport (`page/runtime.js`).
- Colors and fonts come only from the CSS variables in `page/tokens.css` (`--ink`, `--ink-2`, `--line`,
  `--accent`, `--series-1` … `--series-8`, `--diverge-low|mid|high`, `--font-body`, `--font-mono`, …).
  SVG and HTML use `var(--…)` directly. Canvas and WebGL redraw on the `bake:theme` event on `document`.
- Reader controls (sliders, buttons) only change the page; they are not params.
- On screens narrower than 1000px every figure is full width; the component lays itself out for that width.
  Floated components are centred; only images float.

## Page shell

What the canvas does not specify and what the mock chose. The independent thread 「高保真目录设计」 will
replace the four TOC styles.

- Header: the old blog's masthead. Titles and headings use 霞鹜文楷.
- Body font: a reader setting behind the 「设置」 button at the bottom left, next to the theme and TOC style.
  The options are 黑体 (the default, the old blog's sans stack) and 霞鹜文楷, which is downloaded only when the
  reader picks it. The choice is stored in `localStorage` (`bk-font`).
- T1 notes: follows the old blog's recap. The list keeps the chapter before the current one centred, read
  entries are darker than the ones ahead, the current entry has a bar with a progress fill, and the summaries
  of read sections stay open.
- T2 tabs and T3 dots: the current chapter shows its title under its tab or inside its dot, and hovering
  another tab or dot shows a card with that chapter's sections. T3 has no dividers and shows the number on
  hover.
- T4 ticks: hovering the tick column opens one panel beside the ticks with every chapter; the hovered tick
  highlights its row and shows that chapter's lead and sections.
- From 1000px to 1339px T1 opens from a drawer button; T2 to T4 stay in the margin. Below 1000px every style
  opens the same drawer from a button at the bottom left, above the settings button.
- Sidenotes: hovering a number or a note tints the note and its paragraph with a 0.15s transition in and a
  0.3s transition out.
- Fold titles change colour in 0.12s when pressed and return in 0.3s.
- Copy: a selection inside the article is copied as Markdown (text/plain) and as clean HTML (text/html), and a
  toast says 「已复制为 Markdown」. Footnote numbers become `[^n]` with the note text appended, math becomes
  `$…$` and `$$…$$`, and a fully selected component, table or `:::` block is copied as its Markdown source.
  Numbers, anchor links and buttons are left out and get a lighter selection colour.

## Open questions for Linda

- Text written for the mock that is not in the originals: the `:::recap` notes of llm-act-fns (one sentence
  per section), one internal link from llm-act-fns chapter 07 to matrix-calculus `#ffn-jac`, and `[@key]`
  citation markers placed where the text names a work. Sidenotes are existing parenthetical remarks with
  unchanged wording.
- A possible error in the original matrix-calculus, kept as written: in section `vjp-order` the left side of
  the aligned equation is ∂h/∂x where ∂L/∂x seems intended.
- The old-site address `https://yhnocoder.github.io/learn_by_visualization/` used for unmigrated links is
  inferred from the repository name and not checked. `transformer-backward.html` does not exist in the old
  repository, so that link is plain text.
