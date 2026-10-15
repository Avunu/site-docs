---
title: Maintainers
description: Where to find the operations guide, the one-time migration runbook, the contribution rules and the security policy, and the changes asked of Jx.
order: 4
updated: 2026-10-15
tags: [maintainers, operations]
---

This section is for the people who run `docs.avunu.net` and change the tool that builds it. A project that only has documentation on the site does not need it.

| Document                                 | Contents                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Operations](operations.md)              | The secrets and settings to create once, how a bump happens and how to force one, and what to do when it fails |
| [Migration](migration.md)                | The one-time, ordered runbook from the per-project documentation sites to `docs.avunu.net`                     |
| [Upstream asks](upstream-asks.md)        | The changes asked of Jx, and the code each one would delete here                                               |
| [MAINTAINING.md](../../MAINTAINING.md)   | The maintainer's checklist, in one page                                                                        |
| [CONTRIBUTING.md](../../CONTRIBUTING.md) | Toolchain, commit rules and how the repository is organized                                                    |
| [SECURITY.md](../../SECURITY.md)         | How to report a vulnerability, and the properties the system intends to have                                   |

## The pipelines of this repository

| Workflow         | Runs                                               | Does                                                                                                |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ci.yml`         | Pull requests, pushes to `main`, by hand           | Tests the tool, builds and checks the workspace, runs the browser suites. One required check, `ci`. |
| `deploy.yml`     | Pushes to `main` that can change the site, by hand | Builds the site and publishes it to GitHub Pages                                                    |
| `bump.yml`       | Every 30 minutes, by hand                          | Moves each project's submodule pointer to its latest release and opens one pull request             |
| `check-docs.yml` | Called by each project                             | Checks a project's pull request as the site would build it                                          |
| `jx-latest.yml`  | Weekly                                             | Installs the latest Jx over the pins, runs the integration tests, and opens an issue on failure     |

See [workflows](../reference/workflows.md) for the details. Dependabot groups the `@jxsuite/*` updates, the runtime dependency `yaml`, the development tooling and the browser suites (`chore(deps)` all of them) and GitHub Actions (`ci(deps)`).
