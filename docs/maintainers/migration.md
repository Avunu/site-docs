---
title: Migration from the per-project sites
description: The one-time, ordered runbook from one documentation site per repository to docs.avunu.net, who does each step, and which steps can be undone.
order: 4
updated: 2026-10-15
tags: [maintainers, migration, runbook]
---

Until now every Avunu repository with documentation published its own site at `<repo>.avunu.net`, built by a `docs-site/` folder, two workflows pinned to this repository (then named `Avunu/docusystem`) and a package, `@avunu/docusystem`. This repository now builds all of them as `docs.avunu.net/<path>/`, and the package is gone. This page is the order in which the old arrangement is retired. It is done once.

Additive steps come first and destructive ones last: the old sites keep answering until step 5, and each step says what it breaks and how to undo it. A person does every step marked **maintainer**; the pass over the repositories (step 4) is scripted and opens one pull request per repository, which a person merges.

## Before you start

- The change that introduces the registry, the submodules and the new workflows is merged to the default branch, and the `Workspace build` check passed on it with every submodule fetched.
- `DOCS_SITE_ENABLED` is currently `true` on this repository: it is what publishes the old `docusystem.avunu.net`. Unset it before merging, or the first push to the default branch deploys the new site over that name, with every address and canonical link written for `docs.avunu.net`. Step 3 sets it again.
- The organization has verified `avunu.net` for GitHub Pages (see [operations](operations.md#what-the-maintainer-sets-once), step 8). That is a security control, not an optional one, and it was done before the first per-project site went live.

## The steps

### 1. Merge this change (maintainer)

Merge the pull request that replaces the single-project tool with the workspace. It adds `projects.json`, `.gitmodules` and the submodules, `deploy.yml`, `bump.yml` and `check-docs.yml`, and removes the package, its scaffolds and the old reusable workflows.

_Undo_: revert the merge. Nothing outside this repository has changed yet.

### 2. Rename the repository (maintainer)

Settings, General, Repository name: `Avunu/docusystem` becomes `Avunu/site-docs`. GitHub redirects the web address and git URLs of the old name, so clones, links and `git submodule` URLs keep working.

GitHub does **not** redirect the `uses:` reference of a reusable workflow. From this moment the 22 repositories' `docs.yml` and `docs-publish.yml`, which name `Avunu/docusystem/.github/workflows/...`, can no longer start: their pull-request checks fail with a missing workflow, and their sites stop updating. Sites already published keep serving. Step 4 fixes the repositories; do steps 3 and 4 without delay.

In the same change that follows the rename, set the `WORKSPACE_REPOSITORY` value at the top of `.github/workflows/check-docs.yml` to `Avunu/site-docs`. The old name redirects meanwhile, so nothing breaks in between.

_Undo_: rename it back, as long as no other repository has taken the old name. Never create a repository named `docusystem` afterwards: it would replace the redirect and break every old link.

### 3. Turn on the new site (maintainer)

1. DNS: one record, `docs.avunu.net. CNAME avunu.github.io.`
2. Settings, Pages, Source: **GitHub Actions**. Custom domain `docs.avunu.net`; turn on Enforce HTTPS once the certificate is issued. A repository has one custom domain, so this replaces `docusystem.avunu.net`: delete the DNS record `docusystem` first (step 5 explains why the record goes before the setting), then change the domain.
3. Create the secret `DOCS_BUMP_TOKEN` and set the repository variable `DOCS_SITE_ENABLED` to `true`, as [operations](operations.md#what-the-maintainer-sets-once) describes. Turn on branch protection (require `ci`) and auto-merge.
4. Run **Docs site** by hand. When it passes, open `https://docs.avunu.net/` and a project's documentation, for example `https://docs.avunu.net/frappe-nix/docs/`.

_Undo_: unset `DOCS_SITE_ENABLED`, remove the custom domain and the DNS record. The old sites are untouched.

### 4. Move the repositories to the new check (scripted; a person merges)

One scripted pass over the 22 repositories, **one change per repository**, each its own pull request, none merged by the script:

- delete `docs-site/`;
- delete `.github/workflows/docs-publish.yml`;
- change `.github/workflows/docs.yml` to call `Avunu/site-docs/.github/workflows/check-docs.yml` pinned by a full commit SHA, with `path` set to the project's path in `projects.json` (see [adding a project](../guide/adding-a-project.md#check-a-projects-own-pull-requests));
- remove what only served the deleted folder: the Dependabot entry for the npm ecosystem at `/docs-site`, an ignore or format rule for `docs-site`, and any link in the README to the old address.

A repository that is not in `projects.json` cannot call the workflow, so register it first. The repositories' Pages sites keep serving the last published content until step 5.

_Undo_: close the pull request, or revert it. Reverting `docs.yml` alone does not help after the rename, because the old workflow reference no longer resolves.

### 5. Retire the 21 per-repository subdomains (maintainer)

For each repository, in this order:

1. Delete the record `<label> CNAME avunu.github.io.` at the DNS provider of `avunu.net`.
2. Disable the repository's Pages site (Settings, Pages), or remove its custom domain.
3. Unset its `DOCS_SITE_ENABLED` variable.

The record goes first. A record that still points at `avunu.github.io` while no Pages site claims the name is an opening for another account to claim it; domain verification narrows that, and the order closes it. Do not reverse the order. After the sweep, list the records of the zone that point at `avunu.github.io` and compare them with the repositories that have Pages enabled: a record without a repository is dangling and is deleted.

No redirect is possible from a retired name: GitHub Pages cannot forward a custom domain to another. Visitors with an old link get a name that does not resolve, so remove the old addresses from READMEs and catalogs (steps 4 and 6) before this step.

_Undo_: a deleted record can be added again and Pages enabled again with the same custom domain, but the certificate is issued anew and can take a day.

### 6. Update the catalog (maintainer)

When avunu.net publishes its project catalog, set each project's `docs` address to `https://docs.avunu.net/<path>/`. Nothing in this repository changes for it: the project menu takes its `docs` addresses from `projects.json`.

_Undo_: restore the previous values.

### 7. Retire the package (maintainer)

`@avunu/docusystem` 0.1.0 is on npm and nothing uses it after step 4. Deprecate it, with an npm login, and give the reason:

```bash
npm deprecate @avunu/docusystem "No longer used: Avunu documentation is built from https://github.com/Avunu/site-docs"
```

Remove the trusted-publisher entry for this repository on npmjs.com. Never publish the package again, and never reuse the name `docusystem` for a repository.

_Undo_: `npm deprecate @avunu/docusystem ""` removes the deprecation. The published version stays installable either way: deprecating is a notice, not a removal.

## Which steps can be undone

| Step | Undo                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| 1    | Yes: revert the merge.                                                                       |
| 2    | Yes: rename back, unless the old name was taken. The redirect is lost if the name is reused. |
| 3    | Yes: unset the variable and remove the domain.                                               |
| 4    | Yes before the rename; after it, only by moving forward to the new workflow.                 |
| 5    | In part: the records and Pages settings can be recreated, the certificates are issued anew.  |
| 6    | Yes.                                                                                         |
| 7    | The deprecation can be removed; the published package stays.                                 |
