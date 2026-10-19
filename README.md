# Bake

Bake generates a static site from a technical blog written in Markdown. Articles can include math, code, sidenotes, folds, callouts and interactive components written as standard web components. Each article chooses a theme: `essay` lays it out as a long read with a table of contents and sidenotes, `bento` arranges its sections as cards.

> Bake is being rebuilt from scratch to follow its new design. The commands below are planned; today they print `not implemented yet`.

## Commands

```bash
bake new 2026-10/rope   # create content/posts/2026-10/rope/index.md as a draft
bake dev                # serve the blog at http://localhost:4321/ and update pages on save
bake build              # generate the static site into dist/
```

You write Markdown in the text tool of your choice. `bake dev` shows each page exactly as it will be published; after you save, the page updates in place and keeps its scroll position. Problems are listed in the terminal and on the page as `file:line:col message`.

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

Folders under `content/posts/` only organize files. Each article's URL is `/YYYY-MM/slug/`, taken from the `date` and `slug` fields of its front matter, so moving a folder does not change the URL.

```markdown
---
title: Activation functions in LLMs
slug: llm-act-fns
date: 2026-09-14
summary: From ReLU to SwiGLU.
tags: [LLM]
---
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture rules and [TESTING.md](TESTING.md) for the test commands.
