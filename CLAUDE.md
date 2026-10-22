# Bake

Bake is a static site generator for a technical blog with interactive components. This repository holds the tool; each blog lives in its own repository, and `examples/blog/` is the one blog kept here as example and test fixture.

@TESTING.md

## Code

- Match the style of the surrounding code.
- Names and structure carry the meaning. Write a comment only for knowledge the code cannot express, such as why code that looks removable must stay.
- Write no abstraction for a need that does not exist yet. Prefer deleting code to adding it.
- No shims, fallbacks, legacy aliases or dual code paths. Replace old behavior outright and delete code that is no longer used.
- Fix the root cause, in the shared code that every caller goes through.
- Every problem Bake finds in a blog is reported as `file:line:col message`, with the path relative to the blog root, and one run reports all problems (`src/shared/report.js`).
- Layers, enforced by `test/layers.test.js`: the directories of `src/` import each other without a cycle, only `src/cli.js` and `src/dev/` import `src/build/`, and modules that run in the browser import no Node built-in module.
- Dependencies: use a mature library for a general problem (parsing, typesetting, highlighting, diffing, sanitizing), and write Bake's own core by hand (the article structure, the theme interface, the component interface, copying as Markdown). Accept a library's native behavior instead of wrapping it. Add a dependency in the change that uses it.

## Language

Code, identifiers, test names, CLI output, error messages, commits and documentation are in English. The content of the example blog and the localized labels of the interface may be in other languages.

## Documentation

- There is no developer documentation. Knowledge the code cannot express goes into a comment next to the code.
- README.md is for people who write a blog with Bake. A change to the public interface (commands, configuration, Markdown syntax, components, themes) updates README.md in the same change.

## Tests

- Test behavior that a user of Bake or a reader of a blog can observe, not the implementation.
- A test checks a promise of README.md, an invariant of every page of the example blog or a performance budget (`TESTING.md`). Write no other test, and extend the test of a promise, or a row of a table, before adding a test.
- Size the local verification to the change: a change to documentation only runs no tests, and a change to code runs the unit and browser tests of the features it changes. The full suites run in CI on every pull request.

## Commits and pull requests

- Commit messages: `<type>(<scope>): <summary>`, such as `feat(cli): list commands in --help`. Types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`.
- A pull request title says in one sentence what changed. The body has a "Before:" paragraph, an "After:" paragraph and a short "How".

## Writing

These rules apply to documentation, messages, commits and pull requests.

- Write plain words and full sentences. No metaphors, personification, slang, filler or playful tone.
- Use the established term for a concept instead of coining one, and do not invent abbreviations.
- Do not use bare labels such as R5 or S1; say what a number refers to.
- Describe the current state. When something changes, rewrite the affected text instead of adding to it.
