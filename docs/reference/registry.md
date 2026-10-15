---
title: The registry
description: Every key of projects.json, the rules each one is validated against, and how a project's repository and Markdown folder are found.
order: 2
updated: 2026-10-15
tags: [reference, registry, configuration]
---

`projects.json`, at the root of this repository, is the registry: the list of projects whose documentation the one site publishes. It is read first by every build, and every problem in it is printed at once. A project is also a git submodule at `projects/<path>`, listed in `.gitmodules`; the registry says what the site needs to know about it.

```json
{
  "domain": "docs.avunu.net",
  "name": "Avunu documentation",
  "tagline": "Documentation for Avunu's open-source projects.",
  "org": "https://github.com/Avunu",
  "projects": [
    {
      "path": "frappe-nix",
      "slug": "frappe-nix",
      "name": "frappe-nix",
      "tagline": "Reproducible Nix infrastructure for Frappe and ERPNext.",
      "platform": "nixos",
      "repo": "https://github.com/Avunu/frappe-nix",
      "license": "MIT",
      "branch": "main",
      "docs": "docs"
    }
  ]
}
```

## The keys of the site

| Key        | Required | Meaning                                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `domain`   | yes      | The host the site is served from, without a scheme: `docs.avunu.net`. It is written to `CNAME`, the sitemap and canonical addresses. |
| `name`     | yes      | The name of the site: the title of the home page and of the 404 page.                                                                |
| `tagline`  | yes      | One sentence under the name on the home page.                                                                                        |
| `org`      | yes      | The organization on GitHub, `https://github.com/Avunu`: the footer and the header of pages that belong to no project.                |
| `projects` | yes      | The list of projects, sorted by `path`.                                                                                              |
| `$schema`  | no       | Accepted so that an editor can be pointed at a schema. Nothing reads it.                                                             |

## The keys of a project

| Key        | Required | Meaning                                                                                                                                                 |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`     | yes      | The URL segment and the submodule folder: `https://docs.avunu.net/<path>/` and `projects/<path>`. A setting, never worked out from the repository name. |
| `slug`     | yes      | The key of the project in the avunu.net catalog. It may hold underscores (`erpnext_taskview`).                                                          |
| `name`     | yes      | The project's name, in the header, the title of its pages and the project menu.                                                                         |
| `tagline`  | yes      | One sentence about the project: the landing page, the home page's card and link previews.                                                               |
| `platform` | yes      | One of `frappe`, `odoo`, `wordpress`, `nixos`, `general`. It decides the group in the project menu and on the home page.                                |
| `repo`     | yes      | `https://github.com/<owner>/<repository>`: the header link, "Edit this page" and repository links in the Markdown.                                      |
| `license`  | yes      | The license, as a short name: the landing page and the footer.                                                                                          |
| `branch`   | yes      | The default branch of the repository. "Edit this page" and repository links name it, and a project without a release follows it.                        |
| `docs`     | no       | The Markdown folder inside the repository, `/`-separated. Default `docs`.                                                                               |
| `local`    | no       | `true` for a project that lives in this repository (its documentation is in this repository's own `docs/`). No submodule is needed for it.              |

## Validation

The registry is invalid, and nothing is built, when any of these holds. Each message names the project, or `projects.json` for the site's own keys.

- The file is missing (`is not a docs workspace`), is not valid JSON, or is not an object.
- A key is not one of the known keys, for the site or for a project.
- A required key is missing, or a text key is not a non-empty string.
- A text key (`name`, `tagline`, `license` and the site's `name` and `tagline`) contains `${`. Jx runs every string that holds it as JavaScript when the site is built, so it is refused before anything runs.
- `name` or `license` is longer than 80 characters, or `tagline` is longer than 200.
- `domain` is not a host name (it has a scheme, or no top-level domain).
- `org` is not `https://github.com/<organization>`.
- `path` is not lowercase letters, digits and hyphens in one segment, is one of the reserved names, or is used by an earlier project. The reserved names are `assets`, `brand`, `components`, `data`, `fonts`, `images`, `public` and `404`: the site publishes its own files there.
- `slug` is not lowercase letters, digits, hyphens and underscores, or is used by an earlier project.
- `platform` is not one of the five.
- `repo` is not `https://github.com/<owner>/<repository>`, or is used by an earlier project (compared without regard to case). Projects marked `local` may share an address.
- `branch` is not a branch name that is safe in a URL: a name with `..`, `//`, a space or a quote, or that starts with a dash or a dot, or is longer than 100 characters, is refused.
- `docs` starts with `/` or has a `..` segment: it must be a folder inside the repository.
- `local` is not `true` or `false`.
- The projects are not sorted by `path`. Keeping them in order makes a change show as one line.

## Finding a project's files

| Project                         | Its repository is read from                 | Its Markdown folder is       |
| ------------------------------- | ------------------------------------------- | ---------------------------- |
| An ordinary project             | `projects/<path>` below the workspace       | `projects/<path>/<docs>`     |
| A project with `local: true`    | The workspace itself                        | `<docs>` below the workspace |
| Any project named by `--source` | The folder given in `--source <path>=<dir>` | `<dir>/<docs>`               |

The build stops, naming the folder, when a project's Markdown folder is not there. For a submodule it says to run `git submodule update --init projects/<path>`.

## What the registry decides

- **Addresses.** A project's landing page is `/<path>/`, its documentation home `/<path>/docs/`, and a page of `docs/guides/install.md` is `/<path>/docs/guides/install/`.
- **The project menu.** The site's catalog starts from the bundled snapshot of avunu.net's project catalog, and the registry sets each listed project's `docs` address to `https://<domain>/<path>/`. A project the snapshot does not know yet is added from its registry entry, with its page on avunu.net assumed at `/open-source/<slug>/`. Projects with no `docs` address in the catalog link to their page on avunu.net.
- **Edit links and repository links.** Each page links into its own project's `repo` and `branch`, in the `docs` folder.
- **The home page.** It lists the projects that have a `docs` address, grouped by platform and sorted by title.
