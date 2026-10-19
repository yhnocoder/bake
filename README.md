# Bake

Bake generates a static site from a technical blog written in Markdown. Articles can include math, code, sidenotes, folds, callouts and interactive components written as standard web components. Each article chooses a theme: `essay` lays it out as a long read with a table of contents and sidenotes, `bento` arranges its sections as cards.

> Bake is being rebuilt from scratch to follow its new design. `bake new` and `bake build` work today. `bake build` checks the blog and writes one placeholder page per article, with the title and summary, until Markdown rendering is added. `bake dev` is not implemented yet.

## Commands

```bash
bake new 2026-10/rope   # create content/posts/2026-10/rope/index.md as a draft
bake dev                # serve the blog at http://localhost:4321/ and update pages on save
bake build              # check the blog and generate the static site into dist/
```

Run every command from the blog root, the folder that contains `bake.config.js`.

`bake new <path>` creates `content/posts/<path>/index.md` with front matter for a draft dated today. The last folder name of the path becomes the slug.

`bake build` checks `bake.config.js` and the front matter of every article, then writes each published article to `dist/YYYY-MM/slug/` together with the other files in its folder, and copies `public/` to the root of `dist/`. Every build replaces `dist/` completely. When Bake finds problems, it lists all of them as `file:line:col message`, prints the number of errors and leaves `dist/` unchanged.

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
  url: 'https://example.github.io',
  language: 'en',
  theme: 'essay',
  toc: 'notes',
};
```

| Field | Required | Meaning |
|---|---|---|
| `title` | yes | Site name. |
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
| `preview` | no | Path of a script in the article folder that animates the homepage card. |
| `cover` | no | Path of an image in the article folder used as the share image. |
| `theme` | no | Theme of this article. The default comes from `bake.config.js`. |
| `toc` | no | Table of contents style of this article. The default comes from `bake.config.js`. |
| `draft` | no | `true` keeps the article out of `bake build`. |
| `page` | no | Path of an HTML file in the article folder. Bake publishes the folder unchanged and serves this file as the article's `index.html`. An `index.md` with `page` has no text after the front matter. |

Any other field is an error, and two articles cannot have the same URL.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture rules and [TESTING.md](TESTING.md) for the test commands. `make example` builds the example blog in `examples/blog/` and serves it at http://127.0.0.1:8000/.
