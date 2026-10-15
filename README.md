# site-docs

The documentation of every Avunu open-source project, in one site: [docs.avunu.net](https://docs.avunu.net).

Each project keeps its Markdown in its own `docs/` folder. This repository holds every project as a git submodule, builds all of those folders into one [Jx](https://jxsuite.com) site (the framework behind avunu.net) with one look, one search and one project menu, checks it, and publishes it to GitHub Pages. A project's documentation is at `https://docs.avunu.net/<path>/`, for example `https://docs.avunu.net/frappe-nix/docs/`.

The full documentation is in [`docs/`](docs/README.md), written so that it builds with this very repository: it is the documentation of the project `site-docs`.

## What is here

```text
projects.json            the registry: which projects, and under which path
.gitmodules              where each project's repository is
projects/<path>/         one git submodule per project, pinned to a commit
site/                    the Jx project that gives every page its look
src/                     the build: reads the registry, builds one site, checks it
docs/                    this repository's own documentation
verify/                  the browser suites (axe, CSP, keyboard) for the built site
scripts/                 the scripts the workflows run: the bump of submodule pointers, the title check
.github/workflows/       bump, check a project, build and deploy, and this repository's CI
```

## Quick start

```bash
git clone --recurse-submodules https://github.com/Avunu/site-docs
cd site-docs
npm ci --ignore-scripts
npm run build
node build/cli.js build
```

You need Node 22.19.0 or newer (CI uses 24). The command writes the whole site to `dist/`; serve it with any static file server:

```bash
python3 -m http.server --directory dist 8000
```

To preview one project's documentation from your own working copy, without the other projects:

```bash
node build/cli.js build --lenient --only frappe-nix --source frappe-nix=../frappe-nix
```

`node build/cli.js check` is what CI runs: a strict build, a colour-contrast check and a crawl of every link. `npm run docs:build` and `npm run docs:check` run the two commands. See [previewing](docs/guide/previewing.md) and [the command line](docs/reference/command-line.md).

## How a project gets here and stays current

- A maintainer adds the project to `projects.json` and as a submodule, in one pull request: [adding a project](docs/guide/adding-a-project.md).
- A scheduled workflow moves each submodule to its project's latest release, or to the head of its default branch while the project has none, and opens one pull request for all of them. No secret is stored in the project repositories.
- Each project can check its own pull requests against the site with one small reusable workflow, before it merges them.
- A push to the default branch builds the site and publishes it. See [workflows](docs/reference/workflows.md).

## Writing documentation for the site

A project writes plain Markdown in `docs/` with a `README.md` as its home page. The build fails in CI on a broken link, a missing image, Markdown the site cannot show faithfully, an empty link, and any script, event handler or `javascript:` address, and every page carries a Content-Security-Policy. [Writing documentation](docs/guide/writing-docs.md) lists the conventions and the few constructs that do not render.

## Licensing

Code: MIT, Copyright (c) 2026 Avunu LLC; see [LICENSE](LICENSE). The fonts under `site/public/fonts/` (Figtree and JetBrains Mono) keep their own licenses, the SIL Open Font License 1.1, with the texts alongside. The documentation of each project is under that project's own license. The Avunu name and logos are trademarks of Avunu LLC; the MIT license does not grant rights to them.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [MAINTAINING.md](MAINTAINING.md) for the maintainer's checklist, and [SECURITY.md](SECURITY.md) for how to report a vulnerability.
