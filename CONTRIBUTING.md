# Contributing

Bake is being rebuilt from scratch to follow the redesign. This file holds the architecture rules every change must respect. When a rule can be checked by a test, the test is named next to it; new rules are added here.

## Tool and blog are separate

This repository contains only the tool: the CLI, the Markdown pipeline, the built-in themes and the optional component kit. Posts, components, custom themes and site settings live in the blog's own repository. Bake never assumes a particular blog. `examples/blog/` is the only blog in this repository: it holds the syntax article that lists every syntax item, serves as the source of the tutorial, and is the integration test fixture. Unit tests that need other blogs, such as error cases, create them in temporary directories.

## Planned layout

The layout grows task by task. Today `src/cli.js`, `src/report.js`, `src/config/`, `src/markdown/`, `src/build/` and `src/render/` exist. `src/config/` reads `bake.config.js` and front matter, `src/markdown/` parses the article body into the article structure, `src/build/` writes `dist/`, and `src/render/` turns Markdown nodes into HTML and holds a placeholder article page that shows the article structure until the essay theme is added.

| Path | Contents |
|---|---|
| `src/cli.js` | Command entry: `bake new`, `bake dev`, `bake build` |
| `src/report.js` | Error records and the `file:line:col message` lines printed for them |
| `src/config/` | Reading `bake.config.js`, front matter and `preamble.sty` |
| `src/markdown/` | Parsing Markdown into the article structure: sections, blocks, sidenotes, table of contents |
| `src/render/` | Math, code highlighting and static HTML output |
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

The article structure is the interface between Bake and the themes. `parseArticle(file, source, errors)` in `src/markdown/article.js` returns it for one `index.md`; the front matter is read separately by `src/config/front-matter.js`. Every `html` value is an HTML fragment that a theme inserts unchanged.

| Field | Contents |
|---|---|
| `intro` | The blocks before the first `##` heading. |
| `sections` | One entry per `##` heading: `id`, `number` (`01`, `02` and so on), `title` (HTML), `text` (plain text), `toc` (the title for the table of contents, from `{toc="…"}` or the heading text), `width` (`body`, `wide`, `page` or undefined), `line`, `recap` (HTML, when the section has a `:::recap` before its first `###` heading), `blocks` and `subsections`. |
| `subsections` | One entry per `###` heading in the section: `id`, `title`, `text`, `toc`, `line` and `recap`. |
| `toc` | The table of contents: for each section `id`, `number`, `title`, `recap` and `children`, and for each `###` heading in `children` its `id`, `title` and `recap`. The titles are plain text. |
| `sidenotes` | The footnotes, numbered by their first reference: `number`, `id` (`sidenote-1`), `line` of the definition and `html`. |
| `references` | The entries of `:::references`, numbered by their first citation, with uncited entries numbered after the cited ones: `key`, `number`, `id` (`reference-key`) and `html`. |

A block has `type`, `line`, `endLine` and `html`. The type is the mdast node type (`paragraph`, `heading`, `list`, `blockquote`, `code`, `math`, `table`, `html`, `thematicBreak`), the name of a built-in block (`aside`, `fold`, `references`, `example`, `list-table`, `embed`) or `component`. A block wrapped in `:::{width=…}` has `width`. A paragraph that ends with `^name` and a heading have `id`. A `###` or deeper heading also has `depth`, `title`, `text` and `toc`. A component has `name` and `attributes`. Headings inside other blocks do not start sections, and a `:::recap` inside another block stays in that block's HTML as `<div class="recap">`.

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
| Block that a later task renders (`example`, `list-table`, `embed`, components) | `<div data-block="name">` around its content |
| Math | `<code class="language-math math-inline">` and `<pre><code class="language-math math-display">` with the TeX source, until math is typeset |

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
- Markdown is parsed by remark with GFM, math, front matter and `remark-cjk-friendly`, which lets emphasis close next to Chinese punctuation. Bake's own syntax is written as micromark extensions in `src/markdown/`: `:::` blocks (remark-directive does not accept a block without a name such as `:::{width=wide}`, and its text directives would read `\eqref{eq:ffn}` as a directive), `==highlight==` with the same CJK rules that `remark-cjk-friendly-gfm-strikethrough` uses for `~~`, `[@key]` citations, and footnote references without a definition, which GFM would otherwise leave as plain text.

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
| The screenshots section replaces only the marked part of a pull request description, gives the same result when written twice and keeps `$` literally | `test/screenshot-section.test.js` |
| Every screenshot image in a pull request description is at most 880 pixels wide, changes are cropped to the changed area, and identical light and dark images are drawn once | `test/compare-screenshots.test.js` |
