# Security policy

This repository builds `docs.avunu.net` from the documentation of every Avunu open-source project, and its workflows run with permission to publish to GitHub Pages and to push a branch and open pull requests. We treat reports about it seriously.

## Reporting a vulnerability

Use **[private vulnerability reporting](https://github.com/Avunu/site-docs/security/advisories/new)** on this repository. Please do not open a public issue or pull request for a suspected vulnerability.

If you cannot use GitHub, email [PLACEHOLDER: security mailbox at avunu.net, to be confirmed by Avunu LLC before launch].

Include what you can of the commit you tested, the steps to reproduce it and what an attacker gains.

We aim to acknowledge a report within three business days and to agree a disclosure date with you once a fix is ready. We credit reporters in the fix unless you would rather we did not.

## Supported versions

This repository is a site, not a package: only the default branch is supported, and fixes land there and deploy with the next push.

## Scope

In scope:

- The build in `src/`, and the shell in `site/` that every page is made from.
- The workflows in `.github/workflows/` and the scripts they run: for example a way to run code with the deploy job's permissions, to publish to GitHub Pages from a pull request, to read the bump token, or to make `check-docs.yml` run a calling project's code.
- A way for documentation Markdown (raw HTML, a link, an image, a `:name{...}` directive, a `${...}` or a file that a page links to) to run code in the build job, or in a reader's browser on the published site, past the staging, the lint, the output assertions and the Content-Security-Policy described below.

Out of scope:

- Vulnerabilities in a project's own repository, its workflows or its code. This repository reads a project's `docs/` folder as documents and never runs anything from it.
- Vulnerabilities in Jx itself. Report those to [jxsuite/jx](https://github.com/jxsuite/jx/security).
- Denial of service by volume.

## Design notes for reporters

These are the properties the system intends to have. A way to break one is a vulnerability.

- The build job has `contents: read` and no secrets. The deploy job executes no project code. No workflow that a pull request can trigger asks for `pages: write` or `id-token: write`.
- A project's `docs/` folder is content, never code. Its submodule is fetched shallow and over https only, nothing in it is installed or executed, and a pull request that edits `.gitmodules` cannot make the build run anything from it.
- A page of Markdown is data in the build: a `${...}` in it, in any spelling, never reaches Jx as a template, so a pull request that changes only a project's `docs/` cannot run code in the build job. The registry's own text keys may not hold `${` either.
- Markdown is not trusted on the published site, which is served from avunu.net's domain (same-site with the client portal). Raw HTML may use only text, table and image elements, no event-handler or `style` attribute, and addresses may only be http, https, mailto, tel or relative: the lint refuses the rest with the file and line, the output assertions refuse any built page that holds a script, an event handler, an unsafe address or an embedded page, and any published file that would run when opened (HTML, script, active SVG or XML), in every mode, and every page carries a Content-Security-Policy meta that names the page's own inline scripts by hash and refuses all others. A way to get a script to run in a reader's browser from a documentation pull request is a vulnerability. Not covered: pull requests that change `site/`, `src/` or `.github/`, which are reviewed as code.
- `check-docs.yml` is called by pinned commit, reads the calling project's checkout only as documents, has a read-only token and no secret, and must be called from `pull_request`, `push` or `workflow_dispatch`, never `pull_request_target` or `workflow_run`. Every action in every workflow is pinned by commit.
- The bump token is the only credential. It lives in this repository alone and is limited to it; no project repository holds a secret for this system.
- No install script runs, the build makes no network access, and the build deletes only paths inside the workspace's `.site-docs/` and `dist/`.
- Files that are published are copies; a symbolic link that leaves the repository is skipped, never followed.
