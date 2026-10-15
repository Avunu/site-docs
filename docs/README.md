---
title: Documentation workspace
description: What this repository is, how the one docs site is made from every project's docs folder, and where to read more.
order: 1
updated: 2026-10-15
tags: [overview, docs]
---

This repository builds `docs.avunu.net`: the documentation of every Avunu open-source project, in one site. A project keeps its Markdown in its own `docs/` folder, next to its code. This repository holds each project as a git submodule, reads those folders, and publishes them together with one look, one search and one project menu.

A project's documentation is at `https://docs.avunu.net/<path>/`, where `<path>` is a short name chosen in the registry: `https://docs.avunu.net/frappe-nix/` is the landing page of frappe-nix and `https://docs.avunu.net/frappe-nix/docs/` is its documentation. The home page, `https://docs.avunu.net/`, lists every project by platform.

## How the pieces fit

```text
projects.json            the registry: which projects, and under which path
.gitmodules              where each project's repository is
projects/<path>/         one git submodule per project, pinned to a commit
  docs/                  the project's Markdown (README.md is its home page)
site/                    the Jx project that gives every page its look
src/                     the build: reads the registry, builds one site, checks it
docs/                    this documentation (the project `site-docs`)
.github/workflows/       bump, check a project, build and deploy
```

- **The registry** is `projects.json`. It names each project, its repository, its platform and the URL path it gets. See [the registry](reference/registry.md).
- **The submodules** pin each project at a commit. A scheduled workflow moves each pin to the project's latest release, or to the head of its default branch while it has none, and opens one pull request for all of them. No secret is stored in the project repositories. See [workflows](reference/workflows.md).
- **The build** reads every project's `docs/` folder, checks the Markdown, and builds one [Jx](https://jxsuite.com) site from the shell in `site/`. It fails on anything it cannot render faithfully. See [the build pipeline](reference/build-pipeline.md).
- **The deployment** publishes the finished folder to GitHub Pages when the build of the default branch passes.

## What a project keeps

A project keeps a `docs/` folder with a `README.md` in it, and nothing else of this system: no configuration file, no package, no site folder. Optionally it adds one small workflow that checks its documentation on its own pull requests, the same way the site would build it. See [adding a project](guide/adding-a-project.md).

## What the site gives every page

- **The same look as avunu.net**: light and dark themes, a sidebar per project, an "On this page" list, previous and next links and an "Edit this page on GitHub" link that points into the project's own repository, branch and docs folder.
- **Search** across every project, built at build time and run in the browser.
- **A project menu** that lists every Avunu project by platform and marks the one you are in.
- **Checks that fail the build.** In CI a broken link, a missing image, Markdown the site cannot show, an empty link, or a script, event handler or `javascript:` address in the Markdown stops the build, and every page carries a Content-Security-Policy. See [writing documentation](guide/writing-docs.md).

## Requirements

| What                                 | Needs                                         |
| ------------------------------------ | --------------------------------------------- |
| Building the site                    | Node 22.19.0 or newer; CI always uses Node 24 |
| Cloning with the projects            | `git` with submodule support                  |
| The script that bumps the submodules | `git`, and `gh` logged in                     |
| Operating system                     | Linux or macOS; Windows is not supported      |

## Where to go next

- [Guide](guide/README.md): write documentation, add a project, preview a build, fix a failure.
- [Reference](reference/README.md): the command line, the registry, the build pipeline and the workflows.
- [Maintainers](maintainers/README.md): the settings and secrets to create once, how a bump happens, the one-time migration from the per-project sites, and the changes asked of Jx.
