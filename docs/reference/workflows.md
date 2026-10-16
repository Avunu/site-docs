---
title: Workflows
description: The GitHub Actions workflows of this repository, what triggers each, the permissions it holds, what it does, and the trust model they share.
order: 4
updated: 2026-10-15
tags: [reference, github-actions, security]
---

Four workflows keep the site current and safe. A fifth, `ci.yml`, tests this repository. Every action is pinned to a full commit SHA with its version in a comment, every workflow starts with `permissions: {}`, and each job asks only for what it needs.

| Workflow                           | Triggers                                                  | Holds                                                              |
| ---------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ |
| [`deploy.yml`](#deployyml)         | Push to the default branch that touches the site; by hand | Build: `contents: read`. Deploy: `pages: write`, `id-token: write` |
| [`bump.yml`](#bumpyml)             | Every 30 minutes; by hand                                 | `contents`, `pull-requests`, `actions`: write                      |
| [`check-docs.yml`](#check-docsyml) | Called by a project's own workflow                        | `contents: read`                                                   |
| [`ci.yml`](#ciyml)                 | Pull requests; pushes to the default branch; by hand      | Read-only                                                          |

## `deploy.yml`

Name: **Docs site**. It builds and checks the whole site, and when the repository variable `DOCS_SITE_ENABLED` is `true` and the run is on the default branch, publishes it to GitHub Pages.

Triggers: a push to `main` that touches the submodules (`projects/**`, `.gitmodules`), the registry (`projects.json`), this repository's own pages (`docs/**`), the shell (`site/**`), the tool (`src/**`), the package and TypeScript files or the workflow itself; and `workflow_dispatch`. One run per branch at a time, never cancelled half way.

- **Build job** (`contents: read`, no secret). Checks out the repository with its submodules, shallow and without leaving credentials behind. Sets up Node 24 with no cache. `npm ci --ignore-scripts`, `npm run build`, then `CI=true node build/cli.js check`, which writes the site to `dist` and reports its path as the step output `dist`. Uploads that folder as the Pages artifact, only when publishing is on.
- **Deploy job** (`pages: write`, `id-token: write`, environment `github-pages`). Runs only when `DOCS_SITE_ENABLED` is `true` on the default branch and the build passed. It configures Pages and deploys the artifact the build job made. It runs none of this repository's code and none of any project's.

Until `DOCS_SITE_ENABLED` is `true` the workflow builds and checks and publishes nothing.

## `bump.yml`

Name: **Bump projects**. A pull workflow: this repository reads each project's releases, and no project holds a secret.

Triggers: a schedule at minutes 7 and 37 of every hour, and `workflow_dispatch` with the optional input `project` (a registry path such as `frappe-nix`) to bump only that project.

1. Check out the default branch without submodules, set up Node 24.
2. Run `node scripts/bump-submodules.mjs`. For each non-local project in `projects.json` the target is the commit of the tag of its latest non-prerelease GitHub Release; a project with no release gets the head of its `branch`. The script changes only the index of the checkout (the submodule pointers) and writes a JSON report and the Markdown for the pull request. A project whose lookup fails is reported and skipped; the others still bump. The options are `--project`, `--registry`, `--json`, `--summary` and `--dry-run`, which resolves and reports without changing the index.
3. When anything moved: commit the pointers on a branch `bump/projects` rebuilt from the default branch, push it with a lease (only that branch, never the default branch), open or update the one pull request `chore(docs): bump N project(s)` and turn on auto-merge.
4. When nothing is left to bump and no lookup failed, close the open bump pull request.

The token is the secret `DOCS_BUMP_TOKEN` when it exists and `GITHUB_TOKEN` otherwise. With `GITHUB_TOKEN`, a pull request starts no `pull_request` workflows, so the workflow dispatches `ci.yml` on the branch instead; and the merge that auto-merge makes starts no push workflow, so `deploy.yml` does not run by itself. [Operations](../maintainers/operations.md) has the exact token permissions and the consequences.

## `check-docs.yml`

Name: **Check docs**. A reusable workflow that each project repository calls from its own `.github/workflows/docs.yml` to check its documentation on its own pull requests.

Inputs: `path` (required: the project's path in `projects.json`) and `ref` (optional: a commit, branch or tag of this repository to build with instead of the commit pinned in `uses:`, which the workflow reads from `job.workflow_sha`).

Steps, with `contents: read` and no secret:

1. Find the revision of the tool (`ref`, else the commit of this workflow file) and validate it and `path` against a strict pattern.
2. Check out this repository at that revision, without its submodules, into `workspace/`; check out the calling project's pull request into `project/`.
3. Fail with a plain message when `path` is not in `projects.json`.
4. Fetch every other project as a submodule, shallow and over https only.
5. `npm ci --ignore-scripts`, `npm run build`, then `CI=true node build/cli.js check --only <path> --source <path>=<the project's checkout>`.

The project's pull request is judged exactly as the site will build it, links to the other projects included. Its code is never installed or executed: it is read as documents. The trigger belongs to the caller and must be `pull_request`, `push` or `workflow_dispatch`, never `pull_request_target` or `workflow_run`. See [adding a project](../guide/adding-a-project.md#check-a-projects-own-pull-requests) for the caller.

The repository that supplies the tool is named once inside the workflow (`WORKSPACE_REPOSITORY`), because inside a called workflow `github.repository` is the caller's.

## `ci.yml`

The workflow that tests this repository, with one required check, `ci`, that gathers the rest and tolerates skipped jobs. It runs the format check, lint, type check, and the unit and integration tests; builds and checks the documentation workspace when the change can reach the site (the same paths as the push filter of `deploy.yml`, always on a manual run); runs the browser suites against a fixture workspace; lints the workflows with `actionlint` and `zizmor`; and checks that a pull request title is a Conventional Commit. A run started with `workflow_dispatch` is how a bump pull request opened with `GITHUB_TOKEN` gets its checks.

## Trust model

Documentation is other people's text. A project's `docs/` folder is content that this repository reads, never code it runs.

- **The build job has a read-only token and no secret.** A pull request, a fork's included, can change `docs/`, and a project's repository can change what its submodule contains; none of that can reach a secret or a write permission.
- **The deploy job runs no code of anyone's.** It is the only job with `pages: write` and `id-token: write`, and it hands the artifact the build job made to GitHub Pages.
- **The submodules are fetched shallow, over https only** (`GIT_ALLOW_PROTOCOL=https`), and a pull request that edits `.gitmodules` cannot make the build run a hook: nothing in a submodule is executed.
- **Installs run no scripts**: `npm ci --ignore-scripts`. The Jx packages are pinned exactly.
- **A page of Markdown is data in the build.** Jx runs every string that holds `${` as JavaScript when it builds an attribute, so staging writes every `${` of a page inert, in every spelling, before Jx sees it, and the registry refuses the sequence in its own text keys. A pull request that changes only `docs/` cannot run code in the build.
- **Markdown is not trusted on the published site**, which is served from avunu.net's domain. The lint refuses raw HTML, links, images and directives that run code or load another page; the output assertions refuse any built page that holds a script, an event handler, an unsafe address or an embedded page, and any published file that would run when opened, in every mode; and every page carries a Content-Security-Policy that names its own inline scripts by hash and refuses all others. See [the build pipeline](build-pipeline.md#the-content-security-policy).
- **Callers pin `check-docs.yml` by commit**, and every action in every workflow is pinned by commit.
- **The bump token is the only credential**, it lives in this repository alone, and it is limited to this repository.
