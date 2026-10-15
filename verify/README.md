# Browser suites

Maintainer tooling of the docs workspace. The suites build a fixture workspace with the repository's own command line (`node build/cli.js check`, the checks CI runs) and check the site it makes in a real Chrome. They run on [Bun](https://bun.sh) with `playwright-core` and `@axe-core/playwright`; the site under test is built by Node, as the deployed one is.

```sh
npm run build                # in the folder above: the build needs build/cli.js
npm ci                       # in this folder: installs the two dependencies from package-lock.json
bun run.ts --out /tmp/verify
```

`run.ts` builds a copy of `fixtures/workspace/` and runs everything; `--root <workspace>` checks another workspace in place (a real one with its submodules checked out, for example), and `--only axe,csp` runs some of the suites. Each suite also runs alone on the Jx output of a built workspace, `<root>/.site-docs/site/dist` (its parent is the assembled Jx root, which holds the `data/projects.snapshot.json` the suites read); `DOCS_HOME=/example/docs/` tells the suites that open one page which project's documentation to open.

## The fixture workspace

`fixtures/workspace/` is a plain folder, not a set of submodules: a `projects.json` and two projects.

- `example`: a small adopting repository (`docs/`, a `LICENSE`, a stand-in source file and a logo). Its catalog slug is a real one, so the switcher's "You are here" state exists.
- `edge`: the edge cases a real repository brings: a README that starts with a comment and a badge, links written from the repository root, a page whose title and tags look like template expressions, a second level-one heading, folder pages (`README.md` and `index.md`).

| Suite         | What it proves                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axe.ts`      | WCAG 2.1 A and AA with axe-core on every page at three widths in both colour schemes, and again with the project list, the search palette and the drawer open: zero serious or critical violations. |
| `csp.ts`      | The Content-Security-Policy of the pages from both sides: the site works under it (search, switcher, theme, drawer, copy buttons: no violation, no script error), and markup injected into a built page (event handlers, a javascript: link, inline and foreign scripts, a frame, a form, a new base) does nothing. |
| `drawer.ts`   | The mobile drawer is modal: focus moves in and back, nothing behind it can be reached, Escape and a click outside close it.                                                     |
| `switcher.ts` | The project switcher: its list is in every page at build time, the current project is marked, keyboard disclosure, no layout shift, no request to another site.               |
| `fences.ts`   | Every fenced code block of the Markdown of every project comes out of the build with exactly its text.                                                                          |
| `edge.ts`     | The `edge` project's pages as a reader sees them, and what the workspace keeps apart: one project's sidebar never links to another's pages, the search index holds both, the landing page lists both. |
| `shots.ts`    | Screenshots of every page at 1440, 768 and 390 pixels in both schemes, plus `states.ts` for the interactive states. For a person to look at: nothing is compared.              |

The suites never touch the network: the project catalog is the one the site was built with, and images of other sites are answered by a placeholder. Chrome is found at `$CHROME_BIN` or in the usual places.
