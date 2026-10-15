# Maintaining site-docs

A maintainer's checklist for `docs.avunu.net`. The details are in the documentation tree; this page is the order to read it in.

| When                                                    | Read                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Setting up or repairing the repository, once            | [Operations](docs/maintainers/operations.md): the secret, Pages, DNS and the settings below |
| Moving from the per-project sites to `docs.avunu.net`   | [Migration](docs/maintainers/migration.md): the ordered runbook, who does each step         |
| A bump pull request is red, or a project is not current | [Operations](docs/maintainers/operations.md#when-a-bump-pull-request-fails)                 |
| Adding, renaming or removing a project                  | [Adding a project](docs/guide/adding-a-project.md)                                          |
| Something in the build needs a change in Jx             | [Upstream asks](docs/maintainers/upstream-asks.md)                                          |

## What a pull request can do, and what a person must do

Everything in the repository is a pull request. These are not files, so a person makes them in GitHub's settings or at the DNS host, and no pull request can:

1. **`BUMP_TOKEN`**, a repository secret limited to this repository (Contents, Pull requests and Actions: read and write). Without it bump pull requests start no CI by themselves and merging one does not deploy.
2. **GitHub Pages**: source GitHub Actions, custom domain `docs.avunu.net`, Enforce HTTPS.
3. **DNS**: `docs.avunu.net. CNAME avunu.github.io.`
4. **`DOCS_SITE_ENABLED`**, a repository variable set to `true` once 2 and 3 are done. Until then the site is built and checked, never published.
5. **A ruleset on the default branch**: require a pull request and the status check `ci`, nothing else; block force pushes and deletion; allow squash merging only. Turn on **Allow auto-merge** and **Automatically delete head branches**.
6. **Security settings**: Dependabot alerts and security updates, secret scanning with push protection, private vulnerability reporting, and Actions pinned to a full commit SHA. Leave the default workflow permission at `read`.
7. **Verify `avunu.net`** for the organization's GitHub Pages, once, so that only the organization's repositories can serve the domain and its subdomains.

## Merging

Pull requests are squash-merged, so the pull request title becomes the commit message: use a [Conventional Commit](CONTRIBUTING.md#commits-and-pull-requests). A bump pull request, `chore(docs): bump N project(s)`, merges itself when `ci` is green. Nothing in this repository is released or published to a package registry: the site is the product, and a merge to the default branch deploys it.

## Updating Jx

The build pins the exact Jx versions it was tested with. Dependabot opens a grouped pull request for a Jx release (`chore(deps)`); `ci` builds a fixture workspace against it, including the integration tests that run the real Jx on documents that break each rule; a person merges it. `jx-latest.yml` installs the latest Jx over the pins every week and opens an issue when that fails, as the early warning for a release Dependabot has not proposed yet.

## Facts the design rests on

- Jx reads `components/`, `pages/` and `public/` only from the project root, so the build assembles a root in `.site-docs/site/` from real copies, and runs the pinned compiler on it. See [the build pipeline](docs/reference/build-pipeline.md).
- Jx cannot serve a project under a path with everything that a page loads rebased, so the site is one Jx project at the root of one domain, with each project's pages generated under `/<path>/`. See [upstream asks](docs/maintainers/upstream-asks.md).
- The tool is TypeScript compiled to `build/` and run with Node alone. Bun is used only by the browser suites in `verify/`.
- A published page is served from avunu.net's domain, so the Markdown of every project is treated as untrusted input. See [SECURITY.md](SECURITY.md).
