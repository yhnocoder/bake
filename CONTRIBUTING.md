# Contributing

Bake is being rebuilt from scratch to follow the redesign. This file holds the architecture rules every change must respect. When a rule can be checked by a test, the test is named next to it; new rules are added here.

## Tool and blog are separate

This repository contains only the tool: the CLI, the Markdown pipeline, the built-in themes and the optional component kit. Posts, components, custom themes and site settings live in the blog's own repository. Bake never assumes a particular blog. `examples/blog/` is the only blog in this repository: it holds the syntax article that lists every syntax item, serves as the source of the tutorial, and is the integration test fixture. Unit tests that need other blogs, such as error cases, create them in temporary directories.

## Planned layout

The layout grows task by task. Today `src/cli.js`, `src/report.js`, `src/config/`, `src/markdown/`, `src/build/`, `src/render/` and `src/themes/essay/` exist. `src/config/` reads `bake.config.js`, front matter and `preamble.sty`, `src/markdown/` parses the article body into the article structure, `src/render/` typesets math, highlights code, reads and converts images and turns Markdown nodes into HTML, `src/build/` resolves the links between articles, compiles the themes and writes `dist/`, and `src/themes/essay/` is the essay theme.

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

The article structure is the interface between Bake and the themes. Bake builds it in two steps, because links and embeds refer to other articles. `readArticle(file, source, errors, { folder, preamble, url })` in `src/markdown/article.js` parses one `index.md`, typesets its math and reads its images; it is asynchronous for that reason. `folder` is `{ path, files }` of the article folder, which images are resolved against, `preamble` holds the definitions read from `preamble.sty` by `src/config/preamble.js`, and `url` is the address of the article, `/YYYY-MM/slug/`. When every article has been read, `createSite(pages)` in `src/build/links.js` indexes them by address, `link(site)` on each article checks its links and `:::embed` blocks against that index, and `structure()` returns the article structure. `parseArticle(file, source, errors, options)` runs the steps for a single article whose links can only point to itself. The front matter is read separately by `src/config/front-matter.js`. Every `html` value is an HTML fragment that a theme inserts unchanged.

| Field | Contents |
|---|---|
| `intro` | The blocks before the first `##` heading. |
| `sections` | One entry per `##` heading: `id`, `number` (`01`, `02` and so on), `title` (HTML), `text` (plain text), `toc` (the title for the table of contents, from `{toc="…"}` or the heading text), `width` (`body`, `wide`, `page` or undefined), `line`, `recap` (HTML, when the section has a `:::recap` before its first `###` heading), `blocks` and `subsections`. |
| `subsections` | One entry per `###` heading in the section: `id`, `title`, `text`, `toc`, `line` and `recap`. |
| `toc` | The table of contents: for each section `id`, `number`, `title`, `recap` and `children`, and for each `###` heading in `children` its `id`, `title` and `recap`. The titles are plain text. |
| `sidenotes` | The footnotes, numbered by their first reference: `number`, `id` (`sidenote-1`), `line` of the definition and `html`. |
| `references` | The entries of `:::references`, numbered by their first citation: `key`, `number`, `id` (`reference-key`) and `html`. Entries the article never cites follow the cited ones and have no `number`. |
| `previews` | One entry per target of the internal links on the page, including links inside embedded content, for the preview card: `target` (the address as written, such as `/2026-10/rope/#angles`, with the anchor decoded), `href` (the address relative to the page), `article` (the title of the target article), `number` (the number of the section that holds the target, such as `3` or `3.2` for its second `###` heading; undefined before the first `##` heading or for a whole article), `title` (HTML of the target heading, or of the heading of the section that holds a target paragraph; undefined for a whole article) and `html` (at most three blocks after a target heading or at the start of a whole article, ending before the next heading, or the target paragraph). |
| `words` | The length of the article: every Chinese character and every other word of the text and inline code counts as one. Code blocks, math, sidenotes and embedded content are not counted. |
| `images` | The images that the build converts to WebP: `source` (the path in the article folder), `path` (the published path), `width`, `lossless` and `keepSource`, which is true when a link, raw HTML or a component attribute in the article refers to the original file so that it is published too. Images published unchanged are copied with the other files of the folder. |
| `glyphs` | When the page has math: an HTML fragment with a hidden `<svg>` that holds the glyph paths of every formula in the article and of the formulas in its embeds and previews. Formulas refer to these paths, so the page includes the fragment once, together with the MathJax styles. MathJax names each path after the font, the variant and the character, so the paths of formulas from different articles combine into one fragment. |

A block has `type`, `line`, `endLine` and `html`. The type is the mdast node type (`paragraph`, `heading`, `list`, `blockquote`, `code`, `math`, `table`, `html`, `thematicBreak`), `figure` for an image on its own line, the name of a built-in block (`aside`, `fold`, `references`, `example`, `list-table`, `embed`) or `component`. A block wrapped in `:::{width=…}` has `width`. A block whose natural width Bake knows at build time has `naturalWidth`, a CSS length that the theme or page script compares with the column to place the block automatically: the formula width in `ex` for display math, the longest line in `ch` for code, with East Asian wide characters counted as two, and the written width for a figure whose size is set in pixels. A figure without a size or with a percentage size has no `naturalWidth` and stays inside the text column, however wide its image file is. Tables and components have no `naturalWidth`; the page measures them. A paragraph that ends with `^name` and a heading have `id`. A `###` or deeper heading also has `depth`, `title`, `text` and `toc`. A component has `name` and `attributes`. Headings inside other blocks do not start sections, and a `:::recap` inside another block stays in that block's HTML as `<div class="recap">`.

Embedded and previewed content comes from another article, so Bake renders it differently from the article's own content: headings and paragraphs have no `id`, equations keep their numbers but lose their ids, sidenote numbers are left out, and links to anchors of the source article, citations, equation references and relative image addresses point into the source article. A preview shows the content of a component as `<div class="component-caption">` in place of the component.

The HTML marks the parts a theme styles or moves:

| Part | HTML |
|---|---|
| Sidenote number | `<sup class="sidenote-ref" data-sidenote="1"><a href="#sidenote-1">1</a></sup>` |
| Citation | `<a class="citation" href="#reference-key">[1]</a>` |
| Highlight | `<mark>` |
| Quote with a source | `<figure class="quote">` holding the `<blockquote>` and a `<figcaption>` |
| Aside | `<aside class="aside">`, with `<p class="aside-title">` when it has a title |
| Fold | `<details class="fold">` with the title in `<summary>` |
| Reference list | `<ol class="references">` with one `<li id="reference-key" value="1">` per cited entry, followed by `<ul class="references uncited">` with one `<li id="reference-key">` per uncited entry |
| Width inside another block | `<div data-width="wide">` |
| Internal link | `<a class="internal-link" href="../../2026-10/rope/#angles" data-target="/2026-10/rope/#angles">`, with the address relative to the page; `data-target` names the entry of `previews` and is missing when the target is an article published from an HTML file |
| Embed | `<div class="embed">` holding one `<div class="embed-part">` per address, each ending with `<p class="embed-source"><a href="…"><cite>Article title</cite><span class="embed-number">3.2</span></a></p>`; the number is missing for content before the first `##` heading |
| `:::embed` inside embedded or previewed content | One `<p class="embed-link">` per address, holding an internal link whose text is the title of the target heading or article |
| Block that a later task renders (components) | `<div data-block="name">` around its content |
| Math | `<mjx-container class="MathJax" jax="SVG" data-tex="…">` holding an SVG, with `display="true"` for a display formula. The styles from `mathStyles()` in `src/render/math.js` lay it out. |
| Numbered equation | `id` on the element MathJax generates for the equation number: the label name for a labeled equation and `eq-` plus the number, such as `eq-2`, otherwise |
| Equation reference | `<a class="eqref" href="#label">(1)</a>`, with the label percent-encoded in `href` |
| Code | `<pre class="shiki bake" data-language="python">` with `<span>` colors that use the `--code-…` CSS variables |
| Table | `<div class="table-scroll">` around the `<table>`, so a wide table scrolls horizontally |
| List table | `<div class="table-scroll">` around `<table class="list-table">` with a `<thead>` row and `<tbody>` rows |
| Image | `<img>` with `width`, `height`, `loading="lazy"` and `decoding="async"`; an inline image also has `style` with its width when the article sets a size |
| Figure | `<figure class="figure">` holding the `<img>` and a `<figcaption>`, with `style="width:560px"` when the article sets a size and `data-float="left"` or `data-float="right"` when it sets `float`. The theme makes the image fill the figure and centres the figure in the column. |
| Example | `<div class="example">` holding `<div class="example-source">` with the highlighted Markdown and `<div class="example-result">` with the rendered content |

## Themes

A theme is a folder with two entry files. `page.jsx` default-exports a SolidJS component that returns the whole `<html>` element of an article page; `client.jsx` is the page script and imports the theme's stylesheets, fonts and other files. The built-in themes live in `src/themes/`. A blog adds a theme with a folder `themes/<name>/`, and replaces single files of a built-in theme with files of the same relative path in a folder of the same name, such as `themes/essay/header.jsx`; every import inside a theme folder is looked up in the blog's folder first and in the built-in folder second. A theme imports `solid-js` from Bake, so a blog does not install it.

`src/build/theme.js` compiles each theme that a published article uses with Vite and `vite-plugin-solid`. `page.jsx` is compiled for the server and rendered to static HTML with Solid's `renderToString`, without hydration. `client.jsx` is compiled into one classic script and one stylesheet, which together with the fonts and images they refer to are written to `dist/assets/` under names that contain a content hash. A theme that cannot be compiled is reported at the file and position of the error, and an article that the theme throws on is reported at the article.

The page component receives these props:

| Prop | Contents |
|---|---|
| `site` | `title`, `url` and `language` from `bake.config.js`. |
| `article` | `title`, `summary`, `date`, `tags` (a list, empty when not set), `category`, `draft`, `toc` (the table of contents style of the article or the site), `url`, `words` and `content`, the article structure described above. |
| `assets` | `root`, the relative path from the page to the site root such as `../../`; `styles` and `scripts`, the paths of the compiled stylesheet and script relative to the page; `mathStyles`, the MathJax stylesheet when the article has math. |

### The essay theme

`page.jsx` writes the document head, `header.jsx` the masthead, `toc.jsx` the table of contents, `article.jsx` the body and `previews.jsx` one `<template class="bk-preview-template" data-target="…">` per entry of `previews`, holding the card content. Every block of the article structure is wrapped in `<div class="bk-block" data-type="…">`; blocks that can be wider than the text also have `data-width` (`body`, `wide`, `page`, or `auto` when the article sets no width) and the natural width as `--natural-width`. Each sidenote is rendered once, after the top-level block that first refers to it, as `<aside class="bk-sidenote" data-sidenote="1">`. UI text comes from `labels.js`, in Chinese when the site language starts with `zh` and in English otherwise. The words around the source line of an embed, such as 出自《…》, are set by `page.jsx` from `labels.js` as the CSS variables `--bk-embed-source-before` and `--bk-embed-source-after`, because that line is part of the HTML Bake generates.

The styles are in `styles/`. `tokens.css` defines every colour as a CSS variable, for the light and the dark theme, and `page.css` defines the column widths as variables for each breakpoint: 1340 pixels and up, 1000 to 1339 pixels, and below 1000 pixels. The page scripts are in `scripts/`, and `client.jsx` starts them:

| Script | What it does |
|---|---|
| `widths.js` | Gives every block with `data-width="auto"` the width `wide` when its content is wider than the text column and the screen has a wide level, and `body` otherwise, and writes the result to `data-resolved` on every block with `data-width`. |
| `notes.js` | From 1000 pixels up, copies each sidenote into the notes column next to the line of its number and moves it below any block that reaches into the column. Below 1000 pixels, a tap on a number opens the sidenote under its block. Hovering a number or a note highlights both. |
| `folds.js` | Animates opening and closing `:::fold` blocks, and opens every fold for printing. |
| `heading-links.jsx` | Copies the link of a heading when its `#` is clicked, and scrolls to the target of an in-page link after opening the folds around it. |
| `preview-card.jsx` | Shows one card for citations and internal links on devices that can hover with a fine pointer: the reference entry of a citation from 1000 pixels up, and the template of an internal link at every width. The card appears 300 milliseconds after the pointer rests on a link, below the link and inside the viewport, switches to another link at once while it is shown or within 600 milliseconds after it hid, stays while the pointer is in it and hides 200 milliseconds after the pointer leaves. A click on the card of an internal link opens the target. |
| `toc.js`, `drawer.jsx` | Marks the read, current and following entries of the table of contents from 1340 pixels up, and shows the table of contents in a drawer below that width. |
| `settings.jsx` | The settings panel. Its rows come from `settingRows`; `chooseSetting(name, value)` applies and stores a choice and dispatches `bk:setting` on `document`. |

The reader settings are defined in `settings.js`: each setting has its values and its initial value, the choice is stored in `localStorage` as `bk-<name>`, and an inline script in the head sets `data-<name>` on `<html>` before the first paint. The same script sets `data-script` on `<html>`; the styles hide the sidenotes under their blocks only when it is set, so a reader without scripts sees every sidenote under the block that refers to it. Page scripts that change the layout dispatch the `bk:layout` event on `document`, and the scripts that measure the layout listen to it.

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
- Themes are compiled by Vite with `vite-plugin-solid`, and their page structure and page scripts are written with SolidJS.
- The essay theme self-hosts LXGW WenKai from `lxgw-wenkai-webfont`, whose stylesheet splits the font into files by character range so that a page only downloads the files for the characters it shows, and JetBrains Mono from `@fontsource/jetbrains-mono`.
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
| A blog can add a theme or replace files of the essay theme, theme errors are reported at their position, and a build leaves no cache in the blog | `test/theme.test.js` |
| Internal links and `:::embed` blocks are checked after every article is read, with the errors and output described above, and the link fixtures in `test/fixtures/syntax-errors/` report the lines in `expected.json` | `test/links.test.js` |
| Every formula of the syntax article renders in Chromium without a MathJax error or a missing glyph, including the formulas of sidenotes in the margin, in a sidenote opened on a phone, in embeds and in an open preview card, and no id appears twice on the page | `test/browser/math.test.js` |
| The preview card of an internal link appears after the delay below the link, switches between links, stays while the pointer is in it, hides after the pointer leaves and opens the target on a click; a phone shows no card and a tap opens the target under a sub-path; embeds show their parts, formulas and source lines | `test/browser/links.test.js` |
| Figures with a pixel or percent width have that width, stay inside the screen and are centred, and figures without a size stay inside the text column | `test/browser/images.test.js` |
| The essay theme keeps articles inside the screen at every breakpoint, gives body, wide and page blocks their widths, resolves blocks without a width, follows dark mode and the theme setting, and downloads LXGW WenKai only for the characters of the masthead, title and headings | `test/browser/layout.test.js` |
| Sidenotes sit next to their numbers without overlapping each other or wide blocks, highlight together with their numbers, open under their block on phones and are shown under their block when the page runs no scripts | `test/browser/sidenotes.test.js` |
| The settings panel changes the theme and the body font at once, the choice is kept after a reload and applied before the page script runs, and LXGW WenKai for the body is downloaded only when chosen | `test/browser/reader-settings.test.js` |
| Folds, in-page links, heading links, citation previews, the table of contents and its drawer work as described above, and the settings button covers no entry of the table of contents | `test/browser/navigation.test.js` |
| The screenshots section replaces only the marked part of a pull request description, gives the same result when written twice and keeps `$` literally | `test/screenshot-section.test.js` |
| Every screenshot image in a pull request description is at most 880 pixels wide, changes are cropped to the changed area, and identical light and dark images are drawn once | `test/compare-screenshots.test.js` |
