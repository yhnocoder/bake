# Bake

Bake generates a static site from a technical blog written in Markdown. Articles can include math, code, sidenotes, folds, callouts and interactive components written as standard web components. Each article chooses a theme: `essay` lays it out as a long read with a table of contents and sidenotes, `bento` arranges its sections as cards.

## Install

Bake needs Node 24 or later. A blog is an npm project that installs Bake as a development dependency. The npm package is named `@yhnocoder/bake`; until it is published to npm, install it from GitHub:

```bash
mkdir my-blog && cd my-blog
npm init -y
npm pkg set type=module
npm install --save-dev github:yhnocoder/bake
npx playwright install chromium
npx bake init
npx bake dev
```

`bake.config.js` is an ES module, so the `package.json` of the blog sets `"type": "module"`. `npm init -y` writes `"type": "commonjs"`, which `npm pkg set type=module` replaces; Bake reports an error at `bake.config.js` when the nearest `package.json` sets another type or none. `npx playwright install chromium` downloads the browser that `bake build` draws the share images with, see [Share images](#share-images). The command `bake` comes with the package, so `npx bake` runs it from the blog folder, and the scripts in `package.json` can call it as `bake`.

## Example blog

`examples/blog/` is a blog written with Bake. Its syntax article lists every syntax item with its source next to its result, and its other articles show components, embeds, plain HTML pages and both themes. `make example` builds it and serves it at http://localhost:8000/. The `demo` workflow in `.github/workflows/demo.yml` builds it with the address of this repository's GitHub Pages site and publishes it there when it is started by hand from the Actions tab; it is never started by a push.

## Commands

```bash
bake init my-blog       # create a blog with bake.config.js and a first post in my-blog/
bake new 2026-10/rope   # create content/posts/2026-10/rope/index.md as a draft
bake dev                # serve the blog at http://localhost:4321/, open it and update pages on save
bake build              # check the blog and generate the static site into dist/
```

Run every command except `bake init` from the blog root, the folder that contains `bake.config.js`.

`bake init [folder]` creates a blog in `folder`, or in the current folder when none is given: `bake.config.js` with the folder name as the site title, a first post at `content/posts/hello/index.md` and a `.gitignore` that leaves out `node_modules/`, `dist/`, `.dist-staging/` and `.dist-previous/`. It writes nothing when the folder already holds one of these files.

`bake new <path>` creates `content/posts/<path>/index.md` with front matter for a draft dated today. The last folder name of the path becomes the slug.

`bake build` checks `bake.config.js` and the front matter and Markdown of every article, then writes the homepage to `dist/index.html`, each published article to `dist/YYYY-MM/slug/` together with the other files in its folder, writes the scripts, styles and fonts of the themes to `dist/assets/`, and copies `public/` to the root of `dist/`. Files and folders in an article folder whose names start with a dot are not published, and `.DS_Store` files in `public/` are not copied. A symbolic link to a file is copied as that file, and a symbolic link to a folder is skipped. It also writes `dist/404.html`, the RSS feed `dist/feed.xml`, the sitemap `dist/sitemap.xml`, the theme stylesheet `dist/_bake/theme.css` and one share image per Markdown article to `dist/og/`, see [Share images](#share-images). Every build replaces `dist/` completely. Bake writes the new site into `.dist-staging/` in the blog root and moves the old one to `.dist-previous/` while it swaps them, so add both folders to the blog's `.gitignore` next to `dist/`. When Bake finds problems, it lists all of them as `file:line:col message`, prints the number of errors and leaves `dist/` unchanged.

### bake dev

You write Markdown in the text editor of your choice, and `bake dev` shows each page as `bake build` would publish it. It builds the blog in memory, drafts included, serves it at http://localhost:4321/ and opens that address in the default browser when it runs in a terminal; `--no-open` leaves the browser closed. Open the pages at `localhost` and not at `127.0.0.1`: the AI chat stores its key with a passkey, and browsers do not create passkeys for an IP address. When port 4321 is in use, it tries 4322, 4323 and so on; `--port <number>` starts from another port. `bake dev` listens only on this computer, at `127.0.0.1`, because Write to file in a parameter bar changes files in the blog folder. `--host 0.0.0.0` makes it listen on every network interface, so a phone on the same network can open the pages too, and the terminal then also shows the addresses of the computer on the local network. Open the pages at one of those IP addresses: `bake dev` refuses requests for any host name other than `localhost`, a name that ends with `.localhost` and the name given with `--host`, so that a site cannot reach it through a DNS name that points at the computer. Only use it on a network you trust: the pages and their parameter bars are then open to everyone on that network. `bake dev` writes into the blog folder only when you press Write to file in a parameter bar, and it stops when you press Ctrl+C.

Bake watches the blog folder and rebuilds what changed each time you save a file:

- Saving the Markdown of an article replaces the article text on the open page in place. The scroll position, the table of contents and the open or closed state of every fold stay as they were. Each changed block is highlighted in light yellow for one second. When no changed block is on the screen, a notice at the bottom of the page names the section of the change, and clicking the notice scrolls there. Bake checks the links of every article again after each save, so the pages of other articles that link to the changed article or embed one of its sections are updated in the same way, and a link that no longer finds its target is reported.
- Changing the front matter of an article, `bake.config.js`, `preamble.sty` or a file in `themes/` generates the page again, and the browser reloads it at the same scroll position.
- Changing any other file, such as a component, an image or a file in `public/`, reloads the page at the same scroll position.
- The homepage at http://localhost:4321/ shows every article, drafts included, and reloads when the front matter of an article changes or an article is added or removed.

Bake reports every problem that `bake build` would report, as `file:line:col message` lines in the terminal and in a list in the bottom right corner of the page. Clicking an entry copies its position, `file:line:col`. The close button hides the list until the problems change. While the blog has errors, every page keeps showing the last version without errors, and the pages update again when the errors are fixed. When `bake dev` starts on a blog whose articles have errors, it shows the pages with those errors.

Double-clicking a block of an article, such as a paragraph, a heading or a sidenote, opens the Markdown file in Visual Studio Code at the line where the block starts.

Every component of the article shows a parameter bar above it, with one control per parameter. Moving a control changes the running component at once, and a control whose value differs from the Markdown is marked orange. Write to file changes the attributes of the component's `:::` line in `index.md` and leaves the rest of the file as it is; parameters set back to their default are removed from the line. Copy puts that line on the clipboard without changing the file, and Reset goes back to the values in the Markdown. When `index.md` changed after the page was built, Write to file refuses and asks you to save the file and try again. The Parameter bars switch at the top of the problems list hides and shows the bars.

A draft shows the label Draft, or 草稿 on a Chinese site, next to its date on its page and on its card on the homepage. An address without a page lists every article with a link, drafts included.

## A blog repository

A blog is an ordinary repository. Bake reads it from the blog root:

```
my-blog/
  bake.config.js        site title, URL, language, default theme and theme options
  preamble.sty          math macros shared by every article
  package.json          Bake and the npm packages that components use
  content/
    posts/
      2026-10/
        llm-act-fns/
          index.md      one article per folder, with its images and data next to it
          components/   optional: components that only this article uses
  components/           interactive components that any article can use, one file each
  themes/               optional: the blog's own themes
  public/               copied unchanged to the site root (favicon, CNAME)
  dist/                 build output, not committed
```

### bake.config.js

`bake.config.js` is an ES module whose default export is an object:

```js
export default {
  title: 'My Blog',
  description: 'Notes on how language models are trained.',
  url: 'https://example.github.io',
  language: 'en',
  theme: 'essay',
  themes: { essay: { toc: 'notes' } },
};
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Site name. |
| `description` | no | One sentence under the site name on the homepage and in the homepage's page description. |
| `url` | yes | Absolute `http` or `https` address of the published site. |
| `language` | yes | Language of the site, such as `en` or `zh-CN`. |
| `theme` | no | Default theme: `essay`, `bento` or the name of a folder in `themes/`. The default is `essay`. |
| `themes` | no | The options of each theme, keyed by the theme name. The `essay` theme has one option: `toc`, the table of contents style, `notes`, `tabs`, `dots` or `ticks`, `notes` by default. The `bento` theme has two options: `columns`, the number of card columns from 1000 pixels up, an integer from 1 to 6, 6 by default, and `rowHeight`, the height of one card row in pixels, from 8 to 120, 24 by default. Both are written as `themes: { essay: { toc: 'dots' }, bento: { columns: 4, rowHeight: 24 } }`. A theme of the blog declares its options in `options.js` in its folder. |
| `home` | no | `{ columns, groupBy }`: the homepage has 3, 4 or 5 columns, 3 by default, and groups articles by `category` or `month`. Articles are grouped by category when `categories` is set and by month otherwise. |
| `chat` | no | `{ pet }`: the pet of the AI chat, described in "The pet" below. The default is `crt-monitor`. |
| `categories` | no | List of `{ id, name, color, desc }`. The `id` uses lowercase letters, digits and `-` and is unique, `name` is the displayed name, `color` is a `#rrggbb` color and `desc` is an optional description. When categories are set, every article names one of them. |

Any other field is an error.

### Front matter

Each article folder under `content/posts/` holds an `index.md` that starts with YAML front matter between two `---` lines. Folders under `content/posts/` only organize files. Each article's URL is `/YYYY-MM/slug/`, taken from the `date` and `slug` fields of its front matter, so moving a folder does not change the URL.

```markdown
---
title: Activation functions in LLMs
slug: llm-act-fns
date: 2026-09-14
summary: From ReLU to SwiGLU.
tags: [LLM]
---
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Article title. |
| `slug` | yes | Last part of the URL. It may only contain lowercase letters, digits and `-`. |
| `date` | yes | Date in the form `YYYY-MM-DD`. Its year and month are part of the URL. |
| `summary` | no | One sentence for the page header, the homepage card, the page description and RSS. |
| `tags` | no | List of tags for filtering on the homepage. |
| `category` | when `categories` is set | The `id` of one of the categories in `bake.config.js`. |
| `preview` | no | Path of a script in the article folder that animates the homepage card, see [The homepage](#the-homepage). |
| `cover` | no | Path of a PNG, JPEG, GIF, WebP, AVIF or SVG image in the article folder that becomes the share image in place of the card Bake draws, see [Share images](#share-images). |
| `theme` | no | Theme of this article. The default comes from `bake.config.js`. |
| `draft` | no | `true` keeps the article out of `bake build`. `bake dev` shows it with a Draft label. |
| `page` | no | Path of an HTML file in the article folder. Bake publishes the folder unchanged and serves this file as the article's `index.html`. An `index.md` with `page` has no text after the front matter. |

The front matter can also set the options of the article's theme by their names, such as `toc: dots` in an `essay` article or `columns: 4` in a `bento` article; a value written in the front matter replaces the one in `themes` of `bake.config.js` for this article. Any other field is an error, and two articles cannot have the same URL.

## Writing an article

The text after the front matter is Markdown: CommonMark with GitHub tables, footnotes and strikethrough, math between `$` signs, and the additions below. The example blog's article `examples/blog/content/posts/syntax/index.md` shows every syntax item next to its result.

### Sections and anchors

`##` headings start the sections of an article and are numbered 01, 02 and so on. `###` headings divide a section and appear under it in the table of contents. A `#` heading is an error, because the title comes from the front matter.

Braces at the end of a heading set its attributes:

```markdown
## Activation functions in transformers {#act-fns toc="Activation functions"}
```

`#id` is the anchor of the heading in every theme; without it, the anchor is made from the heading text. The other attributes belong to the theme of the article, and an attribute that the theme does not declare is an error, so `cols` in an `essay` article and `toc` in a `bento` article are errors:

| Theme | Attribute | Meaning |
|---|---|---|
| `essay` | `toc` | A shorter title for the table of contents. |
| `bento` | `width` | Only for `##` headings: the card width of the section, `body`, `wide` or `page`. |
| `bento` | `cols` | Only for `##` headings: the number of card columns of the section, a whole number from 1 to 6. It wins over `width`. |
| `bento` | `rows` | Only for `##` headings: the height of the card of the section, as a number of rows, a whole number from 1 to 200. |

A paragraph that ends with `^name` gets the anchor `name`; the marker is not shown. Two anchors with the same name in one article are an error.

### Text

`==text==` highlights text. `**bold**`, `*italic*`, `~~strikethrough~~`, inline code, links and `$math$` work as usual, and emphasis may end next to Chinese punctuation, as in `**“引号”**后面`. A single `~` stays a tilde.

A quote whose last paragraph starts with `— ` shows that paragraph as its source:

```markdown
> We find that some of these variants yield quality improvements.
>
> — Shazeer, *GLU Variants Improve Transformer*, 2020
```

### Blocks

A block starts with a line of three or more colons and a name, and ends with a line of at least as many colons. A block inside another block uses fewer colons than the block around it. Lines inside a fenced code block never close a block. A block without a closing line and a colon line that closes no block are errors.

| Block | Meaning |
|---|---|
| `:::aside{title="Notation"}` | A callout. The title is optional. |
| `:::fold{title="Derivation"}` | A collapsed part that opens when the reader clicks its title. The title is required. |
| `:::recap` | The summary of the current `##` or `###` section. In the `essay` theme it is not shown in the text. The `notes` table of contents shows it under the section once the reader has read it, and the cards of the other styles and the phone drawer show it under the section title. A section without a recap shows the first sentence of its first paragraph there instead. The `bento` theme has no table of contents and shows the recap under the title of the card or under the `###` heading. A section has at most one. |
| `:::references` | The bibliography: a list whose items start with `[@key]`. An article has at most one. |
| `:::list-table` | A table written as a nested list, see below. |
| `:::example` | Shows the Markdown source of its content next to the result, see below. |
| `:::embed` | Shows sections or paragraphs of other articles, see [Embedding other articles](#embedding-other-articles). |
| `:::{width=wide}` | Sets the width of the one block inside it to `body`, `wide` or `page`. |

A name with a `-` is an interactive component. Any other name is a block of the theme of the article, such as `:::sticker` and `:::note` of the `bento` theme, see [Themes](#themes); a name that the theme does not declare is an error, and so is an attribute the block does not know. A block of the theme holds ordinary Markdown, with math, links, footnotes and citations, and stands at the top level of the article, outside other blocks, lists and quotes.

### Math

Math between `$` signs is inline and math between `$$` lines is a display formula. Bake typesets every formula at build time with MathJax into SVG, so the published page loads no math script. A formula MathJax cannot typeset is an error that quotes MathJax's message.

A display formula with `\label{name}` is numbered, and `\eqref{name}` in the text or in another formula links to it and shows its number. Numbered environments such as `align` number each line that is not marked `\notag`. A numbered equation without a label gets the anchor `eq-` followed by its number, such as `eq-2`. A reference to an unknown label, two equations with the same label or anchor, a `\label` in inline math, an empty `\label{}` and a `\label` on a line that is not numbered are errors.

`preamble.sty` in the blog root holds math macros shared by every article. It may only contain `\newcommand`, `\renewcommand`, `\DeclareMathOperator`, `\def`, `\let`, `\newenvironment`, `\renewenvironment`, `\ProvidesPackage` and `\RequirePackage`, so the same file also works in LaTeX, and `\RequirePackage` only accepts the packages Bake always loads: amsmath, amssymb, amsfonts, mathtools, braket, cancel, cases, color, xcolor, gensymb and upgreek. Anything else in the file is an error. Macros defined inside one article apply only to that article.

### Code

A fenced code block names its language after the opening fence. Bake highlights it at build time with Shiki. The colors are CSS variables named `--code-…`, so the theme sets them and switches them in dark mode. An unknown language name is an error; a block without a language is shown as plain text.

### Tables

GitHub tables work as usual, and a `|` inside `$…$` in a table cell belongs to the formula and does not split the cell. A table wider than the column scrolls horizontally.

`:::list-table` writes a table as a nested list. Each item of the outer list is a row, and each item of its inner list is a cell, so a cell can hold several paragraphs, lists or code. The first row is the header. Every row must have as many cells as the header row.

```markdown
:::list-table
- - Function
  - Formula
- - ReLU
  - $\max(0, x)$
:::
```

### Images

`![alt](relu.svg "Caption")` shows an image from the article folder. When the image stands alone on the first line of a paragraph, it is shown as a figure, its quoted title becomes the caption, and the lines after it form a new paragraph. An image inside a line of text stays inline. Braces after the image set its size and position:

```markdown
![ReLU](relu.png "The ReLU function"){width=280px float=right}
```

| Attribute | Meaning |
|---|---|
| `width`, `height` | Display size greater than zero, in pixels such as `560px` or as a percentage of the text column such as `70%`. When both are set they use the same unit. A figure with a size shrinks to that width and is centred in the column, and it is never wider than the screen. A figure without a size is never wider than the text column; a figure with a pixel width wider than the text column extends to `wide`. |
| `float` | `left` or `right`: the text flows around the figure. Only for a figure. |

Bake reads every image at build time and writes its width and height into the page, so the page does not shift while images load, and images load lazily. PNG, JPEG, GIF and WebP images are published as WebP next to the original name, PNG and GIF without loss. The original file is published as well only when a link or raw HTML in the article refers to it. An image wider than twice its largest display width, or twice the page width of 1340 pixels when no width is set, is scaled down. SVG and AVIF images are published unchanged. An image that is not a file in the article folder, an image in another format, an image that cannot be read, for example because it has more pixels than the image library accepts, and two images published under the same name are errors. To make an image wider than the text, wrap it in `:::{width=wide}` or `:::{width=page}`.

### Widths

`:::{width=body}`, `:::{width=wide}` and `:::{width=page}` set the width of the one block inside them, such as a formula, a code block, a table, an image or a component. `body` is the width of the text, `wide` extends into the margin and `page` uses the whole page. The theme decides how each width is laid out. A block without a width is placed automatically: it has the width of the text when it fits, extends to `wide` when it does not, and scrolls horizontally when it is wider still. For formulas, code blocks, and figures and components with a pixel width, Bake records the natural width at build time, and the stylesheet sizes these blocks, also without scripts and at every text size the reader chooses; for tables and components without a pixel width the page measures it. A figure without a size stays at the width of the text.

### Examples

`:::example` shows the Markdown source of its content next to the rendered result; on a narrow screen the source is above the result. Headings inside an example do not enter the table of contents or the section numbering. Sidenotes, citations and equation numbers inside an example are numbered together with the rest of the article.

### Components

A component is an interactive figure that the blog writes in JavaScript. It is a file `components/<name>.js` or `components/<name>.jsx` in the blog root, and an article shows it with a block of that name:

```markdown
:::act-fn-plot{fn=silu range=6}
The curve of SiLU. Drag the slider to change β.
:::
```

The text between the two lines is the caption under the component, written in Markdown; a component without a caption has nothing between them. A component is always a block of its own and cannot appear inside a paragraph.

A component that only one article uses can live in a `components/` folder inside the folder of that article, such as `content/posts/2026-10/llm-act-fns/components/glu-heatmap.jsx`. Only that article can show it; a block of it in another article is an error at the block. The files of this folder, with the modules and styles that its components import, are not published with the article. `bake dev` rebuilds the components when a file in it changes, as it does for `components/`.

The file name is both the custom element name and the block name, so it uses lowercase letters and digits with at least one `-`, such as `act-fn-plot`. A name that HTML reserves, such as `font-face`, the name of a built-in block, such as `aside`, and two files with the same name in the whole blog, in `components/` or in the `components/` folder of any article and with the same or a different extension, are errors, reported at each of the files.

```jsx
import './act-fn-plot.css';

export const params = {
  fn: { label: 'Function', type: 'enum', options: ['relu', 'gelu', 'silu'], default: 'gelu' },
  range: { label: 'Range', type: 'number', min: 1, max: 10, step: 1, default: 4 },
};

export const layout = { width: 'body' };

export default function ActFnPlot(props) {
  return <p>{props.fn} from -{props.range} to {props.range}</p>;
}
```

The default export is the component. A class that extends `HTMLElement` is defined as the custom element of that name. Any other default export is a [SolidJS](https://www.solidjs.com/) component, which Bake wraps in a custom element. A file without a default export is an error.

- A SolidJS component receives the parameter values as its props. When the values change, as they do while you move a control of the parameter bar in `bake dev`, the props change and the component updates.
- A custom element finds the parameter values in `this.params` when it is connected. When the values change, Bake sets `this.params` again and calls the element's `update()` method if it has one.

The file may import npm packages that the blog installs, other files of the blog, and CSS files, which the page loads together with the component. Bake bundles each component into its own script, which a page downloads only when its article uses the component.

`params` and `layout` are optional. Bake reads both at build time without running the file, so each is written as `export const` with a literal value: strings, numbers, `true`, `false`, `null`, lists, objects, template strings without `${…}`, and names of `const` declarations of the same file with such a value. Anything else, such as a function call, an arithmetic expression or an imported name, is an error at its position. The rest of the file runs only in the browser, so it may use browser APIs at its top level; an error there shows the component as failed on the page.

`params` maps the name of each parameter to its declaration. An article sets a parameter with the attribute of the same name, and a parameter that the article does not set has its default. Every declaration has `label`, the text next to its control in the parameter bar, `type` and `default`:

| Type | Written in the article | Other fields |
|---|---|---|
| `number` | A number, such as `range=6` | `min`, `max` and `step`, all optional |
| `text` | Any text, in quotes when it has spaces, such as `title="Two words"` | |
| `boolean` | `name` or `name=true` for true, `name=false` for false | |
| `enum` | One of the options, such as `fn=silu` | `options`, the list of allowed strings |
| `file` | The path of a file in the article folder, such as `data=ffn-share.json`; the component receives the address of the published file | |

The names `width`, `height`, `id` and `class` cannot be parameters. An unknown field of a declaration, a default that does not fit its declaration, an attribute that is not a parameter of the component, a value that does not fit its parameter and a file that is not in the article folder are errors at their positions.

`layout` describes the box of the component on the page:

| Field | Meaning |
|---|---|
| `width` | `body`, `wide` or `page`, see [Widths](#widths), a size in pixels such as `560px`, or a percentage of the text column up to `100%`. The default is `body`. |
| `height` | A number of pixels, or `{ ratio }`, the width divided by the height, such as `{ ratio: 1.5 }`, for a component that fills a box of that size. |
| `frame` | `false` shows the component without the frame, the border and background, that the theme draws around it. The default is `true`. |

The `width` and `height` attributes of the block replace the declared values for one use: `width` takes the same values as `layout.width` and `auto` for the declared width, and `height` takes a number of pixels, such as `:::bar-chart{height=320}`.

A component without `layout.height` shows a placeholder of the theme's height `--component-placeholder-height` until it starts and then takes the height of its content, so it lays out its content for every width itself. A component that fills a box of a given size, such as a heatmap drawn to the size of its box, declares `layout.height`; its box has that height at every screen width, before and after the component starts. A component starts when it comes within one and a half screen heights of the visible part of the page, so its height changes before the reader reaches it; when a component above the visible part changes its height, the browser keeps the visible text in place, which Safari does from version 27 on.

Two modules of Bake are available to components:

- `bake/kit` holds SolidJS parts for figures, styled with the colours and fonts of the theme, so they follow the dark mode: the controls `Controls`, `Slider`, `Segmented`, `Toggle` and `Button`; the plot parts `Plot`, `Axes`, `Curve`, `Crosshair` and `usePlot`; `Legend` and `Swatch`; `Tex` and `SvgTex`, which typeset a TeX formula with the macros of `preamble.sty` in HTML or inside an SVG drawing, and `MathText` and `SvgMathText`, which show a line of text with formulas between `$` signs, or `$$` for a formula on its own line, in HTML or inside an SVG drawing, where `within={[left, right]}` moves a label sideways to keep it between two x positions; `divergingColors`, which maps a value from −1 to 1 to the theme's diverging colours `--diverge-low`, `--diverge-mid` and `--diverge-high`; the number helpers `linearScale`, `niceTicks`, `samplePath`, `formatNumber` and `stepDigits`; `createElementSize`, the size of an element as a signal; and `createTween` and `prefersReducedMotion` for animations that stop when the reader prefers reduced motion. Using the kit is optional, and a custom element can import its number helpers too.
- `bake/math` exports `texToSvg(formula, { display })`, which typesets a TeX formula with the macros of `preamble.sty` and resolves to an SVG element.

In `bake dev`, every component shows a parameter bar with one control per parameter, see [bake dev](#bake-dev). The bar shows a number field for a number, with a slider next to it when the declaration has `min` and `max`, a list for an enum, a switch for a boolean, and a text field for text and a file.

### Sidenotes and citations

Footnotes become numbered sidenotes, numbered in the order in which the text first refers to them:

```markdown
The activation can run in the GEMM epilogue[^gemm].

[^gemm]: The epilogue is the stage of a matrix multiplication kernel that processes each result element.
```

`[@key]` cites an entry of `:::references`. Citations are numbered by their first appearance, and entries that are never cited are listed after the numbered ones without a number. The `essay` and `bento` themes show the list under the label References, or 参考文献 on a Chinese site, unless the block directly follows a heading:

```markdown
Gated variants lower the loss [@shazeer2020].

:::references
- [@shazeer2020] Shazeer. *GLU Variants Improve Transformer*. 2020.
:::
```

A footnote reference without a definition, a definition that is never used and a citation that is not in `:::references` are errors.

### Links between articles

A link whose address is the address of an article on the site, `/YYYY-MM/slug/`, optionally followed by `#anchor`, is an internal link. The anchor names a heading, the `^name` of a paragraph, a sidenote such as `sidenote-2`, a reference entry such as `reference-shazeer2020`, or an equation by its label or its `eq-` anchor:

```markdown
The backward pass follows the [chain rule](/2026-07/matrix-calculus/#chain-rule).
```

Bake checks every internal link after it has read all articles. A link to an article or an anchor that does not exist is an error. When an article with the same slug exists under another month, the error gives its current address, because such a link usually broke when the date of the article changed; the address of a draft is never given. An address written without the trailing slash or with `index.html`, such as `/2026-07/matrix-calculus` or `/2026-07/matrix-calculus/index.html#chain-rule`, is an error that gives the address to write. A query string is kept in the link and does not change the check. A link from a published article to a draft is an error. A link to an anchor on the same page, such as `[see above](#act-fns)`, may name the same kinds of anchors and must exist in the article. Addresses with a scheme, such as `https://…`, are not checked. Bake writes internal links relative to the page, so the site also works when it is published under a sub-path.

In the `essay` and `bento` themes, when the reader rests the pointer on an internal link or moves the keyboard focus to it, a card shows the title of the target article, the number and title of the section, and the content at the target with its formulas: the first paragraphs of a section, the paragraph, the formula of an equation or the text of a sidenote. A link to a reference entry shows the entry, as a citation does. A click on the card opens the target. On a touch screen there is no card, and a tap on the link opens the target.

### Embedding other articles

`:::embed` lists internal addresses, one per line, and shows their content in this article in the order of the lines:

```markdown
:::embed
/2026-07/matrix-calculus/#chain-rule
/2026-09/autodiff/#vjp
:::
```

The address of a heading embeds its section up to the next heading of the same or a higher level, and the address of a paragraph anchor embeds that paragraph. All parts of one `:::embed` form one block, and each part ends with a line that names its article and section and links to them. Embedded content keeps its layout, its equation numbers and its components. Its headings do not enter the table of contents or the section numbering of this article, its sidenotes are not shown, and an `:::embed` inside it is shown as a link. Bake reads the embedded content on every build, so a change in the source article reaches every article that embeds it. Embedding the article itself, an address without an anchor, a target that does not exist or is not a heading or a paragraph, the same address twice and an address whose section contains another address of the same block are errors.

## The homepage

`dist/index.html` lists every published article as a card: a 16:9 preview, the title, the summary, the date and the tags. Plain HTML pages get the same card as Markdown articles. A bar at the top of the screen switches between two groupings. Grouped by category, the articles are listed under each category in the order of `categories`, with its colour, description and number of articles, and the bar holds a chip for every category that jumps to its group and is highlighted while that group is on screen; categories without published articles are left out. Grouped by month, the newest month comes first, and the bar holds a chip for every tag that shows only the articles with that tag. Without `categories` the homepage is grouped by month only. On screens of 1000 pixels and up the reader can choose 3, 4 or 5 columns; narrower screens fit as many columns as the width allows. `home.groupBy` and `home.columns` set the defaults, and the browser remembers the reader's choice. Without scripts the default grouping is shown and the category chips still jump to their groups. A blog without published articles gets a homepage with one line that says there are no posts yet.

The card shows the article's first image when the article has no `preview` script, and a block in the category colour with the title when it has no image either. A `preview` script is an ES module in the article folder whose default export receives an empty element that covers the card's frame, draws the first frame into it and returns an object with `start` and `stop`:

```js
export default function preview(element) {
  element.innerHTML = '<svg viewBox="0 0 320 180"><circle cx="160" cy="90" r="40" fill="var(--series-1)"/></svg>';
  let frame = 0;
  return {
    start() {
      const step = (time) => {
        element.querySelector('circle').setAttribute('cx', 160 + 100 * Math.sin(time / 600));
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    },
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
```

The homepage loads a preview when its card comes near the screen. The animation runs while the pointer rests on the card or the card has keyboard focus, and on a phone while the card is in the middle of the screen. It stops whenever the card is off the screen. When the reader asks for reduced motion, only the first frame is shown. A preview that fails to load or throws is logged to the console and the card keeps its image or colour block. Colours should come from the theme's CSS variables such as `var(--ink)` and `var(--series-1)`, so the preview follows dark mode.

## Share images

When a link to an article is shared on a social network or in a chat, the preview shows the article's share image. `bake build` draws one for every published Markdown article: a 1200 by 630 pixel PNG with a strip in the category colour, the site title and the category name, the title, the summary and, on the right, the first frame of the article's `preview` script. It uses the fonts and the light colours of the site theme. The article page names the image in its `og:image` and `twitter:image` tags with an absolute address built from `url` in `bake.config.js`, and sets `twitter:card` to `summary_large_image`. A plain HTML page is published unchanged, so no tag could name an image, and Bake draws none for it.

With `cover` in the front matter, that image becomes the share image instead. Bake reads the image to find its format, whatever its file name says: a PNG, JPEG, GIF or WebP image is published unchanged, and an SVG or AVIF image, which social networks do not show, is converted to a PNG of the same size.

Bake draws the cards with Chromium through Playwright, which is installed with Bake. Install Playwright's Chromium once with:

```bash
npx playwright install chromium
```

When Chromium is missing, `bake build` reports it with this command and writes nothing. The name of each image contains a hash of everything that goes into the card, including the preview script and every other file in the article folder. When `dist/` already holds an image with that name, `bake build` copies it instead of drawing the card again, so a build in which no card changed does not start Chromium. A preview script that throws or does not draw within 10 seconds is reported at the `preview` field, together with every other problem of the build. `bake dev` draws no share images.

A blog that deploys with GitHub Actions installs Chromium and the system libraries it needs in the deploy job, before `bake build`:

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ hashFiles('package-lock.json') }}
- run: npx playwright install --with-deps chromium
- run: npx bake build
```

The cache step is optional: it keeps the Chromium download between runs, and `npx playwright install` skips the download when the cached browser is already there. A fresh checkout has no `dist/`, so every deploy draws every card again; only local builds reuse the cards in `dist/`.

## AI chat

Every article page and the homepage show a small animated pet in the bottom right corner. Clicking the pet opens a chat with DeepSeek: an input field and the latest messages appear as bubbles to the left of the pet. The answers of the model are on the right and the questions of the reader on the left. Escape, a click outside the chat or a second click on the pet closes it. On an article page a question is about that article, whose Markdown source goes with every question, and the model can also read other articles of the blog. On the homepage the chat is about the whole blog: the model gets the list of articles with their summaries and sections, reads the articles a question needs, and links its answer to those articles and sections. Typing `@` in the input field opens a list of articles, months, categories and tags; the reader picks one or more of them to limit the question to those articles. When the reader selects a passage of an article, a button under the selection asks about it and quotes it in the question. Answers appear as they are written, and formulas are typeset with the macros of `preamble.sty`. A settings button in the input field starts a new chat, turns DeepSeek's thinking mode on and off, changes or clears the key and chooses another pet.

There is no server. Each reader enters their own DeepSeek API key, and the browser sends the questions directly to DeepSeek. The key is never stored as plain text: the browser creates a passkey for the site, and the key is encrypted with a secret that only that passkey can produce, through the PRF extension of WebAuthn. The reader unlocks the key with Touch ID, Windows Hello or a security key. The browser then keeps the decryption key, which scripts cannot read out, in the site's storage for 30 days, so the pages of the site use the API key without asking again during that time. Saving or unlocking the key starts the 30 days again, and clearing the key in the chat settings forgets both. A browser that does not report support for the PRF extension shows no chat, and an authenticator without it stores no key.

Passkeys need a secure address with a host name, so the chat appears on sites served over HTTPS and on `localhost`, which includes `bake dev`, and not at addresses such as `http://127.0.0.1:8000`. `bake build` publishes the `index.md` of every article next to its page and a list of the articles at `_bake/articles.json`, which the chat downloads when the reader sends the first question or types `@`. A page without scripts shows nothing of the chat.

### The pet

The pet uses the format of Codex pets: a folder with a `pet.json`, of which Bake reads only `displayName` and `spritesheetPath`, and a PNG or WebP spritesheet of 8 columns and 9 rows of 192 by 208 pixel frames, 1536 by 1872 pixels. Sheets of 1536 by 2288 pixels, which have two more rows, are accepted and cropped to the first 9 rows. The pet waves when the pointer or the keyboard reaches it, runs while an answer is written, reads while the model reads articles, waits while the passkey is used, jumps when an answer is done and shows a failed pose after an error. Readers who prefer reduced motion see the first frame of each pose.

`chat.pet` in `bake.config.js` chooses the pet of the site:

```js
export default {
  // ...
  chat: { pet: 'miso' },
};
```

| Value | Pet |
|---|---|
| `crt-monitor` | The built-in CRT Monitor. This is the default. |
| `miso` | The built-in Miso, an otter. |
| A folder of the blog, such as `pets/bun` | The pet in that folder. |
| An `http` or `https` address of a `pet.json` | The pet at that address, which `bake build` downloads, checks and publishes with the site. |

`bake build` publishes the pet in `_bake/pet/`, together with its first frame as a small image that the page shows until the pointer or the keyboard reaches the pet; the page downloads the whole spritesheet only then. A spritesheet of another size or one that is not a PNG or WebP image is reported as an error, and so is a spritesheet larger than 5 MB, whether it comes from a folder or an address, or one that would be larger than 5 MB after Bake converts it to WebP. `pet.json` may have at most 64 KB, and `spritesheetPath` must name a file inside the pet folder.

Readers can choose their own pet in the chat settings by pasting the address of a `pet.json`. The browser downloads it without cookies and without the address of the page, refuses a spritesheet larger than 5 MB, of another size or in a format other than PNG and WebP, shows the name of the pet only as text, and remembers the choice in this browser.

The built-in pets have their own licenses, which the chat settings name in one line:

- CRT Monitor, "CRT Monitor — Codex Pet" by wxy, from https://github.com/wxy/codex-pets/tree/57a8c87c2abe1a9f3140c84ed2bdfcea0bc6b1de/pets/crt-monitor, is licensed under CC BY 4.0. Bake cropped the spritesheet to its first 9 rows and converted it to lossy WebP. The license notice is `src/chat/pets/crt-monitor/LICENSE`.
- Miso, by gaerae, from https://github.com/gaerae/playpets/tree/40d0c5aa87038e4e73d0ca61da35a2b4a900e65b/assets/pets/miso, is licensed under the MIT license. Bake cropped the spritesheet to its first 9 rows and converted it to lossy WebP. The license is `src/chat/pets/miso/LICENSE`.

## Themes

A theme decides how every article page looks. The `essay` theme lays an article out in three columns: the table of contents on the left, the text in an 820 pixel column, and the sidenotes on the right. Below 1000 pixels the page has one column and a sidenote opens under its paragraph when the reader taps its number.

The `essay` theme has four table of contents styles, which its option `toc` selects:

| Style | From 1340 pixels | From 1000 to 1339 pixels |
|---|---|---|
| `notes` | The list of chapters and sections in the left column, with the current entry marked, the chapters ahead faded, and the recap of each section shown once the reader has read it | One tick per heading at the left edge; pointing at the ticks or clicking them opens the list in a panel |
| `tabs` | One tab per chapter with its number and a vertical title; pointing at a tab opens a card of the chapter joined to the tab | The same |
| `dots` | One dot per chapter; the current chapter grows into a capsule that fills as the reader moves through it, and pointing at a dot shows a card of the chapter | The same |
| `ticks` | One tick per heading; pointing at the ticks shows a card of the chapter | The same |

A card lists the sections of the chapter with their recaps, marks the sections already read and the current one, and links to every heading. The keyboard reaches the tabs, the dots and the ticks before the rest of the page; focusing one opens the card of its chapter, and Tab moves through the links of the card to the next chapter. Below 1000 pixels every style shows a handle at the left edge that opens a drawer with the chapters on one side and the card of the chosen chapter on the other. Without scripts the page shows the plain list of headings with links. Headings and the title are set in LXGW WenKai, which Bake publishes with the site, and the text in the system's sans-serif font.

The `bento` theme lays the same Markdown out as a grid of cards, one card per `##` section, with the colours and fonts of `essay`. The title, the summary and the text before the first `##` heading stand above the grid. From 1000 pixels up the grid has `themes.bento.columns` columns. A section asks for its width with `cols` or `width` on its heading: `body` is a third of the columns, `wide` is half of them and `page` is all of them, so with 6 columns these are 2, 3 and 6. A section without either spans the whole row when it contains a block with `:::{width=page}`, half of the columns when it contains a block with `:::{width=wide}` or a block that does not fit into a third, such as a long line of code or a component with a pixel width, and a third otherwise. From 1000 pixels up the cards are placed in the order of the article, each one in the columns whose lowest card ends highest. Below 1000 pixels the cards wrap into rows in the order of the article. A card starts as wide as its span in the columns of a screen 1000 pixels wide, or as the whole row when that is more than half of the row; the cards of a row then grow to fill it without gaps and are as tall as the tallest of them; `rows` has no effect there. From 1000 pixels up a card is as tall as its content, unless its heading sets `rows`: then the card is that many rows of `themes.bento.rowHeight` pixels tall, the content that does not fit is hidden under a fade at the bottom, and the card scrolls after the reader clicks it or moves keyboard focus into it. In `bake dev` such a card shows how many pixels do not fit and the smallest `rows` that fits them. The sidenotes of a section follow its last block at the bottom of its card. The recap of a section is shown under the title of its card, and the recap of a `###` section under its heading. The page has no table of contents, so `toc` on a heading is an error. Without scripts, every card keeps the span its width gives it from 1000 pixels up, the grid has one column below, and every card is as tall as its content.

The `bento` theme has two blocks of its own, each drawn as a card of its own after the card of the section it is written in:

```markdown
:::sticker
🧪
:::

:::note{cols=2 color=blue}
PyTorch's `F.gelu(x, approximate="tanh")` is the approximation above.
:::
```

`:::sticker` holds a short text, an emoji or a small image and is drawn as a tilted sticker; an emoji alone is drawn large. `:::note` holds any Markdown, with math, links and footnotes, on a tinted card; `color` is `yellow`, `green`, `blue` or `pink`, `yellow` by default. Both take `cols`, the card columns, 1 for a sticker and a third of the columns for a note by default, and `rows`, which works as on a heading. From 1000 pixels up the section cards are placed first, and then each sticker and note, in the order of the article, goes to the highest place where it fits next to the cards placed before it, which fills the gaps the section cards leave, and to the leftmost of equally high places. Below 1000 pixels and without scripts they follow the order of the article.

A round settings button with a gear icon at the bottom left of every page, the homepage included, lets the reader choose a light or dark theme or follow the system, and switch the text to LXGW WenKai, which is only downloaded when the reader chooses it. On an article page the settings also let the reader choose the table of contents style from a list that shows a drawing of each style and marks the style of the article as the default; the choice then replaces the style of every article. Below 1000 pixels the settings button is a tab on the left edge, under the table of contents handle on an article page, and on an article page both slide out of view while the reader scrolls down and return when the reader scrolls up; a switch in the settings keeps them in view. The `bento` theme has no table of contents, so its settings offer only the theme and the body font, and its settings button stays in view. The browser remembers these choices, and the page applies them before it is first shown.

In the `essay` and `bento` themes, copying a selection of an article puts its Markdown source on the clipboard as plain text, and its formatted content as HTML for editors such as Notion or Word. The Markdown is the part of `index.md` between the two ends of the selection. An end inside a formula, a component, an embed, a footnote number or a citation moves to its edge, and so does an end inside a heading or a table row when the selection reaches beyond it. The opening and closing markup of the emphasis, links and other elements that the selection cuts is added, and the definitions of the footnotes it refers to are appended. Inside embedded content the copy is the Markdown of the embedded article, with the addresses of its images replaced by those of the published files. HTML written in the Markdown is copied as written. The Copy as Markdown button in the page header copies the whole `index.md`.

### Writing a theme

A theme is a folder of [SolidJS](https://www.solidjs.com/) components that Bake renders to static HTML at build time, plus the scripts and styles that run in the browser. A blog adds its own theme as a folder `themes/<name>/`, and an article or `bake.config.js` selects it by the folder name. The site theme is the one that `theme` in `bake.config.js` names; it also renders the homepage and the 404 page.

| File | Required | Content |
|---|---|---|
| `page.jsx` | yes | Default export: the component of an article page. |
| `client.jsx` | yes | Default export: the function `start(document)`, which starts the page script. The CSS files it imports are the stylesheets of the pages. |
| `home.jsx` | in the site theme | Default export: the component of the homepage. |
| `not-found.jsx` | in the site theme | Default export: the component of the 404 page. |
| `theme.css` | in the site theme | A stylesheet that Bake publishes as `_bake/theme.css`, for plain HTML pages, see `page` in [Front matter](#front-matter). |
| `fonts.css` | no | `@font-face` rules, which the pages load without delaying the first paint. |
| `options.js` | no | The declarations of the theme's options, reader settings, heading attributes and blocks. |

`page.jsx` receives these props:

| Prop | Content |
|---|---|
| `site` | `title`, `url`, `language` and `description` of `bake.config.js`, and `link`, the absolute address of the homepage. |
| `article` | `title`, `summary`, `date`, `tags`, `category`, `draft`, `url`, `link`, the absolute address of the page, `shareImage`, `words` and `content`, the structure of the article: `intro`, the blocks before the first `##` heading; `sections`, each with its number, title, `attributes`, `blocks` and recap; `sidenotes`; `references`; `toc`; and `source`, the text of `index.md`. Each block has `type`, `html`, `line` and `endLine`. |
| `assets` | `root`, the address of the site root relative to the page, and the addresses of the `styles`, `fonts` and `scripts` that the page loads. |
| `options` | The values of the theme's options for this article, from `themes` in `bake.config.js` and the front matter. |

`home.jsx` receives `site`, `options`, `home` with `groupBy`, `columns` and `categories`, `articles`, the published articles with their card fields, and `assets`. `not-found.jsx` receives `site`, `options`, `articles` with the `title` and `url` of each published article, and `assets`.

A theme builds these pages from the parts that `bake/theme` exports. `ArticleDocument` writes the document of an article page: the head with the scripts and stylesheets of `assets`, the reader settings, the source of the article and the edge areas. `Header`, `arrange`, `Block`, `SectionHeading` and `Sidenotes` render the header and the article, and `Home` and `NotFound` are the homepage and the 404 page of the built-in themes. A page that does not use `ArticleDocument` or `Home` writes the parts that Bake relies on itself:

- The `data-region` attributes, with the names in `REGIONS` of `bake/regions`: `article` on the element that holds the article, and `toc`, `source`, `glyphs`, `previews` and `words` on the other parts that change with the Markdown. When an article is saved, `bake dev` replaces these parts in place and reloads the page for any other change.
- The source of the article, `<script type="application/json" class="bk-source">` with the text of `article.content.source` as JSON. Copying as Markdown reads it, and `startCopy` from `bake/copy` reports an error when it is missing.
- `data-line` and `data-end-line` on the elements of headings, blocks and sidenotes, from their `line` and `endLine`. `bake dev` uses them to highlight changes and to open the editor at a block, and copying as Markdown takes the source of these elements from them. `Block`, `SectionHeading` and `Sidenotes` write them, and a theme writes them on a block of its own. The HTML that Bake renders from Markdown carries `data-src` with the offsets of each element in the source, which a theme keeps as it is.
- `data-ui`, the selector `UI` of `bake/regions`, on interface elements inside the article, such as heading links and section numbers. Copying as Markdown leaves them out.
- The two edge areas, `<div data-edge="start">` and `<div data-edge="end">`, at the end of the body. They are fixed at the bottom left and the bottom right and stack their children in a column: the settings button and the table of contents handle go into the start area, the AI chat and the `bake dev` bar into the end area. A theme hides an area with `data-hidden` on it.

`client.jsx` starts the page script. Bake calls its default export `start(document)` when the page loads; `start` returns a function that stops what it started, its listeners, observers and created elements. In `bake dev`, after each update of the article in place, Bake calls that function and then `start` again. Code that does not depend on the article, such as the settings panel, runs once at the top level of `client.jsx`. `bake/live` exports `livePage(start)`, which Bake applies to the default export; another module that has to start again after each update calls it with its own `start`. `bake/theme/client` exports the scripts of the built-in themes, among them `startArticle(article)`, which starts the toast, the folds, the heading links, copying as Markdown, the preview card and the sidenote highlighting, and `startSettings`, `startHome`, `startNotFound` and `startLayout`.

The stylesheets of a theme import the shared styles from `bake/theme/styles/`, such as `tokens.css`, `page.css` and `blocks.css`, and the styles of a built-in theme from `bake/themes/<name>/styles/`. An `@import` resolves relative to its file or through these two prefixes. The article styles of `blocks.css` and `page.css` stop at the box of a component, so they do not reach the content of a component, and `--component-placeholder-height` in `tokens.css` sets the height of a component before it starts.

`options.js` has no imports. It exports `options`, the theme's options, declared like the parameters of a component and set in `themes` of `bake.config.js` and in the front matter; an option cannot have the name of a field of the front matter. It may export `settings`, the reader settings the theme adds to the color scheme, font, size, weight and spacing. A setting is named with lowercase letters and digits and declared as `{ values, default, control }`: `values` lists its values, `default` is one of them or `{ option: 'name' }` for the value of an enum option, and `control` is `segmented`, `switch` (two values, the first when it is on) or `list`. `ArticleDocument` takes the settings and the page's options and writes the starting value of each setting as a `data-` attribute of the `<html>` element, and `startSettings(settings, { labels, drawings })` from `bake/theme/client` shows them in the settings panel. `options.js` may also export `headings` and `blocks`, the Markdown that the theme reads beyond what every article has. `headings` maps the name of each heading attribute other than `#id` to its declaration, and `blocks` maps the name of each block of the theme, written with lowercase letters and digits, to the declarations of its attributes; a block cannot take the name of a block of Bake. An attribute is declared as `{ type }`, where the type is `number` with the optional fields `min`, `max` and `step`, `text`, `enum` with `options`, a list of strings, or `boolean`, and a heading attribute may add `depth`, the one heading level it applies to, such as 2 for `##`. The Markdown of each article is checked against the declarations of its theme. The prop `article.content` gives each section, each heading in a section and each entry of `toc` its `attributes`, with numbers and booleans as values of their type, and gives each block of the theme as a block `{ type: 'themeBlock', name, attributes, html }`, where `html` is the Markdown inside it rendered to HTML, which `page.jsx` places at build time.

The built-in themes are modules that the files of a theme import: `bake/themes/essay` exports `Page`, `Article`, `Toc` and `essayLabels`, `bake/themes/bento` exports `Page` and `Article`, and each has `/client`, `/options` and `/styles/*.css`; the parts they share are `bake/theme`, `bake/theme/client` and `bake/theme/styles/*.css`. A blog changes a built-in theme with a theme folder of another name whose files import the parts they keep and replace the others. For example, `themes/mine/page.jsx` can render its own header next to the essay `Toc` and `Article`, with `export { default } from 'bake/themes/essay/client';` as `themes/mine/client.jsx` and the essay option `toc` and heading attribute `toc` copied into `themes/mine/options.js`; an article with `theme: mine` then has the essay page with that header.

Bake reports these problems of a theme as errors: a folder named `themes/essay` or `themes/bento`, which names the module to import instead; a missing required file; a `client.jsx` without a default export; a mistake in the declarations of `options.js`, at that file; a file that cannot be compiled, at the position of the problem; and a page that throws while it renders, at the article, or at the theme folder for the homepage and the 404 page.

## Development

[CLAUDE.md](CLAUDE.md) holds the rules for changes to Bake, and [TESTING.md](TESTING.md) says how to run the tests. `make example` builds the example blog in `examples/blog/` and serves it at the address it prints, and `make dev` runs `bake dev` on the example blog.
