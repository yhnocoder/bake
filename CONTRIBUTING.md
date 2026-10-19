# Contributing

Bake is being rebuilt from scratch to follow the redesign. This file holds the architecture rules every change must respect. When a rule can be checked by a test, the test is named next to it; new rules are added here.

## Tool and blog are separate

This repository contains only the tool: the CLI, the Markdown pipeline, the built-in themes and the optional component kit. Posts, components, custom themes and site settings live in the blog's own repository. Bake never assumes a particular blog. `examples/blog/` is the only blog in this repository: it holds the syntax article that lists every syntax item, serves as the source of the tutorial, and is the integration test fixture. Unit tests that need other blogs, such as error cases, create them in temporary directories.

## Planned layout

The layout grows task by task. Today `src/cli.js`, `src/report.js`, `src/config/`, `src/markdown/`, `src/build/` and `src/render/` exist. `src/config/` reads `bake.config.js`, front matter and `preamble.sty`, `src/markdown/` parses the article body into the article structure, `src/build/` writes `dist/`, and `src/render/` typesets math, highlights code, reads and converts images, turns Markdown nodes into HTML and holds a placeholder article page that shows the article structure until the essay theme is added.

| Path | Contents |
|---|---|
| `src/cli.js` | Command entry: `bake new`, `bake dev`, `bake build` |
| `src/report.js` | Error records and the `file:line:col message` lines printed for them |
| `src/config/` | Reading `bake.config.js`, front matter and `preamble.sty` |
| `src/markdown/` | Parsing Markdown into the article structure: sections, blocks, sidenotes, table of contents |
| `src/render/` | Math, code highlighting, image conversion and static HTML output |
| `src/build/` | Site generation: pages, URLs, links, homepage, RSS, share images |
| `src/dev/` | The local server for `bake dev`: rebuild on save and in-place page updates |
| `src/themes/essay/`, `src/themes/bento/` | Built-in themes: page structure in SolidJS JSX plus styles |
| `src/kit/` | Optional parts for writing components |
| `test/` | Unit and integration tests, see TESTING.md |
| `examples/blog/` | The example blog: the syntax article and the posts it links to |
| `scripts/` | Repository checks and the screenshot scripts for pull requests |

## Themes interpret, they never add syntax

The set of things an article can write (heading levels, blocks, width levels `body`, `wide` and `page`, front matter fields) is defined by Bake alone. A theme receives the parsed article and decides how to lay it out; it cannot add attributes, blocks or front matter fields. An attribute no theme knows is a build error. Adding syntax means changing Bake's syntax table and stating what it means in every theme.

## The article structure

The article structure is the interface between Bake and the themes. `parseArticle(file, source, errors, { folder, preamble })` in `src/markdown/article.js` returns it for one `index.md`. It is asynchronous because it typesets math and reads images. `folder` is `{ path, files }` of the article folder, which images are resolved against, and `preamble` holds the definitions read from `preamble.sty` by `src/config/preamble.js`. The front matter is read separately by `src/config/front-matter.js`. Every `html` value is an HTML fragment that a theme inserts unchanged.

| Field | Contents |
|---|---|
| `intro` | The blocks before the first `##` heading. |
| `sections` | One entry per `##` heading: `id`, `number` (`01`, `02` and so on), `title` (HTML), `text` (plain text), `toc` (the title for the table of contents, from `{toc="…"}` or the heading text), `width` (`body`, `wide`, `page` or undefined), `line`, `recap` (HTML, when the section has a `:::recap` before its first `###` heading), `blocks` and `subsections`. |
| `subsections` | One entry per `###` heading in the section: `id`, `title`, `text`, `toc`, `line` and `recap`. |
| `toc` | The table of contents: for each section `id`, `number`, `title`, `recap` and `children`, and for each `###` heading in `children` its `id`, `title` and `recap`. The titles are plain text. |
| `sidenotes` | The footnotes, numbered by their first reference: `number`, `id` (`sidenote-1`), `line` of the definition and `html`. |
| `references` | The entries of `:::references`, numbered by their first citation, with uncited entries numbered after the cited ones: `key`, `number`, `id` (`reference-key`) and `html`. |
| `images` | The images that the build converts to WebP: `source` (the path in the article folder), `path` (the published path), `width`, `lossless` and `keepSource`, which is true when a link, raw HTML or a component attribute in the article refers to the original file so that it is published too. Images published unchanged are copied with the other files of the folder. |
| `glyphs` | When the article has math: an HTML fragment with a hidden `<svg>` that holds the glyph paths of every formula in the article. Formulas refer to these paths, so the page includes the fragment once, together with the MathJax styles. |

A block has `type`, `line`, `endLine` and `html`. The type is the mdast node type (`paragraph`, `heading`, `list`, `blockquote`, `code`, `math`, `table`, `html`, `thematicBreak`), `figure` for an image on its own line, the name of a built-in block (`aside`, `fold`, `references`, `example`, `list-table`, `embed`) or `component`. A block wrapped in `:::{width=…}` has `width`. A block whose natural width Bake knows at build time has `naturalWidth`, a CSS length that the theme or page script compares with the column to place the block automatically: the formula width in `ex` for display math, the longest line in `ch` for code, with East Asian wide characters counted as two, and the width in `px` for a figure without a percentage width. Tables and components have no `naturalWidth`; the page measures them. A paragraph that ends with `^name` and a heading have `id`. A `###` or deeper heading also has `depth`, `title`, `text` and `toc`. A component has `name` and `attributes`. Headings inside other blocks do not start sections, and a `:::recap` inside another block stays in that block's HTML as `<div class="recap">`.

The HTML marks the parts a theme styles or moves:

| Part | HTML |
|---|---|
| Sidenote number | `<sup class="sidenote-ref" data-sidenote="1"><a href="#sidenote-1">1</a></sup>` |
| Citation | `<a class="citation" href="#reference-key">[1]</a>` |
| Highlight | `<mark>` |
| Quote with a source | `<figure class="quote">` holding the `<blockquote>` and a `<figcaption>` |
| Aside | `<aside class="aside">`, with `<p class="aside-title">` when it has a title |
| Fold | `<details class="fold">` with the title in `<summary>` |
| Reference list | `<ol class="references">` with one `<li id="reference-key" value="1">` per entry |
| Width inside another block | `<div data-width="wide">` |
| Block that a later task renders (`embed`, components) | `<div data-block="name">` around its content |
| Math | `<mjx-container class="MathJax" jax="SVG" data-tex="…">` holding an SVG, with `display="true"` for a display formula. The styles from `mathStyles()` in `src/render/math.js` lay it out. |
| Numbered equation | `id` on the element MathJax generates for the equation number: the label name for a labeled equation and `eq-` plus the number, such as `eq-2`, otherwise |
| Equation reference | `<a class="eqref" href="#label">(1)</a>`, with the label percent-encoded in `href` |
| Code | `<pre class="shiki bake" data-language="python">` with `<span>` colors that use the `--code-…` CSS variables |
| Table | `<div class="table-scroll">` around the `<table>`, so a wide table scrolls horizontally |
| List table | `<div class="table-scroll">` around `<table class="list-table">` with a `<thead>` row and `<tbody>` rows |
| Image | `<img>` with `width`, `height`, `loading="lazy"` and `decoding="async"`; an inline image also has `style` with its width when the article sets a size |
| Figure | `<figure class="figure">` holding the `<img>` and a `<figcaption>`, with `style="width:560px"` when the article sets a size and `data-float="left"` or `data-float="right"` when it sets `float`. The theme makes the image fill the figure and centres the figure in the column. |
| Example | `<div class="example">` holding `<div class="example-source">` with the highlighted Markdown and `<div class="example-result">` with the rendered content |

## Error reports

Every problem Bake finds in a blog is reported as one line:

```
content/posts/llm/rope/index.md:3:7 URL /2026-10/rope/ is already used by content/posts/2026-10/rope/index.md
```

The format is `file:line:col message`, with the path relative to the blog root and the message in English. Bake runs every check before it reports, so one run lists all problems, sorted by file, line and column, followed by a count such as `1 error, dist/ was not written`. Articles are checked against the settings in `bake.config.js`, so when `bake.config.js` has errors, Bake reports those and does not check the articles. A build with errors writes nothing and leaves an existing `dist/` unchanged. A build without errors writes into `.dist-staging/` in the blog root and then replaces `dist/` with it, so `dist/` never holds a partly written site or files from an earlier build. Every build first removes `.dist-staging/` and `.dist-previous/` left by an interrupted build. `bake dev` shows the same lines in the terminal and on the page.

## Libraries

- Use mature libraries for general problems: Markdown parsing, math typesetting, syntax highlighting, diffing, sanitizing and validation.
- Write Bake's own core pieces by hand: the article structure, the theme interface, the component contract and the dev server's page updates.
- When switching to a library, accept its native behavior. Do not wrap it to reproduce the quirks of the code it replaces.
- Add a dependency only in the change that uses it, and pin the npm major version given in `package.json` when regenerating the lock file.
- Markdown is parsed by remark with GFM, math, front matter and `remark-cjk-friendly`, which lets emphasis close next to Chinese punctuation. Bake's own syntax is written as micromark extensions in `src/markdown/`: `\eqref{label}` in text, `:::` blocks (remark-directive does not accept a block without a name such as `:::{width=wide}`, and its text directives would read `\eqref{eq:ffn}` as a directive), `==highlight==` with the same CJK rules that `remark-cjk-friendly-gfm-strikethrough` uses for `~~`, `[@key]` citations, and footnote references without a definition, which GFM would otherwise leave as plain text. Before parsing, `src/markdown/table-math.js` replaces each `|` inside `$…$` on a table line with a private-use character and restores it afterwards, because GFM splits cells before it reads math.
- Math is typeset by MathJax 4 (`@mathjax/src`) into SVG with the New Computer Modern font. Each article is typeset in its own MathJax document, so macros defined in one article do not reach another, and every formula is compiled twice so that `\eqref` can refer to a later label.
- Code is highlighted by Shiki with a theme created by `createCssVariablesTheme`, so the colors are CSS variables that themes and dark mode set.
- Images are read and converted by sharp. Size values such as `560px` and `70%` are parsed by `parseSize` and checked by `sizeProblem` in `src/config/rules.js`, which every syntax with a pixel or percent size uses.
- Browser tests use Playwright, pinned to the exact version that matches the Chromium preinstalled in the cloud environment.

## Clean code

- The only compatibility code allowed is one migration step that upgrades old data files to the current format. There are no shims, fallbacks, legacy aliases or dual code paths.
- Fix root causes and replace old behavior outright. Code that is no longer used is deleted; git history keeps it.
- A known performance gap is written down here together with who accepted it.

## Checks guarded by tests

| Rule | Check |
|---|---|
| No comments except `why: <reason>` | `scripts/check_comment.py`, tested by `test/check-comment.test.js` |
| CLI output is English and lists the commands | `test/cli.test.js` |
| Errors are reported as `file:line:col message`, all in one run, sorted, with the count line, and a build with errors leaves `dist/` unchanged | `test/build.test.js` |
| Every `bake.config.js` and front matter error states its exact position | `test/config.test.js`, `test/front-matter.test.js` |
| The front matter fixtures in `test/fixtures/syntax-errors/` report the lines in `expected.json` | `test/front-matter.test.js` |
| Every text syntax item has tests for its output and its errors, the Markdown fixtures in `test/fixtures/syntax-errors/` report the lines in `expected.json`, and the syntax article parses without errors | `test/markdown.test.js` |
| The example blog in `examples/blog/` builds without errors | `test/build.test.js` |
| The syntax article's error appendix matches `test/fixtures/syntax-errors/` | `test/syntax-article.test.js` |
| Math is typeset with numbering, references and errors; `preamble.sty` accepts only macro definitions | `test/math.test.js`, `test/preamble.test.js` |
| Code, tables, `:::list-table`, `:::example` and images render as described above, with their errors | `test/code.test.js`, `test/blocks.test.js`, `test/images.test.js` |
| Raster images are published as WebP, originals only when linked, and `preamble.sty` errors stop the build | `test/build.test.js` |
| Every formula of the syntax article renders in Chromium without a MathJax error or a missing glyph | `test/browser/math.test.js` |
| Figures with a pixel or percent width have that width, stay inside the screen and are centred | `test/browser/images.test.js` |
| The screenshots section replaces only the marked part of a pull request description, gives the same result when written twice and keeps `$` literally | `test/screenshot-section.test.js` |
| Every screenshot image in a pull request description is at most 880 pixels wide, changes are cropped to the changed area, and identical light and dark images are drawn once | `test/compare-screenshots.test.js` |
