# Bake

Bake is a static site generator for a technical blog with interactive components. The tool lives in this repository; blogs live in their own repositories.

@CONTRIBUTING.md
@TESTING.md

## Code

- No comments and no docstrings. Names and structure carry the meaning. The one exception is code that looks removable or changeable but is not: write a single line `why: <reason>` there, and use it rarely. Tool directives (`# noqa`, `// eslint-disable`, `# shellcheck`) and a script's `#!` line are not comments. `scripts/check_comment.py` enforces this.
- Everything in the repository is English: code, identifiers, test names, CLI output, error messages, commit messages and PR text.

## Commits

`<type>(<scope>): <summary>`, for example `feat(cli): list commands in --help`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.

## Pull requests

- The title says in one sentence what changed.
- The body has a "Before:" paragraph, an "After:" paragraph, then a short "How". CI adds the Screenshots section, see TESTING.md.
- Name the Issue Board task the PR belongs to.
- Add a `Tests: name, name` line to force specific tests in CI.

## Writing

These rules apply to documentation, README, PR text and messages.

- Say what a mechanism is and what it does. Do not name or explain it with metaphors or personification.
- Write the action itself in plain words. No filler, slang or playful tone.
- Do not abbreviate heavily, invent abbreviations, drop subjects or compress sentences. Write the full sentence.
- No "not X but Y" contrasts, dashes used as punctuation, parallel lists for rhythm, or slogans.
- Describe the current state in full. When something changes, rewrite the affected text; do not mix old and new wording, and do not mention removed names.
- Do not use bare labels such as R5 or S1. When a number is unavoidable, say what it refers to.
- Use established terms. Check the usual name of a concept instead of coining one.
