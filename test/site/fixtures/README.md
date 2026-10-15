---
title: Fixtures of the site tests
description: What the files in test/site/fixtures are, where they came from and how to change them.
---

These are input files of `test/site/**`. They are files, not tests, and the formatter and the linter
leave them alone.

| File      | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                      | Used by                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `docs/**` | A small documentation tree that stands in for a project's `docs/` folder: a home page, a loose page, folders with a `README.md`, `readme.md` and `index.md`, a file name with capitals and a space, all five alert kinds, a table, a code fence, a page with two level-one headings, and the files that must NOT be published (`_private.md`, `_partials/`, `.hidden/`, `draft.md` with `draft: true`, `unpublished.md` with `publish: false`). | `build.test.ts` (copied into both projects of the test workspace), `rules.test.ts` |

There is no recorded navigation: the sidebar of each project is built by the real workspace build from
`docs/**`, and `rules.test.ts` holds `buildNav` to the table in `support/fixtures.ts`.

## The workspace the build test builds

`support/workspace.ts` writes a `projects.json` and puts `docs/**` into two projects, `example` (Markdown
in `docs/`, branch `main`, MIT, general) and `other` (Markdown in `documentation/user/`, branch `trunk`,
Apache-2.0, Odoo), then runs the real workspace build up to the sidebar data and hands the assembled Jx
root to the pinned Jx. The two projects differ in everything a page can show, so a page that reads the
other project's entry fails a test.

## Changing them

- **`docs/**`**: if you add, remove or rename a file, update `DOC_FIXTURES` in `support/fixtures.ts` (the
  route of each file, below the project's prefix, or why it is left out), otherwise `rules.test.ts` and
  `build.test.ts` fail.
- **The projects**: edit `WORKSPACE` in `support/workspace.ts`; the tests read the names, repositories,
  branches and licenses from it.
