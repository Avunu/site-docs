# Contributing

Thank you for helping. This repository builds the one documentation site of every Avunu open-source project, so changes are small, reviewed and tested against a real build.

## Set up

You need Node 22.19.0 or newer (24 is what CI builds with) and npm. Bun 1.4 or newer is optional and only used by the browser suites in `verify/`.

```bash
git clone --recurse-submodules https://github.com/Avunu/site-docs
cd site-docs
npm ci --ignore-scripts
npm run check
```

`npm run check` is the local gate: formatting, lint, types and the unit and integration tests. The `ci` workflow runs the same and then builds and checks the whole site. Use `--ignore-scripts`: nothing here needs an install script.

| Command                | What it does                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run format`       | Format everything with `oxfmt` (it also formats Markdown, including table alignment)                                    |
| `npm run format:check` | The check CI runs                                                                                                       |
| `npm run lint`         | `oxlint`                                                                                                                |
| `npm run typecheck`    | `tsc --noEmit`                                                                                                          |
| `npm test`             | `vitest run`: the `unit` project, and the `integration` project that builds with the real pinned Jx (60 second timeout) |
| `npm run build`        | Compile `src/` to `build/`                                                                                              |
| `npm run docs:build`   | Build the whole site into `dist/` (needs the submodules)                                                                |
| `npm run docs:check`   | The strict build, contrast gate and link crawl that CI runs                                                             |

The browser suites need Chrome and Bun; see `verify/README.md`.

### Tests on Windows

Windows is not a supported platform, but the unit tests run on `windows-latest` in CI (the informational job) and are expected to pass: a failure there is a path-separator or line-ending bug, or a test that assumed POSIX. To run them yourself, use `npm test -- --project unit`.

- **Line endings.** `.gitattributes` (`* text=auto eol=lf`) checks every text file out as LF, whatever `core.autocrlf` says. Images, fonts and archives are `binary`.
- **Symbolic links.** The tests create them, and Windows lets only an administrator, or an account with Developer Mode on, do that. Without the privilege the tests that create a link fail with `EPERM`.
- **Writing a test that runs everywhere.** Do not write a native path as a `/` literal or build a regular expression from one: use `slash`, `native` and `escapeRegExp` from `test/support`. A temporary folder may be on another drive than the checkout. Use `test.skipIf(isWindows)` only for what cannot exist there, and say why in a comment.

## Rules every change keeps

These hold for the whole repository. A change that needs to break one is a design discussion first.

1. **Black box.** Jx is touched only through documented surfaces: a plain project root, `jx build <root>` spawned with `process.execPath`, `extensions`, `$src: "npm:..."` sidecars and `content.<type>.links`. No Jx extension, no hooks, no mutation of Jx internals.
2. **One source per fact.** Everything about a project is written once, in `projects.json`. Everything else is derived.
3. **Strict in CI, never configured.** `CI=true` fails on any document problem. Leniency is a per-run flag, never a file setting.
4. **Everything is recorded.** Each build writes `.site-docs/jx.log` and prints the command to run Jx by hand.
5. **Real bytes only.** Published files are copies, never symbolic links.
6. **No scripts, no surprises at install or build.** No install script runs; the build uses no network; the Jx packages are pinned exactly; no new runtime dependency beyond `@jxsuite/compiler`, `@jxsuite/parser`, `@jxsuite/runtime`, `@jxsuite/search` and `yaml`.
7. **Least privilege.** The build job has `contents: read` and no secrets, the deploy job runs no project code, and no workflow that a pull request can trigger asks for `pages: write` or `id-token: write`.
8. **Trust assertions, not Jx.** Jx ignores what it does not understand and still exits 0, so the output is asserted positively.
9. **A page is data.** Nothing a page of Markdown says reaches Jx as a template (staging writes every `${` inert), and no published page carries a script: the lint and the output assertions refuse code, and every page carries a Content-Security-Policy.

Source conventions: TypeScript with ES modules, `.js` specifiers for relative imports, module `nodenext`, declarations on and no source maps. `src/` uses Node APIs only, never Bun APIs.

## Commits and pull requests

Pull requests are squash-merged, so **the pull request title becomes the commit message**. Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `perf:`, `style:`, `build:` and `revert:`, with an optional scope (`chore(docs): bump 3 project(s)`). Mark a breaking change with `!` and explain it in a `BREAKING CHANGE:` footer. The title is checked by `scripts/check-pr-title.mjs`; lines of a commit body are at most 100 characters. The type also decides the next release of the shared check, which projects pin (`release.yml`): `feat`, `fix`, `perf` and `revert` make one, the other types do not.

A good pull request says what changed and why, how it was verified, and any decision a maintainer should confirm.

### What needs a note in the pull request

- Anything that changes a published address, a key of `projects.json`, a command or option, an exit code, a design-token name, a file or tag name under `site/`, or the inputs, permissions or job names of a workflow that projects call (`check-docs.yml`).
- A new dependency, with the reason. Dependencies are exact-pinned. A new runtime dependency is a design change.
- A renamed or removed file under `site/`.

## How the repository is organized

| Area                  | Paths                                                                                          | Holds                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| The build             | `src/workspace/`                                                                               | The registry, the per-project pages, the catalog, `build` and `check`                                   |
| Command line          | `src/cli.ts`                                                                                   | Option parsing, exit codes                                                                              |
| Content               | `src/lib/{stage,repo-links,markdown,frontmatter,lint,docs,nav,slug}.ts`                        | Staging the Markdown, link rewriting, the lint rules, the sidebar                                       |
| Output                | `src/lib/{postbuild,tidy,assert,links,contrast,csp,html-policy,safety,unsafe-markup,inert}.ts` | Post-build fixes, the output assertions, the link crawl, the contrast gate, the Content-Security-Policy |
| Shared                | `src/lib/{strict,ci,jx,project,fsutil,spawn,types,platforms,package-info}.ts`                  | Strictness, GitHub Actions output, the Jx packages, the generated `project.json`, file-system rules     |
| The shell             | `site/`                                                                                        | The Jx project every page is made from: components, layouts, pages, templates, tokens, fonts, marks     |
| Tests                 | `test/`, `verify/`                                                                             | Unit and integration tests; the browser suites                                                          |
| Workflows and scripts | `.github/`, `scripts/`                                                                         | The workflows and the scripts they run                                                                  |
| Documentation         | `README.md`, `CONTRIBUTING.md`, `MAINTAINING.md`, `SECURITY.md`, `docs/`                       | These files and the documentation tree                                                                  |

Rules that came with that structure:

- **Test next to the area.** Behavior that needs a neighbouring area is tested with fixtures, and the integration tests run the real pinned Jx on a fixture workspace.
- **No new dependencies** without a reason in the pull request (see rule 6 above).
- **Documentation follows the code.** A change to a command, option, key, file name or exit code changes the README and `docs/` in the same pull request. Every command, option, key and file the documentation names must exist.

## The documentation tree

`docs/` is the documentation of the project `site-docs`, written to the same conventions it asks of every project: front matter with `title` and `description`, no `# Heading` in the body, GitHub alerts for callouts, relative links with `%20` for spaces, language-tagged code blocks and `[PLACEHOLDER]` for anything unknown. It must build in strict mode: `CI=true node build/cli.js check`.

The repository is public. Do not commit client names, client domains, customer data, secrets or prices. Describe clients by industry only. Examples use the public names of Avunu's own repositories.
