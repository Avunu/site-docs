---
title: Operations
description: The secrets and settings a maintainer creates once, how a project is bumped into the site and how to force one, what to do when a bump fails, and the 60-day scheduler caveat.
order: 2
updated: 2026-10-15
tags: [maintainers, operations, github-actions]
---

This repository publishes one site, `docs.avunu.net`, built from every project's `docs/` folder. Each project is a git submodule at `projects/<path>`, listed in `projects.json`. This page is what the maintainer sets up once and what to do when something goes wrong. No secret lives in the project repositories: this repository pulls, the projects never push.

## The workflows

| Workflow                        | Runs                                             | Does                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bump.yml` (Bump projects)      | Every 30 minutes, by hand                        | Moves each submodule to its project's latest release, opens or updates the one pull request `chore(docs): bump N project(s)`, makes sure CI runs on it and turns on auto-merge |
| `ci.yml`, job `Workspace build` | Pull requests, pushes to `main`, by hand         | Builds and checks the whole site when the change can reach it (the submodules, the registry, `docs/`, the shell, the tool, the package files); skipped otherwise               |
| `deploy.yml` (Docs site)        | Pushes to `main` that touch those paths, by hand | Builds and checks the site; when `DOCS_SITE_ENABLED` is `true`, publishes it to GitHub Pages from the same job's artifact                                                      |
| `check-docs.yml` (Check docs)   | Called by each project's `docs.yml`              | Checks one project's pull request exactly as the site would build it, with its checkout in place of its submodule; read-only, no secret, no deploy                             |

Their triggers, permissions and steps are in [workflows](../reference/workflows.md).

## What the maintainer sets once

1. **`BUMP_TOKEN`** (repository secret: Settings, Secrets and variables, Actions). A fine-grained personal access token, or a GitHub App installation token, limited to **this repository only** with Contents: read and write, Pull requests: read and write, and Actions: read and write. It is used to push `bump/projects`, open the pull request and turn on auto-merge.

   Without it the workflow falls back to `GITHUB_TOKEN`, which works only in part, and says so in a notice. A pull request opened with `GITHUB_TOKEN` starts no `pull_request` workflows, so `bump.yml` dispatches `ci.yml` on the branch instead. The merge GitHub makes for auto-merge counts as made with that token and starts no `push` workflow, so `deploy.yml` does not run after a bump: run it by hand. And the repository setting "Allow GitHub Actions to create and approve pull requests" must be on. With `BUMP_TOKEN` none of that applies. Rotate the token before it expires; an expired one fails the workflow loudly.

2. **GitHub Pages.** Settings, Pages, Source: **GitHub Actions**. Custom domain: `docs.avunu.net`; turn on Enforce HTTPS once the certificate is issued. The `CNAME` file in the build is not what sets the domain for an Actions deployment: the setting is.

3. **DNS.** One record at the DNS host of `avunu.net`: `docs.avunu.net. CNAME avunu.github.io.` Nothing else (no A or AAAA records for that name).

4. **`DOCS_SITE_ENABLED`** (repository variable, same page as the secret) set to `true`, after steps 2 and 3. Until it is `true`, `deploy.yml` builds and checks but publishes nothing.

5. **The `github-pages` environment** (created by step 2): deployment branches limited to the default branch.

6. **Branch protection** (a ruleset on the default branch): require a pull request, require the status check **`ci`** and nothing else (it gathers every job and tolerates skipped ones), block force pushes and deletion, allow squash merging only. Turn on **Allow auto-merge** in Settings, General. Without that setting `bump.yml` warns and the pull request waits for a person.

7. **Reusable workflow access.** A repository can use another's reusable workflows only when the other is public, or when its Settings, Actions, General, Access allows the organization to. If the organization restricts Actions to a list, it must include `Avunu/site-docs/*`, or `check-docs.yml` cannot be called.

8. **Organization domain verification**, once. Verify `avunu.net` for the organization (organization Settings, Pages, Add a domain; create the TXT record `_github-pages-challenge-Avunu.avunu.net` GitHub shows). A `CNAME` to `avunu.github.io` says nothing about who may serve the name: if a Pages site is unpublished or deleted while its record remains, another GitHub account could claim the name. Verification lets only the organization's repositories use `avunu.net` and its immediate subdomains. It is a security control, and it is done.

9. **Security settings**, once: Dependabot alerts and security updates, secret scanning with push protection, and private vulnerability reporting ([SECURITY.md](../../SECURITY.md) points at it); Actions pinned to a full commit SHA; default workflow permission `read`.

## How a bump happens

Every 30 minutes `bump.yml` runs `scripts/bump-submodules.mjs` in a checkout without submodules. For each project in `projects.json` the target is the commit of the tag of its latest non-prerelease GitHub Release; a project with no release yet is pinned to the head of its `branch` until it has one. A project whose lookup fails is reported and skipped, and the others still bump.

When any pointer moved, the workflow rebuilds `bump/projects` from the default branch (one commit, force-pushed with a lease, only that branch), opens or updates the single pull request, and turns on auto-merge. The pull request body lists each project with old and new tag or commit and a compare link. CI (`ci`, including `Workspace build`) must be green; auto-merge then merges it, and the push to `main` runs `deploy.yml`. When a run finds nothing left to bump and no lookup failed, the open bump pull request is closed.

To force a bump now: Actions, Bump projects, Run workflow (or `gh workflow run bump.yml`). Fill `project` with a registry path such as `frappe-nix` to bump only that project; the branch then holds only it until the next scheduled run adds the others again. To see what a run would do without changing anything, run `node scripts/bump-submodules.mjs --dry-run` in a clone (it needs `git` and an authenticated `gh`).

Because the target is the latest release, a documentation fix in a project that has releases reaches the site with the project's next release. A project without a release follows its branch head, so a merge is enough.

## Add or remove a project

Both are one pull request to this repository, described in [adding a project](../guide/adding-a-project.md): the entry in `projects.json`, the submodule, and the project's own `docs.yml` caller. The registry was seeded once from the earlier per-project sites; from then on it is edited by hand.

## When a bump pull request fails

`Workspace build` names the project and the problem (a broken link, an unreadable page). The fix belongs in the project repository: correct the docs there, merge, and, because the target is the latest release, cut a new release (a project with no release is bumped from its branch head, so the merge is enough). Then re-run `Bump projects`; the branch is rebuilt and the pull request updates. Do not edit `bump/projects` by hand: the next run replaces it. All pending bumps share the one pull request, so one broken project holds the others until it is fixed.

If a project's own `docs.yml` was green but the workspace build is not, the cause is usually a link between projects or a change to the tool; the failing step in the run log says which.

## The 60-day caveat

GitHub disables scheduled workflows in a repository with no commit for 60 days. A merged bump is a commit, so an active workspace never goes quiet. After a long quiet spell, open the Actions tab and re-enable `Bump projects` (a manual run does not re-enable the schedule). The same applies to every other scheduled workflow of the repository.

## The avunu.net relaunch

The project menu of every page links to avunu.net: the "Back to avunu.net" link, and, for a catalog entry with no documentation here, its page at `https://avunu.net/open-source/<slug>/`. Until avunu.net has relaunched those pages answer 404. The site works regardless, and nothing needs rebuilding when avunu.net relaunches: the links are the final addresses. When the relaunch is done, point each project's catalog entry on avunu.net at its page here (`https://docs.avunu.net/<path>/`).
