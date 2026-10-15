---
title: Upstream asks of Jx
description: The changes this repository asks of Jx, why each is needed, the workaround that stands in for it today, and the code each one would let this repository delete.
nav_title: Upstream asks
order: 3
updated: 2026-10-15
tags: [maintainers, jx, upstream]
---

Much of the build exists because Jx has no project-level composition and no way to serve one project under a path. Jx is Avunu's own framework, so each ask below is realistic. When one lands, the named code is deleted from this repository and the registry and the projects do not change.

The asks were verified against the Jx packages pinned in `package.json`.

## What Jx does today

These facts shape the design:

- Jx reads `pages/`, `components/*.json` (flat), `public/` and the `$layout` chain only from the project root, and a nested `$layout` is resolved against that root.
- `project.json` has no `extends`.
- `copy` takes files only, and a directory symlink as `public/` fails the build.
- Unknown keys and unregistered components are silently ignored: an empty custom element is emitted and the build still exits 0.
- An extension's `emit` cannot modify or delete files that Jx already wrote, and it runs only for a non-empty section.
- Jx reads `components/` in raw directory order, so the order of component styles and module preloads in the output follows the file system.
- A `ContentEntry` id has to be a literal or a route parameter: Jx does not resolve one computed from state when it builds, and a `[project]` segment in front of a catch-all `[...path]` did not work as a way to carry the project either.
- A site `url` with a path rewrites the addresses in the finished HTML only. Component props, component JavaScript, `data-jx-props` values and the search client's `indexUrl` keep the root-relative addresses they were written with, so a site built to live under `/<path>/` breaks after the page hydrates.

The build works around them by assembling a plain Jx root from real copies (see [build pipeline](../reference/build-pipeline.md)), by asserting the output positively because Jx will not complain, by building **one** site for every project at the root of one domain instead of one site per project under a path, and by writing two page files per project from templates.

## The asks

| Ask                                                                                                          | What it would delete here                                                           |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| A base path that reaches everything a page loads: component props, module imports, search index and assets   | The one-site-at-the-root design, and the per-project page files made from templates |
| Computed `ContentEntry` ids, or a `[project]` route parameter in front of `[...path]`                        | `src/workspace/pages.ts` and the two templates in `site/templates/`                 |
| `project.json` `extends`, or presets                                                                         | The base merge in `src/lib/project.ts`                                              |
| Components, pages and layouts supplied by a package, and `copy` of directories                               | Copying `site/` into the generated root                                             |
| A sorted directory read of `components/`                                                                     | The byte-reproducibility caveat                                                     |
| An extension `emit` that can modify or delete written files, and consistent `head` gating for empty sections | Nothing today; it makes the Jx-extension route viable for `src/lib/postbuild.ts`    |
| Computing the navigation inside Jx from the loaded collection                                                | `src/lib/docs.ts`, `src/lib/nav.ts` and their copy of Jx's route rules              |
| A correct error for package subpaths that are not exported                                                   | Nothing                                                                             |

### A base path that reaches everything

The largest ask, and the one that decided the architecture. With it, each project could build as its own small Jx site under `/<path>/` and the registry would only choose the path. One fix is already proposed to Jx ([jxsuite/jx#454](https://github.com/jxsuite/jx/pull/454), which re-roots the `$src` import addresses of component and page modules on the base path); the search extension's index address and the `data-jx-props` values need the same treatment.

### Computed content entry ids

A page of a project names its project's `config` and `nav` entries in its own state, with the project's path as the entry id. Because the id cannot be computed, there is one pair of page files per project, written from two templates before Jx runs. A computed id, or a route parameter that carries the project, would make them one pair of files for every project.

### Composition: `extends` and packages

With `extends` (or presets), the shell would ship its project settings and the generated `project.json` would go. With components, pages and layouts loadable from a package, the shell could be the project root itself, and the copying of `site/` into `.site-docs/site/` would go.

### A sorted read of `components/`

Jx reads `components/` in raw directory order. The component styles and module preloads in the output therefore appear in the order the file system returns, so comparing two builds needs a normalizing step and byte-for-byte reproducibility is not promised. A sorted read would remove both.

### Extensions

An extension's `emit` cannot change or delete files Jx already wrote and runs only when its section is non-empty, so a Jx extension cannot yet do what the post-build step does (move `404/index.html`, drop the per-page Markdown copies, fix canonical addresses). Allowing `emit` to modify and delete, and gating `head` consistently for empty sections, would make an extension a viable replacement for part of the post-build step.

### Navigation inside Jx

The sidebar, previous and next links and the landing cards are computed by this repository from the staged Markdown, and it re-implements Jx's route, `exclude` and `where` rules to do it. A test asserts that the two agree, and the link crawl is the safety net. Computing the navigation inside Jx, with a `$prototype` class that reads the loaded collection, would remove the duplicate rules.

### Errors for package subpaths

The ask is that Jx report a package subpath that is not exported with an error that says so. It deletes nothing here.

## Filing them

Each ask belongs in an issue on [`jxsuite/jx`](https://github.com/jxsuite/jx/issues) that links to this page and names the version it was verified against. Whether and when to file them is a decision for the maintainers.
