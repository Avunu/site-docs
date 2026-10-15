---
title: Build pipeline
description: The steps from the registry to the published folder, what is asserted about the result, the Content-Security-Policy every page carries, and the work folder.
order: 3
updated: 2026-10-15
tags: [reference, pipeline, jx]
---

`build` and `check` run one pipeline. It has nine steps; `check` adds the contrast gate, the link crawl and the CI summary. Every step prints with its stage prefix, and problems are collected rather than thrown until the end of the Jx step.

The steps that work on one project's documentation (stage, lint, nav) run once per project. The others run once for the whole site: one Jx build, one post-build, one set of assertions, one published folder.

## Why a generated project root

Jx has no project-level composition. It reads `pages/`, `components/*.json` (flat), `public/` and the layout chain only from the project root, and `project.json` has no `extends`. So the build assembles a plain Jx project root in `.site-docs/site/` from real file copies and runs the released Jx compiler on it with `jx build <root>`. That uses only documented Jx surfaces: no Jx extension, no hook, no mutation of Jx internals.

Jx also ignores what it does not understand and still exits 0: an unknown key, an unregistered component (an empty custom element is emitted). The pipeline therefore asserts the output positively (step 8).

## The steps

| Step         | Stage        | Per     | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | `registry:`  | site    | Read and validate `projects.json` (all problems at once). Choose the projects (`--only`). Check that every project's Markdown folder is on disk, naming the submodule command when it is not.                                                                                                                                                                                                                                                                                                                                                                                    |
| 2            | `assemble:`  | site    | Recreate `.site-docs/site` empty. Copy the shell (`site/`) into it, write `project.json` (the base with the site's name, URL and link strictness), the project catalog, `public/CNAME`, link the four Jx packages, and write each project's two pages, `pages/<path>/index.json` and `pages/<path>/[...path].json`, from the two templates in `site/templates/`.                                                                                                                                                                                                                 |
| 3            | `stage:`     | project | Copy the project's Markdown folder to `.generated/docs/<path>/docs` (dotfiles skipped, the symbolic-link policy applied). Rewrite links and images (Markdown and raw HTML) that point at repository files outside the Markdown folder to GitHub URLs, and root-relative links to docs pages to page-relative ones. Move a leading comment below the front matter. Write every `${` inert.                                                                                                                                                                                        |
| 4            | `lint:`      | project | Markdown checks over the original folder with `file:line`: reference-style links, footnotes, task lists, `${...}` in an address or a tag, unbalanced `<details>`, inline `<a href>`, and raw HTML, links, images and directives that run code or load another page. Errors are collected.                                                                                                                                                                                                                                                                                        |
| 5            | `nav:`       | project | Compute the sidebar, previous and next links and the landing cards from the staged copy, write `.generated/nav/<path>.json`, and write the project's facts to `.generated/config/<path>.json`.                                                                                                                                                                                                                                                                                                                                                                                   |
| 6            | `jx:`        | site    | Print the exact command, then run `<node> <compiler>/bin/jx.js build <root>` with the root as the working directory. Stdout and stderr are captured, echoed and written to `.site-docs/jx.log`. A non-zero exit is a failure. Then classify: the problems are the lint errors, Jx output lines matching `^(Content\b\|Warning:\|Error)` and skipped symbolic links; `Done: N routes` must be at least the pages the sidebars promise plus the shell's static pages. Strict: print everything once and stop with nothing published. Lenient: print them as warnings and continue. |
| 7            | `postbuild:` | site    | On `.site-docs/site/dist`: tidy whitespace, escape `<title>`, set canonical and `og:url` with a trailing slash, move `404/index.html` to `404.html`, delete the per-page `index.md` copies, write the `${` of step 3 back as text, repair repository links in raw HTML (each page's links go to the repository and branch of its own project), rewrite `sitemap.xml`, fix search-index titles, put a Content-Security-Policy meta first in the head of every page, and warn (never fatally) about code fences in languages the highlighter does not know.                        |
| 8            | `assert:`    | site    | Positive assertions on the result, each printed `ok` or `FAIL`. A failed assertion is fatal in every mode. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9            |              | site    | Publish: copy `.site-docs/site/dist` to a temporary folder beside `./dist`, remove the old `./dist` and rename the new one into place. Only after steps 6 and 8 passed (strict) or ran (lenient). Print `build: N page(s) of M project(s) written to <dist>`.                                                                                                                                                                                                                                                                                                                    |
| `check`      | `contrast:`  | site    | Resolve the effective tokens and the search highlight and run the WCAG pairs; any pair below its minimum fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `check`      | `links:`     | site    | Crawl `./dist` with every project's nav data: every link, anchor, asset, search result and sidebar entry must resolve, every sidebar page must have been built, and every built page below a project's documentation prefix must be in its sidebar.                                                                                                                                                                                                                                                                                                                              |
| `check --ci` |              | site    | Write the job summary and the step outputs; print `check: all steps passed` or `check: FAILED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

A failed strict build leaves the previous `./dist` untouched.

Jx evaluates every string that holds `${` as JavaScript, and its parser makes inert only the text of a page, not an address, a URL, a raw HTML attribute, a directive or the language of a fence. Step 3 therefore writes every `${` of a page with a zero-width space between `$` and `{`, in code and front matter as well and in every spelling that Markdown, HTML or YAML decodes to it, and step 5 does the same for the sidebar data. Step 7 writes the marker back as `&#36;{` in every text node, so prose and code read as written; an attribute value keeps it. See [the trust model](workflows.md#trust-model).

### The assertions of step 8

- Every component file of the root was emitted as `components/<name>.js`.
- No registered custom element is left empty (not rendered).
- No page has an empty link: an `<a href>` with no text, image or `aria-label`. A raw HTML anchor in the Markdown is the usual cause, and step 4 reports it as a lint error with its file and line.
- Exactly one `<h1>` per page.
- The `<title>` of every page is text: the head has one `<title>` and one `</title>`. Jx writes the title text as it is, so a title that holds `</title>` would end the element and leave what follows it as live HTML in the head.
- No unevaluated template text in the output: a dollar sign, an opening brace and the word `state`, which would mean a page template was not evaluated.
- `CNAME` equals `domain`.
- At least one `fonts/*.woff2`; `@font-face` URLs are local; no third-party font host appears.
- `favicon.svg`, `favicon.ico` and `.nojekyll` exist.
- `search-index.json` has an entry for every documentation page of every project.
- `sitemap.xml` is present and on the registry's domain.
- `404.html` is present and there is no `/404/` folder.
- There are no `*.md` copies.
- The project menu is pre-rendered from the catalog.
- The route count of step 6.
- No page holds a script, an event handler, a `javascript:`, `data:` or other unsafe address, or an embedded page (`iframe`, `object`, `embed`, `form`, `base`), and the page content (`docs-prose`) holds no `script`, `style`, `link` or `meta` and no `style` attribute. This reads what Jx wrote, so it also catches what raw HTML, links, images and `:name{...}` directives made.
- Every file Jx published from the Markdown (`content/`) is not active: no `.html`, `.js`, `.xsl` or similar, no SVG with scripts or handlers, no XML that says it is XHTML or SVG.
- Every page with a head carries a Content-Security-Policy meta before its first script, whose `script-src` is open to nothing but the site and names each inline script by its hash.

### The Content-Security-Policy

Documentation is other people's text on a domain that is same-site with the client portal, so the pages say what they may do. Step 7 puts this meta first in the head of every page (after `<meta charset>`), with the hashes of the page's inline scripts filled in:

```text
default-src 'self'; script-src 'self' 'sha256-...'; style-src 'self' 'unsafe-inline'; img-src 'self' https:;
font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'
```

A browser then refuses an inline event handler, a `javascript:` address, an inline script the build did not write and any script from another origin; it embeds nothing, cannot be sent to another `<base>` and submits no form. Styles keep `'unsafe-inline'` because the pages carry `<style>` blocks. Images may come from any https site, so that a page can show the badge of its repository. `connect-src` allows `https://avunu.net` for the project menu, which is built into every page at build time and makes no request of its own. A policy that the shell's own layout adds is enforced too, and can only narrow this one.

## The work folder

```text
.site-docs/                        git-ignored; contains its own .gitignore with the single line *
  jx.log                           raw stdout and stderr of the last Jx run
  site/                            THE JX PROJECT ROOT (recreated empty on every run)
    project.json                   generated from site/project.base.json
    components/ layouts/ pages/    copies of the shell, then pages/<path>/ for each project
    templates/                     the two page templates of a project (not routes)
    public/                        the shell's public files and CNAME
    data/projects.snapshot.json    the project catalog: the bundled snapshot with the registry on top
    .generated/docs/<path>/docs/   each project's staged Markdown
    .generated/nav/<path>.json     each project's sidebar, previous and next, landing cards
    .generated/config/<path>.json  each project's facts: name, repo, branch, docs folder, addresses
    node_modules/@jxsuite/         links to the installed compiler, parser, runtime and search
    dist/                          the Jx build output, post-processed in place
dist/                              the published copy; the only folder CI uploads
```

The layouts and pages read a project's facts through the content type `config`, its sidebar through `nav`, the project menu through `projects`, and its Markdown through `docs`. A page names its project's entries in its own state (`config` and `nav` entries with the project's path as id), which overrides the layout's defaults for the site's own entries. That is why each project gets its own two page files rather than one shared template: Jx resolves a content entry's id when it builds, and cannot take it from a variable.

## The project catalog

The project menu is built from a catalog that is part of the build: a snapshot of avunu.net's project catalog bundled in `site/data/`, with every registered project's `docs` address set from the registry. The build needs no network and the output does not depend on avunu.net at build time. A project the snapshot does not know is added from its registry entry. Entries without a `docs` address link to their page on avunu.net.

## What CI runs

See [workflows](workflows.md): `ci.yml` runs this pipeline for pull requests that can change the site, and `deploy.yml` runs it on the default branch and publishes the result.
