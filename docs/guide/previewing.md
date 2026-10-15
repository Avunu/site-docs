---
title: Previewing
description: How to build the site, or one project of it, from a local checkout and look at the result before anything is merged.
order: 4
updated: 2026-10-15
tags: [guide, preview, cli]
---

There is no development server. A build takes a few seconds for one project, so the loop is: change the Markdown, build, reload the folder in a browser.

## Build the tool once

From a clone of this repository, with Node 22.19.0 or newer:

```bash
npm ci --ignore-scripts
npm run build
```

`npm run build` compiles the command line to `build/`, and the commands below run it as `node build/cli.js`. The site is written to `./dist`, a different folder, so the two never replace each other. `npm run docs:build` and `npm run docs:check` are the same two commands with no options.

## Preview one project from its own checkout

You do not need the other projects to preview one. Clone this repository beside your project and point the build at your checkout:

```bash
node build/cli.js build --lenient --only frappe-nix --source frappe-nix=../frappe-nix
```

- `--only frappe-nix` builds that project, and the site's home page, and nothing else, so the build is fast and the site is partial: the other projects' pages are not in it.
- `--source frappe-nix=../frappe-nix` reads the project's Markdown from your working copy instead of the submodule, so your uncommitted changes show.
- `--lenient` prints document problems as warnings and still builds, so you can look at pages while you fix them. Without it a document problem fails the build and nothing is published, as it does in CI.

The result is in `./dist`. Serve it with any static file server and open the project's address:

```bash
python3 -m http.server --directory dist 8000
# then open http://localhost:8000/frappe-nix/docs/
```

Open the pages by their trailing-slash addresses, as GitHub Pages serves them.

## Check as CI does

`check` is the build CI runs, and it is always strict:

```bash
node build/cli.js check --only frappe-nix --source frappe-nix=../frappe-nix
```

It builds, then checks the colour contrast of the design tokens, then crawls every link, anchor, image, search result and sidebar entry of what it built. Exit code 0 means the project's own pull request check would pass. See [the command line](../reference/command-line.md).

## Preview the whole site

Clone with the projects, or fetch them afterwards, and build without `--only`:

```bash
git clone --recurse-submodules https://github.com/Avunu/site-docs
cd site-docs
npm ci --ignore-scripts && npm run build
node build/cli.js build
```

Add `--source <path>=<dir>` once for each project whose working copy you want to use instead of its pinned commit.

## Where the build leaves things

- `./dist` is the finished site. A failed build leaves the previous one exactly as it was.
- `./.site-docs/` is the build's own work folder, ignored by git: `jx.log` holds everything Jx printed, and `site/` is the assembled Jx project with each project's staged Markdown in `.generated/docs/<path>/docs/` and its sidebar in `.generated/nav/<path>.json`. When a build fails and the message is not enough, read those. See [troubleshooting](troubleshooting.md#looking-inside-a-build).
