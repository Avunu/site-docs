---
title: Adding a project
description: How a repository gets onto the site, what it keeps, how its documentation reaches the site after a release, and how a project is renamed or removed.
nav_title: Adding a project
order: 3
updated: 2026-10-31
tags: [guide, registry, submodules]
---

A project is on the site when two things are true in this repository: it has an entry in `projects.json`, and its repository is a git submodule at `projects/<path>`. Both are added in one pull request.

## What the project needs

- A public repository on GitHub with a `docs/` folder and a `docs/README.md` in it. The README is the project's documentation home. See [writing documentation](writing-docs.md).
- Documentation that builds clean. Preview it first, as [previewing](previewing.md) describes: the site fails the whole build on a document problem, so a problem in one project holds up the bump of every other.
- Nothing else. A project keeps no configuration file, no package and no site folder for this system.

## Choose the path

The `path` is the project's URL segment and its folder name under `projects/`: `https://docs.avunu.net/<path>/`. It is a setting, never worked out from the repository's name, so a repository can be renamed without its address changing. Pick the name the project will keep:

- lowercase letters, digits and hyphens, starting with a letter or a digit, and one segment (no slash, no underscore);
- not one of the names the site publishes at its root: `assets`, `brand`, `components`, `data`, `fonts`, `images`, `public`, `404`;
- unique among the projects.

The `slug` is a different name: the key of the project in the avunu.net catalog, which may hold underscores (`erpnext_taskview`). The project menu uses it to find the project's summary and its page on avunu.net. A project that is not in the catalog yet still works: it is listed from the registry entry.

## Add the entry and the submodule

In one pull request against this repository:

1. Add the project to `projects.json`, in `path` order, with every key [the registry](../reference/registry.md) requires:

   ```json
   {
     "path": "frappe-nix",
     "slug": "frappe-nix",
     "name": "frappe-nix",
     "tagline": "Reproducible Nix infrastructure for Frappe and ERPNext.",
     "platform": "nixos",
     "repo": "https://github.com/Avunu/frappe-nix",
     "license": "MIT",
     "branch": "main"
   }
   ```

   Add `"docs": "documentation/user"` when the Markdown is not in `docs/`.

2. Add the submodule at the same path:

   ```bash
   git submodule add --depth 1 -b main https://github.com/Avunu/frappe-nix projects/frappe-nix
   ```

   Commit `projects.json`, `.gitmodules` and the new pointer together. The first scheduled bump moves the pointer to the project's latest release, if it has one.

3. Check it as the site will: `npm run build && node build/cli.js check`. A problem in the new project is a problem of the whole build, so fix it in the project's repository first and bump the pointer, or leave the project out until it is clean.

## Check a project's own pull requests

The submodule is bumped only after a release, so catch problems before the project merges them. A project adds `.github/workflows/docs.yml`:

```yaml
name: Docs
on:
  pull_request:
    paths:
      - docs/**
      - .github/workflows/docs.yml
permissions: {}
jobs:
  docs:
    permissions:
      contents: read
    uses: Avunu/site-docs/.github/workflows/check-docs.yml@<commit of a release tag> # vX.Y.Z
    with:
      path: frappe-nix
```

`path` is the project's path in `projects.json`, and the project must already be in the registry. The workflow builds this repository at the commit pinned in `uses` (it reads its own commit, so the pin is the only place that names it) and checks the project's pull request in place of its submodule, so links to other projects are checked too. It has a read-only token and no secret, publishes nothing and never runs the project's code. Pin `uses` to the full commit that a [release](https://github.com/Avunu/site-docs/releases) tag points at, with the tag in the comment (`# v0.2.0`); the tool moves with the pin, so moving a project to a newer check is one line. Dependabot reads the comment and proposes a new pin only when this repository cuts a release, not on every commit to its default branch. A project registered after the latest release fails the check with "not in projects.json" until the next release, so registering a project is a `feat` commit, which makes one. The optional input `ref` builds with another commit or branch instead, to try a change of this repository before it is pinned. See [workflows](../reference/workflows.md#check-docsyml).

## How documentation reaches the site

1. A change to `docs/` merges in the project's repository.
2. The project cuts a release, or does not. The target of a bump is the commit of the tag of the latest non-prerelease GitHub Release; a project with no release is pinned to the head of the branch named in the registry until it has one.
3. Every 30 minutes the Bump projects workflow moves each pointer that is behind and opens, or updates, the one pull request `chore(docs): bump N project(s)`.
4. When its checks pass, the pull request merges, and the push to the default branch builds and publishes the site.

A documentation fix in a project that has releases therefore goes live with its next release. To publish a fix sooner, cut a release, or ask a maintainer to run the Bump projects workflow by hand: it only moves a pointer to a release, so it changes nothing until the release exists.

## Rename a repository

The `repo` setting changes; the `path` does not, so every address and every link keeps working. In one pull request: change `repo` in `projects.json` and the `url` of the submodule in `.gitmodules`, then run `git submodule sync`. GitHub redirects the old repository address meanwhile, so nothing breaks in between. Update the workflow's `uses:` line only if the renamed repository is this one: GitHub does not redirect `uses:` references to reusable workflows. See [migration](../maintainers/migration.md).

## Remove a project

In one pull request: delete the entry from `projects.json`, then `git submodule deinit -f projects/<path>` and `git rm -f projects/<path>`, which also removes the submodule's section from `.gitmodules` (check that it did). The project's pages leave the site. Remove its `docs.yml` caller in its own repository, and the avunu.net catalog's `docs` address for it.
