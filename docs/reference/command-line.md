---
title: Command line
description: The build and check commands, their options, exit codes, environment variables, strictness and the output a CI run produces.
order: 1
updated: 2026-10-15
tags: [reference, cli, ci]
---

The command line is `node build/cli.js`, run from the folder that holds `projects.json` (or with `--root`) after `npm run build`, which compiles it to `build/`. `npm run docs:build` and `npm run docs:check` run the two commands below without options. The site is written to `./dist`, never to `build/`.

```text
usage: docs <command> [options]

commands:
  build   Build every project's documentation into ./dist
  check   What CI runs: a strict build, the contrast gate and a link crawl
```

## Options

| Option                  | Applies to       | Meaning                                                                                                                         |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--root <dir>`          | both             | The workspace: the folder with `projects.json`. Default: the current folder.                                                    |
| `--only <path>`         | both, repeatable | Build only this project (its `path` in the registry). The site is then partial and is for a quick look, not for publishing.     |
| `--source <path>=<dir>` | both, repeatable | Read that project's repository from `<dir>` instead of `projects/<path>`. A project's own pull request is checked this way.     |
| `--strict`              | both             | Fail on any document problem. Implied by `CI=true`, and always on for `check`.                                                  |
| `--lenient`             | both             | Report document problems as warnings. Never applies to `check`.                                                                 |
| `--ci`                  | both             | Print GitHub Actions annotations, and for `check` write the job summary and the step outputs. Implied by `GITHUB_ACTIONS=true`. |
| `-h`, `--help`          |                  | Print the usage and exit 0.                                                                                                     |

`--strict` and `--lenient` cannot be given together. `--source` takes `<path>=<dir>` with a non-empty path and folder; a malformed pair is a usage error. An unknown `--only` path is refused with `no such project: <path>`.

## build

`build` runs the [pipeline](build-pipeline.md) up to publishing and writes the site to `./dist` below the root, replacing it only when every step passed. A failed build leaves the previous `./dist` exactly as it was. It prints one line per step, each starting with its stage, and ends with `build: N page(s) of M project(s) written to <dist>`.

## check

`check` is what CI runs. It is `build` with strictness forced on, followed by two more checks:

1. **Contrast.** The design tokens the site resolved to, and the search highlight, are checked against the WCAG pairs; any pair below its minimum fails. It runs even when the build failed, so a red run can show both problems.
2. **Links.** Every link, anchor, image, asset, search result and sidebar entry of the published site is crawled; each must resolve. It runs only after a passing build.

With `--ci` it also writes the job summary to the file `GITHUB_STEP_SUMMARY` names and, after a pass, the step outputs `dist` (the absolute path of the published site) and `pages` (the page count) to `GITHUB_OUTPUT`. It ends with `check: all steps passed` or `check: FAILED`.

## Exit codes

| Code | Meaning                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done: the build or the check passed.                                                                                                                                      |
| 1    | A problem was found: a registry error, a document problem in a strict build, a failed Jx run or output assertion, a failed contrast or link check. Nothing was published. |
| 2    | A usage error: an unknown command or option, a malformed `--source`, or `--strict` with `--lenient`.                                                                      |
| 70   | An unexpected error: the stack trace is printed.                                                                                                                          |

## Strictness

A build is strict when it is not lenient and either `--strict` is given or the environment variable `CI` is `true`. It is lenient when `--lenient` is given or `DOCS_LENIENT` is `1`. Lenient wins.

- **Strict**: every document problem (a lint error, a Jx line that starts with `Content`, `Warning:` or `Error`, a skipped symbolic link, a route count lower than the pages promise) is collected, printed once with its file and line, and the build stops with `docs: N document problem(s) above fail the build` and nothing published. Jx's own link check is set to `error` too.
- **Lenient**: the same problems are warnings, the build goes on and publishes, and Jx's link check is set to `warn`.
- **Never downgraded**, whatever the strictness: a registry error, a failing Jx run, a failed output assertion and, in `check`, the contrast and link checks.

`check` removes `DOCS_LENIENT` from the environment it uses: leniency is never a file setting and never reaches a check.

## Environment

| Variable              | Effect                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| `CI`                  | `true` makes a build strict.                                              |
| `GITHUB_ACTIONS`      | `true` implies `--ci`.                                                    |
| `DOCS_LENIENT`        | `1` makes a build lenient (not a `check`).                                |
| `GITHUB_STEP_SUMMARY` | With `--ci`, `check` appends the job summary to this file.                |
| `GITHUB_OUTPUT`       | With `--ci`, a passing `check` appends `dist=` and `pages=` to this file. |

The build reads no other variable of its own. It uses no network.

## Output conventions

Every line the build prints starts with its stage, `stage: message`: `registry`, `assemble`, `stage`, `lint`, `nav`, `jx`, `postbuild`, `assert`, `contrast`, `links`, `check`. A problem reads `stage: error: message` or `stage: warning: message`, and a document problem names the project and file: `lint: error: frappe-nix/docs/guide/x.md:12  message`. With `--ci`, every error and every warning that has a file is also printed as a GitHub Actions annotation, `::error file=frappe-nix/docs/guide/x.md,line=12,title=lint::message`, which GitHub shows on the pull request. The file in an annotation is the project's path, then its Markdown folder, then the file, so it is not a path in the pull request of the project's own repository.
