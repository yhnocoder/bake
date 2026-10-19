# Bake

Bake generates a static site from a technical blog written in Markdown. Articles can include math, code, sidenotes, folds, callouts and interactive components written as standard web components. Each article chooses a theme: `essay` lays it out as a long read with a table of contents and sidenotes, `bento` arranges its sections as cards.

> Bake is being rebuilt from scratch to follow its new design. `bake new` and `bake build` work today. `bake build` checks the blog, parses the Markdown of every article, typesets its math, highlights its code, converts its images, checks the links between articles, embeds the content that `:::embed` blocks list and writes one page per article and the homepage in the `essay` theme. The `bento` theme, the table of contents styles other than `notes` and components are not built yet. `bake dev` is not implemented yet.

## Commands

```bash
bake new 2026-10/rope   # create content/posts/2026-10/rope/index.md as a draft
bake dev                # serve the blog at http://localhost:4321/ and update pages on save
bake build              # check the blog and generate the static site into dist/
```

Run every command from the blog root, the folder that contains `bake.config.js`.

`bake new <path>` creates `content/posts/<path>/index.md` with front matter for a draft dated today. The last folder name of the path becomes the slug.

`bake build` checks `bake.config.js` and the front matter and Markdown of every article, then writes the homepage to `dist/index.html`, each published article to `dist/YYYY-MM/slug/` together with the other files in its folder, writes the scripts, styles and fonts of the themes to `dist/assets/`, and copies `public/` to the root of `dist/`. Files and folders in an article folder whose names start with a dot are not published, and `.DS_Store` files in `public/` are not copied. A symbolic link to a file is copied as that file, and a symbolic link to a folder is skipped. Every build replaces `dist/` completely. Bake writes the new site into `.dist-staging/` in the blog root and moves the old one to `.dist-previous/` while it swaps them, so add both folders to the blog's `.gitignore` next to `dist/`. When Bake finds problems, it lists all of them as `file:line:col message`, prints the number of errors and leaves `dist/` unchanged.

You write Markdown in the text tool of your choice. `bake dev` will show each page exactly as it will be published; after you save, the page will update in place and keep its scroll position.

## A blog repository

A blog is an ordinary repository. Bake reads it from the blog root:

```
my-blog/
  bake.config.js        site title, URL, language, default theme and table of contents style
  preamble.sty          math macros shared by every article
  package.json          npm packages used by components
  content/
    posts/
      2026-10/
        llm-act-fns/
          index.md      one article per folder, with its images and data next to it
  components/           interactive components, one file each
  themes/               optional: new themes or overrides of the built-in ones
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
  toc: 'notes',
};
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Site name. |
| `description` | no | One sentence under the site name on the homepage and in the homepage's page description. |
| `url` | yes | Absolute `http` or `https` address of the published site. |
| `language` | yes | Language of the site, such as `en` or `zh-CN`. |
| `theme` | no | Default theme: `essay`, `bento` or the name of a folder in `themes/`. The default is `essay`. |
| `toc` | no | Default table of contents style: `notes`, `tabs`, `dots` or `ticks`. The default is `notes`. |
| `bento` | no | `{ columns }`: number of card columns in the `bento` theme, a positive integer. The default is 4. |
| `home` | no | `{ columns, groupBy }`: the homepage has 3, 4 or 5 columns, 3 by default, and groups articles by `category` or `month`. Articles are grouped by category when `categories` is set and by month otherwise. |
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
| `cover` | no | Path of an image in the article folder used as the share image. |
| `theme` | no | Theme of this article. The default comes from `bake.config.js`. |
| `toc` | no | Table of contents style of this article. The default comes from `bake.config.js`. |
| `draft` | no | `true` keeps the article out of `bake build`. |
| `page` | no | Path of an HTML file in the article folder. Bake publishes the folder unchanged and serves this file as the article's `index.html`. An `index.md` with `page` has no text after the front matter. |

Any other field is an error, and two articles cannot have the same URL.

## Writing an article

The text after the front matter is Markdown: CommonMark with GitHub tables, footnotes and strikethrough, math between `$` signs, and the additions below. The example blog's article `examples/blog/content/posts/syntax/index.md` shows every syntax item next to its result.

### Sections and anchors

`##` headings start the sections of an article and are numbered 01, 02 and so on. `###` headings divide a section and appear under it in the table of contents. A `#` heading is an error, because the title comes from the front matter.

Braces at the end of a heading set its attributes:

```markdown
## Activation functions in transformers {#act-fns toc="Activation functions" width=wide}
```

| Attribute | Meaning |
|---|---|
| `#id` | The anchor of the heading. Without it, the anchor is made from the heading text. |
| `toc` | A shorter title for the table of contents. |
| `width` | Only for `##` headings: the card width of the section in the `bento` theme, `body`, `wide` or `page`. |

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
| `:::recap` | The summary of the current `##` or `###` section. It is not shown in the text; the `notes` table of contents shows it under the section once the reader has read it. A section has at most one. |
| `:::references` | The bibliography: a list whose items start with `[@key]`. An article has at most one. |
| `:::list-table` | A table written as a nested list, see below. |
| `:::example` | Shows the Markdown source of its content next to the result, see below. |
| `:::embed` | Shows sections or paragraphs of other articles, see [Embedding other articles](#embedding-other-articles). |
| `:::{width=wide}` | Sets the width of the one block inside it to `body`, `wide` or `page`. |

Any other block name without a `-` is an error, and so is an attribute the block does not know. A name with a `-` is an interactive component.

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

`:::{width=body}`, `:::{width=wide}` and `:::{width=page}` set the width of the one block inside them, such as a formula, a code block, a table, an image or a component. `body` is the width of the text, `wide` extends into the margin and `page` uses the whole page. The theme decides how each width is laid out. A block without a width is placed automatically: it has the width of the text when it fits, extends to `wide` when it does not, and scrolls horizontally when it is wider still. For formulas, code blocks and figures with a pixel width Bake records the natural width at build time; for tables and components the page measures it. A figure without a size stays at the width of the text.

### Examples

`:::example` shows the Markdown source of its content next to the rendered result; on a narrow screen the source is above the result. Headings inside an example do not enter the table of contents or the section numbering. Sidenotes, citations and equation numbers inside an example are numbered together with the rest of the article.

### Sidenotes and citations

Footnotes become numbered sidenotes, numbered in the order in which the text first refers to them:

```markdown
The activation can run in the GEMM epilogue[^gemm].

[^gemm]: The epilogue is the stage of a matrix multiplication kernel that processes each result element.
```

`[@key]` cites an entry of `:::references`. Citations are numbered by their first appearance, and entries that are never cited are listed after the numbered ones without a number. The `essay` theme shows the list under the label References, or 参考文献 on a Chinese site, unless the block directly follows a heading:

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

In the `essay` theme, when the reader rests the pointer on an internal link or moves the keyboard focus to it, a card shows the title of the target article, the number and title of the section, and the content at the target with its formulas: the first paragraphs of a section, the paragraph, the formula of an equation or the text of a sidenote. A link to a reference entry shows the entry, as a citation does. A click on the card opens the target. On a touch screen there is no card, and a tap on the link opens the target.

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

## Themes

A theme decides how every article page looks. The `essay` theme lays an article out in three columns: the table of contents on the left, the text in an 820 pixel column, and the sidenotes on the right. Below 1340 pixels the table of contents opens from a button, and below 1000 pixels the page has one column and a sidenote opens under its paragraph when the reader taps its number. Headings and the title are set in LXGW WenKai, which Bake publishes with the site, and the text in the system's sans-serif font.

A settings button at the bottom left of every page, the homepage included, lets the reader choose a light or dark theme or follow the system, and switch the text to LXGW WenKai, which is only downloaded when the reader chooses it. The browser remembers these choices, and the page applies them before it is first shown.

A theme is a folder of [SolidJS](https://www.solidjs.com/) components that Bake renders to static HTML at build time, plus the scripts and styles that run in the browser. A blog adds its own theme as a folder in `themes/` with a `page.jsx` and a `client.jsx`, plus a `home.jsx` for the homepage when `bake.config.js` selects it as the site theme, and an article or `bake.config.js` selects it by the folder name. A file in `themes/essay/` replaces the file of the same name in the built-in `essay` theme, so a blog can change one part, such as `themes/essay/header.jsx`, and keep the rest. [CONTRIBUTING.md](CONTRIBUTING.md) describes what a theme receives.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture rules and [TESTING.md](TESTING.md) for the test commands. `make example` builds the example blog in `examples/blog/` and serves it at http://127.0.0.1:8000/.
