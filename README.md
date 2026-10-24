# Bake

Bake generates a static site from a technical blog written in Markdown. Articles can include math, code, sidenotes, folds, callouts and interactive components written as standard web components. Each article chooses a theme: `essay` lays it out as a long read with a table of contents and sidenotes, `bento` arranges its sections as cards.

## Install

Bake needs Node 24 or later. A blog is an npm project that installs Bake, the npm package `@yhnocoder/bake`, as a development dependency. One command creates a blog:

```bash
npx @yhnocoder/bake init my-blog
cd my-blog
npm run dev
```

`bake init` writes the files of the blog into `my-blog/`, adds Bake to its `package.json`, runs `npm install` and downloads Playwright's Chromium, which `bake build` draws the share images with, see [Share images](#share-images). `npm run dev` runs `bake dev`, which opens the blog in the browser.

Bake can also be installed globally, so that the command `bake` is available in every folder:

```bash
npm install --global @yhnocoder/bake
bake init my-blog
```

In a folder whose `package.json` installs Bake, the global `bake` runs the Bake that the blog installs, so every computer builds the blog with the version that its `package.json` names. Inside a blog, `npx bake` and the scripts in `package.json` run that Bake too.

`bake.config.js` is an ES module, so the `package.json` of the blog sets `"type": "module"`. `bake init` sets it, and Bake reports an error at `bake.config.js` when the nearest `package.json` sets another type or none.

## Example blog

`examples/blog/` is a blog written with Bake. Its articles show every syntax item, components, embeds, plain HTML pages and both themes, see [Writing an article](#writing-an-article). `make example` builds it and serves it with `bake preview` at the address it prints. The `demo` workflow in `.github/workflows/demo.yml` builds it with the address of this repository's GitHub Pages site and publishes it there when it is started by hand from the Actions tab; it is never started by a push.

## Commands

```bash
bake init my-blog                 # create a blog in my-blog/ and install its packages
bake new "Rope data structures"   # create content/posts/rope-data-structures/index.md as a draft
bake new 2026-10/rope             # create content/posts/2026-10/rope/index.md as a draft
bake dev                          # serve the blog at http://localhost:4321/, open it and update pages on save
bake build                        # check the blog and generate the static site into dist/
bake preview                      # build the blog for this computer and serve dist/ at http://localhost:4173/
```

Run every command except `bake init` from the blog root, the folder that contains `bake.config.js`.

`bake init [folder]` creates a blog in `folder`, or in the current folder when none is given:

- `bake.config.js` with the folder name as the site title and the language of the system, Chinese (`zh-CN`) on a system set to Chinese and English (`en`) otherwise; `--language <code>` sets another language.
- A first post at `content/posts/hello/index.md` in the language of the blog, with a section, a sidenote and a formula.
- `public/favicon.svg`, the initial of the site title on a coloured square.
- A `.gitignore` that leaves out `node_modules/`, `dist/`, `.dist-staging/` and `.dist-previous/`.
- `.github/workflows/deploy.yml`, which publishes the blog on GitHub Pages, see [Publishing on GitHub Pages](#publishing-on-github-pages).
- `package.json` with `"type": "module"`, the scripts `dev` and `build`, and Bake as a development dependency. An existing `package.json`, such as the one `npm init` writes, keeps its fields and scripts.

In a folder that already holds files, such as a Git repository, it keeps every existing file and writes only the missing ones; it adds to an existing `.gitignore` the lines it lacks and to an existing `package.json` the fields above. Then it runs `npm install` and downloads Playwright's Chromium; `--no-install` writes the files only.

`bake new <title>` creates `content/posts/<slug>/index.md` with front matter for a draft dated today. The slug is made of the letters a to z and the digits of the title, joined by `-`, so `bake new "Rope data structures"` creates the slug `rope-data-structures`; `--slug <slug>` sets the slug, which a title without such letters, such as a Chinese one, needs. `bake new <path>`, such as `bake new 2026-10/rope`, creates `content/posts/<path>/index.md` instead and takes the slug from the last folder name of the path; an argument with a `/` or made only of lowercase letters, digits and `-` is a path. The front matter lists `summary` and `tags` as comments to fill in.

`bake build` checks `bake.config.js` and the front matter and Markdown of every article that is not a draft, then writes the homepage to `dist/index.html`, each published article to `dist/YYYY-MM/slug/` together with the other files in its folder, writes the scripts and styles of the themes to `dist/assets/`, and copies `public/` to the root of `dist/`. Files and folders in an article folder whose names start with a dot are not published, and `.DS_Store` files in `public/` are not copied. A symbolic link to a file is copied as that file, and a symbolic link to a folder is skipped. It also writes `dist/404.html`, the RSS feed `dist/feed.xml`, the sitemap `dist/sitemap.xml`, `dist/robots.txt`, the theme stylesheet `dist/_bake/theme.css` and one share image per Markdown article to `dist/og/`, see [Share images](#share-images). Every build replaces `dist/` completely. Bake writes the new site into `.dist-staging/` in the blog root and moves the old one to `.dist-previous/` while it swaps them, so add both folders to the blog's `.gitignore` next to `dist/`. When Bake finds problems, it lists all of them as `file:line:col message`, prints the number of errors and leaves `dist/` unchanged.

The RSS feed holds the full text of every published Markdown article next to its summary, with its sidenotes as a numbered list at the end and every address made absolute. `robots.txt` allows every page and names the sitemap; a `robots.txt` in `public/` replaces it. A `favicon.svg`, `favicon.png` or `favicon.ico` in `public/`, looked for in that order, becomes the icon of every page; `bake init` writes a `favicon.svg`.

`bake build --url <address>` builds the site for the published address given, in place of `url` in `bake.config.js`. The pages need the address for their canonical links, the share images, the RSS feed, the sitemap and `robots.txt`; a build without either reports an error at `bake.config.js`.

`bake preview` builds the blog as `bake build` does, with the local address as the site address when `bake.config.js` sets no `url`, and serves `dist/` at http://localhost:4173/ the way GitHub Pages serves it, with `404.html` for an address without a file. It opens the address in the default browser when it runs in a terminal; `--no-open` leaves the browser closed. When port 4173 is in use, it tries 4174, 4175 and so on; `--port <number>` starts from another port. It stops when you press Ctrl+C.

### Publishing on GitHub Pages

The workflow `.github/workflows/deploy.yml` that `bake init` writes publishes the blog on GitHub Pages with GitHub Actions. Push the blog to a GitHub repository, and choose GitHub Actions as the source under Settings > Pages of the repository. Each push to `main` then installs the packages in the [Playwright container](https://playwright.dev/docs/docker) of the Playwright version that the installed Bake uses, which already holds Chromium, its system libraries and the fonts of the share images, builds the site with `bake build --url` and the address of the repository's Pages site, and publishes `dist/`; the workflow can also be started by hand from the Actions tab. The address comes from GitHub, so it includes the path of a project site, such as `https://linda.github.io/my-blog/`, and a custom domain set under Settings > Pages; `bake.config.js` needs no `url`.

A blog created before `bake init` wrote the workflow can copy this file:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  playwright:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4
        with:
          sparse-checkout: package-lock.json
          sparse-checkout-cone-mode: false
      - id: version
        run: echo "version=$(jq -r '.packages["node_modules/@yhnocoder/bake"].dependencies.playwright' package-lock.json)" >> "$GITHUB_OUTPUT"

  build:
    needs: playwright
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v${{ needs.playwright.outputs.version }}-noble
    env:
      PLAYWRIGHT_BROWSERS_PATH: /ms-playwright
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - id: pages
        uses: actions/configure-pages@v5
      - run: npx bake build --url "${{ steps.pages.outputs.base_url }}"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### bake dev

You write Markdown in the text editor of your choice, and `bake dev` shows each page as `bake build` would publish it. It builds the blog in memory, drafts included, serves it at http://localhost:4321/ and opens that address in the default browser when it runs in a terminal; `--no-open` leaves the browser closed. Open the pages at `localhost` and not at `127.0.0.1`: the AI chat stores its key with a passkey, and browsers do not create passkeys for an IP address. When port 4321 is in use, it tries 4322, 4323 and so on; `--port <number>` starts from another port. `bake dev` listens only on this computer, at `127.0.0.1`, because Write to file in a parameter bar changes files in the blog folder. `--host 0.0.0.0` makes it listen on every network interface, so a phone on the same network can open the pages too, and the terminal then also shows the addresses of the computer on the local network. Open the pages at one of those IP addresses: `bake dev` refuses requests for any host name other than `localhost`, a name that ends with `.localhost` and the name given with `--host`, so that a site cannot reach it through a DNS name that points at the computer. Only use it on a network you trust: the pages and their parameter bars are then open to everyone on that network. `bake dev` writes into the blog folder only when you press Write to file in a parameter bar, and it stops when you press Ctrl+C.

Bake watches the blog folder and rebuilds what changed each time you save a file:

- Saving the Markdown of an article replaces the article text on the open page in place. The scroll position, the table of contents and the open or closed state of every fold stay as they were. Each changed block is highlighted in light yellow for one second. When no changed block is on the screen, a notice at the bottom of the page names the section of the change, and clicking the notice scrolls there. Bake checks the links of every article again after each save, so the pages of other articles that link to the changed article or embed one of its sections are updated in the same way, and a link that no longer finds its target is reported.
- Changing the front matter of an article, `bake.config.js`, `preamble.sty` or a file in `themes/` generates the page again, and the browser reloads it at the same scroll position.
- Changing any other file, such as a component, an image or a file in `public/`, reloads the page at the same scroll position.
- The homepage at http://localhost:4321/ shows every article, drafts included, and reloads when the front matter of an article changes or an article is added or removed.

Bake reports every problem that `bake build` would report, as `file:line:col message` lines in the terminal and in a list in the bottom right corner of the page. Clicking an entry opens the file in Visual Studio Code at the position of the problem. The close button hides the list until the problems change. While the blog has errors, every page keeps showing the last version without errors, and the pages update again when the errors are fixed. When `bake dev` starts on a blog whose articles have errors, it shows the pages with those errors.

Double-clicking a block of an article, such as a paragraph, a heading or a sidenote, opens the Markdown file in Visual Studio Code at the line where the block starts. In the preview of the [VS Code extension](#editing-in-visual-studio-code), it moves the editor to that line.

Every component of the article shows a parameter bar above it, with one control per parameter. Moving a control changes the running component at once, and a control whose value differs from the Markdown is marked orange. Write to file changes the attributes of the component's `:::` line in `index.md` and leaves the rest of the file as it is; parameters set back to their default are removed from the line. Copy puts that line on the clipboard without changing the file, and Reset goes back to the values in the Markdown. When `index.md` changed after the page was built, Write to file refuses and asks you to save the file and try again. The Parameter bars switch at the top of the problems list hides and shows the bars.

A draft shows the label Draft, or 草稿 on a Chinese site, next to its date on its page and on its card on the homepage. An address without a page lists every article with a link, drafts included.

### Editing in Visual Studio Code

The folder `editors/vscode/` of the Bake repository holds an extension for Visual Studio Code. It starts `bake dev` for the blog of the article you open and shows the page next to the editor. The preview scrolls with the editor, marks the block at the cursor and shows the text as you type, before you save, without highlighting the changed blocks. The problems that Bake finds appear in the Problems panel, and the extension completes and highlights blocks, attributes, citations, footnotes and equation labels. [editors/vscode/README.md](editors/vscode/README.md) describes the features and how to install it.

`bake dev` lets only its own pages and VS Code show its pages in a frame.

## A blog repository

A blog is an ordinary repository. Bake reads it from the blog root:

```
my-blog/
  bake.config.js        site title, language, default theme and theme options
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
  public/               copied unchanged to the site root (favicon, images, CNAME)
  dist/                 build output, not committed
```

### bake.config.js

`bake.config.js` is an ES module whose default export is an object:

```js
export default {
  title: 'My Blog',
  description: 'Notes on how language models are trained.',
  language: 'en',
  theme: 'essay',
  themes: { essay: { toc: 'notes' } },
};
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Site name. |
| `description` | no | One sentence under the site name on the homepage and in the homepage's page description. |
| `url` | no | Absolute `http` or `https` address of the published site. `bake build --url` replaces it, and the workflow that `bake init` writes passes the address of the GitHub Pages site that way, so a blog published there leaves it out. `bake dev` and `bake preview` use the local address when it is not set. |
| `language` | yes | Language of the site, such as `en` or `zh-CN`. |
| `theme` | no | Default theme: `essay`, `bento` or the name of a folder in `themes/`. The default is `essay`. |
| `themes` | no | The options of each theme, keyed by the theme name. The `essay` theme has one option: `toc`, the table of contents style, `notes`, `dots` or `ticks`, `notes` by default. The `bento` theme has two options: `columns`, the number of card columns from 1000 pixels up, an integer from 1 to 6, 6 by default, and `rowHeight`, the height of one card row in pixels, from 8 to 120, 24 by default. Both are written as `themes: { essay: { toc: 'dots' }, bento: { columns: 4, rowHeight: 24 } }`. A theme of the blog declares its options in `options.js` in its folder. |
| `home` | no | `{ columns, groupBy }`: the homepage has 3, 4 or 5 columns, 3 by default, and groups articles by `category` or `month`. Articles are grouped by category when `categories` is set and by month otherwise. |
| `chat` | no | `{ pet }`: the pet of the AI chat, described in "The pet" below. The default is `crt-monitor`. |
| `categories` | no | List of `{ id, name, color, desc }`. The `id` uses lowercase letters, digits and `-` and is unique, `name` is the displayed name, `color` is a `#rrggbb` color and `desc` is an optional description. An article that names no category belongs to the category `default`, which Bake adds after the others with a grey colour and the name Default, or 默认 for a Chinese blog. To choose its name, colour, description or place, list a category with the id `default`. |

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
| `updated` | no | Date of the last change in the form `YYYY-MM-DD`, not before `date`. The page header shows it after the date, and the sitemap gives it as the last change of the page. The URL keeps the year and month of `date`. |
| `summary` | no | One sentence for the page header, the homepage card, the page description and the RSS feed. |
| `tags` | no | List of tags for filtering on the homepage. |
| `category` | no | The `id` of one of the categories in `bake.config.js`. Without it, the article belongs to the category `default`. |
| `preview` | no | Path of a script in the article folder that animates the homepage card, see [The homepage](#the-homepage). |
| `cover` | no | Path of a PNG, JPEG, GIF, WebP, AVIF or SVG image in the article folder that becomes the share image in place of the card Bake draws, see [Share images](#share-images). |
| `theme` | no | Theme of this article. The default comes from `bake.config.js`. |
| `draft` | no | `true` keeps the article out of `bake build`, which does not check it either, so a half-written draft does not stop the other articles from being published. `bake dev` shows it with a Draft label and reports its problems. |
| `page` | no | Path of an HTML file in the article folder. Bake publishes the folder unchanged and serves this file as the article's `index.html`. An `index.md` with `page` has no text after the front matter. |

The front matter can also set the options of the article's theme by their names, such as `toc: dots` in an `essay` article or `columns: 4` in a `bento` article; a value written in the front matter replaces the one in `themes` of `bake.config.js` for this article. Any other field is an error, and two articles cannot have the same URL.

## Writing an article

The articles of the example blog are the guide to writing. Each one is written in Chinese and shows its source next to its result:

- [Bake 写法一览](examples/blog/content/posts/syntax/index.md) lists every Markdown syntax item: headings and anchors, recaps, callouts and folds, sidenotes and references, math and `preamble.sty`, code, tables, images, widths, components, links between articles, `:::embed`, copying as Markdown and the build errors.
- [写交互组件](examples/blog/content/posts/components/index.md) explains how to write an interactive component: the file, its `params` and `layout`, how a parameter works together with the state inside the component, and every part of `bake/kit` with its properties.

Read them as source in `examples/blog/`, or as pages: `make example` builds the example blog and serves it with `bake preview`.

A new article takes these steps:

```bash
bake new 2026-10/rope   # content/posts/2026-10/rope/index.md, a draft dated today
bake dev                # shows the draft and updates the page on each save
```

Write the title, the summary and the text, remove `draft: true` from the front matter when the article is ready, and run `bake build`.

An image is a file in the article folder, written as a path relative to it, or a file in `public/`, written as a path that starts with `/`, such as `/images/logo.png`. Bake converts the images of the article folder to WebP and publishes the images of `public/` unchanged; an `http` or `https` address is used as written. A link to a path of the site, such as `/feed.xml`, `/files/cv.pdf` or a file in the article folder, is checked against the pages and files that `bake build` writes, and a path that starts with `/` is written relative to the page, so the links keep working when the site is published under a path such as `https://linda.github.io/my-blog/`.

## The homepage

`dist/index.html` lists every published article as a card: a 16:9 preview, the title, the summary, the date and the tags. Plain HTML pages get the same card as Markdown articles. A bar at the top of the screen switches between two groupings. Grouped by category, the articles are listed under each category in the order of `categories`, with its colour, description and number of articles, and the bar holds a chip for every category that jumps to its group and is highlighted while that group is on screen; categories without published articles are left out. Grouped by month, the newest month comes first, and the bar holds a chip for every tag that shows only the articles with that tag. Without `categories` the homepage is grouped by month only. On screens of 1000 pixels and up the reader can choose 3, 4 or 5 columns; narrower screens fit as many columns as the width allows. `home.groupBy` and `home.columns` set the defaults, and the browser remembers the reader's choice. Without scripts the default grouping is shown and the category chips still jump to their groups. A blog without published articles gets a homepage with one line that says there are no posts yet.

The card shows the article's first image when the article has no `preview` script. When it has no image either, a block in the category colour lists the numbers and titles of its first five `##` sections, or shows the title of an article without sections. A `preview` script is an ES module in the article folder whose default export receives an empty element that covers the card's frame, draws the first frame into it and returns an object with `start` and `stop`:

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

When a link to an article is shared on a social network or in a chat, the preview shows the article's share image. `bake build` draws one for every published Markdown article: a 1200 by 630 pixel PNG with a strip in the category colour, the site title and the category name, the title, the summary and, on the right, the first frame of the article's `preview` script. It uses the fonts and the light colours of the site theme. The article page names the image in its `og:image` and `twitter:image` tags with an absolute address built from the address of the site, `url` in `bake.config.js` or `bake build --url`, and sets `twitter:card` to `summary_large_image`. A plain HTML page is published unchanged, so no tag could name an image, and Bake draws none for it.

With `cover` in the front matter, that image becomes the share image instead. Bake reads the image to find its format, whatever its file name says: a PNG, JPEG, GIF or WebP image is published unchanged, and an SVG or AVIF image, which social networks do not show, is converted to a PNG of the same size.

Bake draws the cards with Chromium through Playwright, which is installed with Bake. Install Playwright's Chromium once with:

```bash
npx playwright install chromium
```

When Chromium is missing, `bake build` reports it with this command and writes nothing. The name of each image contains a hash of everything that goes into the card, including the preview script and every other file in the article folder. When `dist/` already holds an image with that name, `bake build` copies it instead of drawing the card again, so a build in which no card changed does not start Chromium. A preview script that throws or does not draw within 10 seconds is reported at the `preview` field, together with every other problem of the build. `bake dev` draws no share images.

The workflow that `bake init` writes, see [Publishing on GitHub Pages](#publishing-on-github-pages), installs Chromium and the system libraries it needs before `bake build` and keeps the Chromium download in the cache of GitHub Actions between runs. A fresh checkout has no `dist/`, so every deploy draws every card again; only local builds reuse the cards in `dist/`.

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

The `essay` theme has three table of contents styles, which its option `toc` selects:

| Style | From 1340 pixels | From 1000 to 1339 pixels |
|---|---|---|
| `notes` | The list of chapters and sections in the left column, with the current entry marked, the chapters ahead faded, and the recap of each section shown once the reader has read it | One tick per heading at the left edge; pointing at the ticks or clicking them opens the list in a panel |
| `dots` | One dot per chapter; the current chapter grows into a capsule that fills as the reader moves through it; a jump to another chapter folds the capsule, lights each dot it passes and opens the capsule of the target chapter when it arrives there; pointing at a dot shows a card of the chapter | The same |
| `ticks` | One tick per heading; pointing at the ticks shows a card of the chapter | The same |

A card lists the sections of the chapter with their recaps, marks the sections already read and the current one, and links to every heading. The keyboard reaches the dots and the ticks before the rest of the page; focusing one opens the card of its chapter, and Tab moves through the links of the card to the next chapter. Below 1000 pixels every style shows a handle at the left edge that opens a drawer with the chapters on one side and the card of the chosen chapter on the other. Without scripts the page shows the plain list of headings with links. The title, the headings and the text are set in the system's sans-serif font, or in the font the reader chooses in the settings.

The `bento` theme lays the same Markdown out as a grid of cards, one card per `##` section, with the colours and fonts of `essay`. The title, the summary and the text before the first `##` heading stand above the grid. From 1000 pixels up the grid has `themes.bento.columns` columns. A section asks for its width with `cols` or `width` on its heading: `body` is a third of the columns, `wide` is half of them and `page` is all of them, so with 6 columns these are 2, 3 and 6. A section without either spans the whole row when it contains a block with `:::{width=page}`, half of the columns when it contains a block with `:::{width=wide}` or a block that does not fit into a third, such as a long line of code or a component with a pixel width, and a third otherwise. From 1000 pixels up the cards are placed in the order of the article, each one in the columns whose lowest card ends highest. Below 1000 pixels the cards wrap into rows in the order of the article. A card starts as wide as its span in the columns of a screen 1000 pixels wide, or as the whole row when that is more than half of the row; the cards of a row then grow to fill it without gaps and are as tall as the tallest of them; `rows` has no effect there. From 1000 pixels up a card is as tall as its content, unless its heading sets `rows`: then the card is that many rows of `themes.bento.rowHeight` pixels tall, the content that does not fit is hidden under a fade at the bottom, and the card scrolls after the reader clicks it or moves keyboard focus into it. In `bake dev` such a card shows how many pixels do not fit and the smallest `rows` that fits them. The sidenotes of a section follow its last block at the bottom of its card. The recap of a section is shown under the title of its card, and the recap of a `###` section under its heading. The page has no table of contents, so `toc` on a heading is an error. Without scripts, every card keeps the span its width gives it from 1000 pixels up, the grid has one column below, and every card is as tall as its content.

The `bento` theme has two blocks of its own, each drawn as a card of its own after the card of the section it is written in:

```markdown
:::sticker{icon=flask}
:::

:::note{cols=2 color=blue}
PyTorch's `F.gelu(x, approximate="tanh")` is the approximation above.
:::
```

`:::sticker` draws one of the built-in stickers as a square card in the accent colour: `icon` names it and is `book`, `bookmark`, `chart`, `check`, `code`, `flask`, `formula`, `heart`, `idea`, `pin`, `question`, `rocket`, `star` or `warning`; a short text inside the block is written under the drawing. `:::note` holds any Markdown, with math, links and footnotes, on a tinted card; `color` is `yellow`, `green`, `blue` or `pink`, `yellow` by default. Both take `cols`, the card columns, 1 for a sticker and a third of the columns for a note by default, and `rows`, which works as on a heading. From 1000 pixels up the section cards are placed first, and then each sticker and note, in the order of the article, goes to the highest place where it fits next to the cards placed before it, which fills the gaps the section cards leave, and to the leftmost of equally high places. Below 1000 pixels and without scripts they follow the order of the article.

A round settings button with a gear icon at the bottom left of every page, the homepage included, lets the reader choose a light or dark theme or follow the system, and type the name of a font installed on the reader's device, which then sets the title, the headings and the text; an empty field keeps the system's sans-serif font. Bake publishes no font files. On an article page the settings also let the reader choose the table of contents style from a list that shows a drawing of each style; the choice then replaces the style of every article. Below 1000 pixels the settings button is a tab on the left edge, under the table of contents handle on an article page, and on an article page both slide out of view while the reader scrolls down and return when the reader scrolls up; a switch in the settings keeps them in view. The `bento` theme has no table of contents, so its settings offer only the theme and the font, and its settings button stays in view. The browser remembers these choices, and the page applies them before it is first shown.

In the `essay` and `bento` themes, copying a selection of an article puts its Markdown source on the clipboard as plain text, and its formatted content as HTML for editors such as Notion or Word. The Markdown is the part of `index.md` between the two ends of the selection. An end inside a formula, a component, an embed, a footnote number or a citation moves to its edge, and so does an end inside a heading or a table row when the selection reaches beyond it. The opening and closing markup of the emphasis, links and other elements that the selection cuts is added, and the definitions of the footnotes it refers to are appended. Inside embedded content the copy is the Markdown of the embedded article, with the addresses of its images replaced by those of the published files. HTML written in the Markdown is copied as written. The Copy as Markdown button in the page header copies the whole `index.md`.

### Writing a theme

A theme is a folder of [SolidJS](https://www.solidjs.com/) components that Bake renders to static HTML at build time, plus the scripts and styles that run in the browser. A blog adds its own theme as a folder `themes/<name>/`, and an article or `bake.config.js` selects it by the folder name. The site theme is the one that `theme` in `bake.config.js` names; it also renders the homepage and the 404 page.

| File | Required | Content |
|---|---|---|
| `page.jsx` | yes | Default export: the component of an article page. |
| `client.jsx` | yes | Default export: the function `start(document)`, which starts the page script. The CSS files it imports are the stylesheets of the pages. |
| `home.jsx` | no | Default export: the component of the homepage of the site theme. Without it, the site theme renders the homepage with `Home` of `bake/theme`. |
| `not-found.jsx` | no | Default export: the component of the 404 page of the site theme. Without it, the site theme renders the 404 page with `NotFound` of `bake/theme`. |
| `theme.css` | in the site theme | A stylesheet that Bake publishes as `_bake/theme.css`, for plain HTML pages, see `page` in [Front matter](#front-matter). |
| `options.js` | no | The declarations of the theme's options, reader settings, heading attributes and blocks. |

`page.jsx` receives these props:

| Prop | Content |
|---|---|
| `site` | `title`, `language` and `description` of `bake.config.js`, `url`, the address of the site from `bake.config.js`, `bake build --url` or the local address, `link`, the absolute address of the homepage, and `icon`, the path of the favicon in `public/`, such as `favicon.svg`, when there is one. |
| `article` | `title`, `summary`, `date`, `updated`, `tags`, `category`, `draft`, `url`, `link`, the absolute address of the page, `shareImage`, `words` and `content`, the structure of the article: `intro`, the blocks before the first `##` heading; `sections`, each with its number, title, `attributes`, `blocks` and recap; `sidenotes`; `references`; `toc`; and `source`, the text of `index.md`. Each block has `type`, `html`, `line` and `endLine`. |
| `assets` | `root`, the address of the site root relative to the page, and the addresses of the `styles` and `scripts` that the page loads. |
| `options` | The values of the theme's options for this article, from `themes` in `bake.config.js` and the front matter. |

`home.jsx` receives `site`, `options`, `home` with `groupBy`, `columns` and `categories`, `articles`, the published articles with their card fields, and `assets`. `not-found.jsx` receives `site`, `options`, `articles` with the `title` and `url` of each published article, and `assets`.

A theme builds these pages from the parts that `bake/theme` exports. `ArticleDocument` writes the document of an article page: the head with the scripts and stylesheets of `assets`, the reader settings, the source of the article and the edge areas. `Header`, `arrange`, `Block`, `SectionHeading` and `Sidenotes` render the header and the article, and `Home` and `NotFound` are the homepage and the 404 page of the built-in themes. A page that does not use `ArticleDocument`, `Home` or `NotFound` writes the parts that Bake relies on itself:

- The `data-region` attributes, with the names in `REGIONS` of `bake/regions`: `article` on the element that holds the article, and `toc`, `source`, `glyphs`, `previews` and `words` on the other parts that change with the Markdown. When an article is saved, `bake dev` replaces these parts in place and reloads the page for any other change.
- The source of the article, `<script type="application/json" class="bk-source">` with the text of `article.content.source` as JSON. Copying as Markdown reads it, and `startCopy` from `bake/copy` reports an error when it is missing.
- `data-line` and `data-end-line` on the elements of headings, blocks and sidenotes, from their `line` and `endLine`. `bake dev` uses them to highlight changes and to open the editor at a block, and copying as Markdown takes the source of these elements from them. `Block`, `SectionHeading` and `Sidenotes` write them, and a theme writes them on a block of its own. The HTML that Bake renders from Markdown carries `data-src` with the offsets of each element in the source, which a theme keeps as it is.
- `data-ui`, the selector `UI` of `bake/regions`, on interface elements inside the article, such as heading links and section numbers. Copying as Markdown leaves them out.
- The two edge areas, `<div data-edge="start">` and `<div data-edge="end">`, at the end of the body. They are fixed at the bottom left and the bottom right and stack their children in a column: the settings button and the table of contents handle go into the start area, the AI chat and the `bake dev` bar into the end area. A theme hides an area with `data-hidden` on it.

Bake checks the parts that its scripts need on every page that loads the scripts of `assets.scripts`: an article page, the homepage and the 404 page have both edge areas, and an article page also has elements with `data-region="article"` and `data-region="source"`. A page that loads none of its scripts needs none of them.

`client.jsx` starts the page script. Bake calls its default export `start(document)` when the page loads; `start` returns a function that stops what it started, its listeners, observers and created elements. In `bake dev`, after each update of the article in place, Bake calls that function and then `start` again. Code that does not depend on the article, such as the settings panel, runs once at the top level of `client.jsx`. `bake/live` exports `livePage(start)`, which Bake applies to the default export; another module that has to start again after each update calls it with its own `start`. `bake/theme/client` exports the scripts of the built-in themes, among them `startArticle(article)`, which starts the toast, the folds, the heading links, copying as Markdown, the preview card and the sidenote highlighting; `startSettings`, `startHome`, `startNotFound` and `startLayout`; and `startLeaveFade`, which fades the page out for 80 milliseconds before a link to another page of the site opens, unless the reader prefers reduced motion. Without it, the Arc browser shows an empty page and then the old page again before the next page appears.

The stylesheets of a theme import the shared styles from `bake/theme/styles/`, such as `tokens.css`, `page.css` and `blocks.css`, and the styles of a built-in theme from `bake/themes/<name>/styles/`. An `@import` resolves relative to its file or through these two prefixes. The article styles of `blocks.css` and `page.css` stop at the box of a component, so they do not reach the content of a component, and `--component-placeholder-height` in `tokens.css` sets the height of a component that declares no `layout.placeholder` before it starts.

Bake reads `options.js` without running it, so each of its exports is declared as `export const` with a value written as strings, numbers, `true`, `false`, `null`, lists, objects, template strings without `${…}` and names of constants of the same file. It exports `options`, the theme's options, declared like the parameters of a component and set in `themes` of `bake.config.js` and in the front matter; an option cannot have the name of a field of the front matter. It may export `settings`, the reader settings the theme adds to the color scheme, font, size, weight and spacing. A setting is named with lowercase letters and digits and declared as `{ values, default, control }`: `values` lists its values, `default` is one of them or `{ option: 'name' }` for the value of an enum option, and `control` is `segmented`, `switch` (two values, the first when it is on) or `list`. `ArticleDocument` takes the settings and the page's options and writes the starting value of each setting as a `data-` attribute of the `<html>` element, and `startSettings(settings, { labels, drawings })` from `bake/theme/client` shows them in the settings panel. `options.js` may also export `headings` and `blocks`, the Markdown that the theme reads beyond what every article has. `headings` maps the name of each heading attribute other than `#id` to its declaration, and `blocks` maps the name of each block of the theme, written with lowercase letters and digits, to the declarations of its attributes; a block cannot take the name of a block of Bake. An attribute is declared as `{ type }`, where the type is `number` with the optional fields `min`, `max` and `step`, `text`, `enum` with `options`, a list of strings, or `boolean`; a heading attribute may add `depth`, the one heading level it applies to, such as 2 for `##`, and a block attribute may add `required: true`, which makes a block without it an error. The Markdown of each article is checked against the declarations of its theme. The prop `article.content` gives each section, each heading in a section and each entry of `toc` its `attributes`, with numbers and booleans as values of their type, and gives each block of the theme as a block `{ type: 'themeBlock', name, attributes, html }`, where `html` is the Markdown inside it rendered to HTML, which `page.jsx` places at build time.

The built-in themes are modules that the files of a theme import: `bake/themes/essay` exports `Page`, `Article`, `Toc` and `essayLabels`, `bake/themes/bento` exports `Page` and `Article`, and each has `/client`, `/options` and `/styles/*.css`; the parts they share are `bake/theme`, `bake/theme/client` and `bake/theme/styles/*.css`. Bake resolves the `bake/` module names when it builds the themes and the components of the blog. The npm package exports none of its files, so code that Bake does not build, such as `bake.config.js`, cannot import them. A blog changes a built-in theme with a theme folder of another name whose files import the parts they keep and replace the others. For example, `themes/mine/page.jsx` can render its own header next to the essay `Toc` and `Article`, with `export { default } from 'bake/themes/essay/client';` as `themes/mine/client.jsx` and the essay option `toc` and heading attribute `toc` copied into `themes/mine/options.js`; an article with `theme: mine` then has the essay page with that header.

Bake reports these problems of a theme as errors: a folder named `themes/essay` or `themes/bento`, which names the module to import instead; a missing required file; a `client.jsx` without a default export; a mistake in the declarations of `options.js`, at that file; a file that cannot be compiled, at the position of the problem; a page that throws while it renders, at the article, or at the theme folder for the homepage and the 404 page; and a page that loads its scripts without an edge area or a region that they need, once at the file of the theme that renders it.

## Development

[CLAUDE.md](CLAUDE.md) holds the rules for changes to Bake, and [TESTING.md](TESTING.md) says how to run the tests. `make example` builds the example blog in `examples/blog/` and serves it at the address it prints, and `make dev` runs `bake dev` on the example blog.
