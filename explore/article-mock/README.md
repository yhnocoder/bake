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

Every item below comes from a canvas board (in brackets). Anything an article needs that the canvas does not
cover is listed under "Gaps" at the end instead of being invented silently.

- Front matter (01-2): `title`, `slug`, `date`, `summary`, `tags`, `toc`. URL is `/YYYY-MM/slug/`.
  `toc` is `notes`, `tabs`, `dots` or `ticks` for T1 to T4.
- T1 notes (Linda, 2026-10-19 14:00): a `:::recap` block inside a `###` section holds that section's
  summary. It is not shown in the body, only under the section title in the T1 TOC, and may contain math.
- Headings (02-2): `##` chapters are numbered 01, 02 automatically; `###` sections are not numbered.
  `{#id}` fixes the anchor; `{toc="short title"}` sets the TOC text.
- Inline (02-2): `==mark==`, links, inline code, `$math$`, `**bold**`, `*italic*`.
- Lists and quotes (02-2): a quote whose last paragraph starts with `— ` shows that paragraph as the source.
- Callout (02-2): `:::aside{title="阅读约定"}` … `:::`. One style only.
- Fold (02-2): `:::fold{title="推导：GELU 的导数"}` … `:::`. Closed by default.
- Citations (02-2): `[@key]` in text, the list in `:::references` with items `- [@key] text`.
  Numbered [1], [2] by first use.
- Display math (02-3): `$$ … $$`. `\label{eq:x}` numbers the equation; `\eqref{eq:x}` renders as a link
  "式 (n)" with a hover preview. Macros live in `preamble.sty` (01-2).
- Code (02-3): fenced blocks with a language; highlighted with theme variables.
- Tables (02-3, 02-4): pipe tables; `|` inside `$…$` needs no escaping. `:::list-table` for cells with block
  content (MyST layout: each top-level item is a row, its sub-items are cells, the first row is the header).
- Images (02-3, 02-4): `![alt](file.svg "caption")`; `{width=160px float=left}` right after the image.
- Widths (02-1): wrap any block in `:::{width=body|wide|page}` … `:::`. Unwrapped blocks are `auto`.
- Sidenotes (03-5): standard footnotes `[^name]` with `[^name]: text` definitions.
- Internal links (02-8): plain links to `/YYYY-MM/slug/#anchor`. `^name` at the end of a paragraph gives the
  paragraph an anchor.
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
export const layout = { width: 'wide', height: 360 }
export default function ActFnPlot(props) { … }
```

- `params`: the four types are `number`, `text`, `boolean`, `enum`. The renderer converts the Markdown
  attributes to these types and fails on unknown names, wrong types and values out of range. `width` and
  `height` are reserved for Bake.
- `layout.width`: which width `auto` resolves to: `body` (820px), `wide` (1100px) or `page` (1340px).
- `layout.height`: placeholder height before the code loads, in pixels (`360`) or as a ratio
  (`{ ratio: 16 / 9 }`). The author may override it with `height=420` in Markdown. Make the component fit the
  declared height at desktop width so the page does not jump when it loads.
- `layout.frame: false`: no border or background, only width and caption.
- Default export: either a SolidJS function component, which receives the params as props, or a class that
  extends `HTMLElement`, which reads `this.params` and gets `update()` calls.
- Components load when they come within 800px of the viewport (`page/runtime.js`).
- Colors and fonts come only from the CSS variables in `page/tokens.css` (`--ink`, `--ink-2`, `--line`,
  `--accent`, `--series-1` … `--series-8`, `--diverge-low|mid|high`, `--font-body`, `--font-mono`, …).
  SVG and HTML use `var(--…)` directly. Canvas and WebGL redraw on the `bake:theme` event on `document`.
- Reader controls (sliders, buttons) only change the page; they are not params.
- On screens narrower than 1000px every figure is full width; the component lays itself out for that width.

## Gaps

Found while converting the two articles. Each item says what was needed, what the mock does for now and a
suggestion. None of these is decided.

Syntax:

1. Per-figure annotations (llm-act-fns, all 14 two-panel plots). The original places bands, reference lines and
   labelled points by hand for each figure. Params are scalars only, so the mock selects a named preset in
   `components/lib/act/guides.js` with the enum param `guides`. Suggestion: a param type that names a data file
   next to the article (`guides=fig-intro-neg.yaml`), so the annotations become article content.
2. Chapter subtitle (llm-act-fns, every chapter has a one-line grey subtitle). The mock writes it as the first
   paragraph. Suggestion: a `:::lede` block, which the T2–T4 hover cards could also use as the first sentence.
3. TOC entries without a visible heading (llm-act-fns chapter 13 points at a table and the reference list).
   The mock adds two `###` headings, so 「参考文献」 appears twice. Suggestion: `:::references` omits its own
   label right after a heading, or blocks accept `{#id toc="…"}`.
4. Table cell states (matrix-calculus shape table: three grey cells and one outlined cell, referred to in the
   text as 「标灰的三格」). Lost in the mock. Suggestion: two fixed cell classes in `:::list-table`, for example
   `- {.muted}` and `- {.target}`.
5. Floated components (matrix-calculus, three lm head local views floated left with text wrapping). The mock
   centres them. 02-4 allows floating only for images. Suggestion: a `float` layout option for body-width
   components, or accept the change.
6. Uncited references (llm-act-fns lists two Raschka articles that the text never cites). The mock numbers
   them last. Decide: allowed, a build error, or listed without a number.
7. Links to articles that were not migrated (matrix-calculus links to the old Chinese translation page and to
   `transformer-backward.html`). Kept as broken relative links.
8. Inline tag (`gelu_pytorch_tanh` styled as a tag in a table). Written as inline code.
9. Pipe-table cells do not wrap, so sentence-length cells belong in `:::list-table`. Worth one line in the
   syntax article.
10. Short notes written as `<blockquote>` in matrix-calculus became `:::aside` (callout style, not quote style).

Component contract:

11. Placeholder height that depends on params (one diagram is 104px for one variant and 200px for others).
    The mock writes `height=` in Markdown. Suggestion: `layout.height` may be a function of the params.
12. Height below 1000px. Many components stack their panels on phones and grow (for example 430px → 684px).
    The mock lets a loaded slot take the component's own height below 1000px, so the page moves once there.
    Suggestion: an optional narrow-width height.
13. Components import their own CSS from `components/lib/`. Works; the contract should say so and require
    prefixed class names.
14. TeX in components. Both articles need TeX labels inside SVG; each wrote its own MathJax helper in
    `components/lib/`. Suggestion: the runtime provides one TeX helper that also reads `preamble.sty`.
15. A component module must not touch browser APIs at the top level, because the build reads `params` and
    `layout` in Node.

Content:

16. Text written for the mock, not in the originals: the `:::recap` notes of llm-act-fns (one sentence per
    section), one internal link from llm-act-fns chapter 07 to matrix-calculus `#ffn-jac`, and `[@key]`
    citation markers placed where the text names a work. Sidenotes are existing parenthetical remarks with
    unchanged wording.
17. Possible error in the original matrix-calculus, kept as written: in section `vjp-order` the left side of
    the aligned equation is ∂h/∂x where ∂L/∂x seems intended.

Page shell (what the canvas does not specify and what the mock chose):

18. The header is not drawn 1:1 on any board; the mock uses the old blog's masthead with WenKai.
19. T2 and T3 on phones: the mock shows the current chapter tab at the bottom left and opens the same drawer
    as T1, with a text list instead of the sliding tab column.
20. The mock style switcher sits behind a 「样式」 button at the top right; it exists only in the mock.
