---
title: Troubleshooting
description: Messages the build prints, what causes them and how to fix them, and how to look inside a build when something is wrong.
order: 5
updated: 2026-10-15
tags: [guide, troubleshooting, debugging]
---

Every message starts with the stage that printed it: `registry:`, `assemble:`, `stage:`, `lint:`, `nav:`, `jx:`, `postbuild:`, `assert:`, `contrast:`, `links:` or `check:`; the closing lines of a failed build start with `docs:`. A message about one project's documentation names the project and the file: `frappe-nix/docs/guide/x.md:12`. The exit code says which kind of problem it is: 1 a problem was found, 2 a usage error, 70 a crash. See [exit codes](../reference/command-line.md#exit-codes).

## A project's folder is not checked out

```text
registry: error: other: documentation/user/ is not in /work/site-docs/projects/other; run `git submodule update --init projects/other` (or clone with --recurse-submodules)
```

The registry lists the project but its submodule is empty. Run the command the message gives, or `git submodule update --init --depth 1`. When you are previewing one project from your own checkout, pass `--only <path> --source <path>=<dir>` instead, as [previewing](previewing.md) shows. If the folder exists but the Markdown folder is not in it, the `docs` setting of the project in `projects.json` is wrong, or the project's own `docs/` was moved.

## The registry is invalid

```text
registry: error: project frappe-nix: "path" is used by an earlier project
```

`projects.json` is read first and every problem in it is printed at once, each naming the project it belongs to, before anything is built. The rules are in [the registry](../reference/registry.md#validation).

## "K document problem(s) above fail the build"

```text
docs: 3 document problem(s) above fail the build. Fix the documents, or run with --lenient while you work through them.
```

The strict build (`CI=true`, and always `check`) collects every document problem before it stops: lint errors, Jx output lines that start with `Content`, `Warning:` or `Error`, and skipped symbolic links. They are printed once, above this line, with `file:line` where there is one, and nothing is published. Fix them in the Markdown. While you work through a long list locally, `node build/cli.js build --lenient` prints the same problems as warnings and still builds. CI has no lenient setting.

Problems that are never downgraded, even by `--lenient`: a registry error, a failing `jx`, a failed output assertion and the contrast gate. A lenient build can therefore print warnings and still fail on an assertion. The `assert:` line names the page and its Markdown file, and the closing lines say that leniency does not reach it: if a `lint:` warning above is about the same file, that warning is the cause (see [an empty link](#an-empty-link-fails-the-build)).

## A link is plain text on the page

The build named the link. Its target does not exist, is a draft, or is not in the repository. Links to repository files outside `docs/` are rewritten to GitHub links, so this is a typo or a draft. The build prints the file and target, and in a strict build Jx itself exits non-zero and lists every broken link.

A link to another project's page is checked only when it is site-relative (`/frappe-nix/docs/production/`). A full `https://docs.avunu.net/...` address is not checked, so a typo in one is not caught.

## Reference-style links or footnotes are an error

The `lint:` stage reports them as errors with `file:line`: "Reference-style links are not rendered: every link that uses this definition loses its text. Write the links inline" and "Footnotes are not rendered: the marker and the note both disappear". The site cannot show them and would lose text. Write the links inline, `[text](url)`, and put a footnote in the sentence or in a callout. See [what does not render](writing-docs.md#what-does-not-render).

## Raw HTML, a link or a file is refused

```text
lint: error: frappe-nix/docs/guide/x.md:12  <iframe> is not allowed in documentation: it embeds another page. ...
assert: FAIL: pages hold something that runs code or embeds another page: /frappe-nix/docs/guide/x/ (<img onerror="...">)
assert: FAIL: files linked from the Markdown would run on the site's domain when opened: the linked file (a .html file, ...)
```

The pages are served from avunu.net's own domain, so a page may not carry a script, an event handler, an embedded page, a `javascript:` or `data:` address, or an HTML or script file. The `lint:` line names the file and line; the `assert:` lines name the page and the construct and are never downgraded by `--lenient`. Fix the Markdown: use Markdown for what it can say, an image file for a drawing, a link for a video or a page, and backticks for a tag or a `:name` that is only text. See [Raw HTML, addresses and files](writing-docs.md#raw-html-addresses-and-files). The `assert:` line `pages without a sound Content-Security-Policy` means a page has something before its `<head>` that a policy cannot govern, or no `<head>` of its own; the shell's layouts never do that, so the change that caused it is in `site/`.

## An empty link fails the build

The `assert:` stage prints `FAIL` for the assertion that no page has an empty link (an `<a href>` with no text, image or `aria-label`). Jx writes an empty link followed by the text (or the image) for a raw HTML anchor in a paragraph (an anchor inside a `<div>` or `<p>` block keeps its link), and the assertion fails in every mode, including `--lenient`. The `lint:` stage reports the anchor first, with `file:line` (an error, printed as a warning under `--lenient`). Replace the raw anchor with a Markdown link, `[text](url)`. Badges are `[![alt](image)](url)`.

## A `${...}` in a link or a tag is an error

```text
lint: error: frappe-nix/docs/x.md:12  A ${...} in a link address, a URL, an HTML tag, a directive or the language of a code fence is run by Jx as JavaScript when the site is built. ...
```

Jx runs every string that holds `${` as JavaScript when it builds a link, an image or an HTML attribute. The build therefore writes the text inert (a hidden zero-width space between `$` and `{`), so nothing runs, but the link or attribute no longer says what you wrote, and the strict build fails so that you and the reviewer see it. Write the address as `%24%7B...%7D`, or put the text in a code span or a code block, where `${HOME}` stays as written. See [what does not render](writing-docs.md#what-does-not-render).

## A symbolic link is not published

```text
stage: frappe-nix/docs/x.md is a symbolic link that does not resolve: not published
```

A symbolic link in a project's `docs/` is followed only when its real path is inside the project's repository and not inside `.git/`, `node_modules/` or the build's own `.site-docs/` and `dist/`. Anything else is skipped and reported, and in a strict build a skipped link is an error. Copy the file in, or move it into the repository. Nothing the build writes is a symbolic link.

## Jx dropped routes

The build parses `Done: N routes` from Jx and expects the number of pages of every project plus the static pages of the shell (the home page and the 404 page). A smaller number means Jx left pages out and is reported as a problem. Look for a file name that produces an address Jx and the sidebar disagree on: rename it to plain letters, digits, spaces and hyphens. Two files with one address (`docs/guides.md` beside `docs/guides/README.md`) are also reported, and only the README is published.

## A project's own check is green but the site build is red

The project's `docs.yml` checks its documentation with the other projects at the commits pinned in this repository at the commit its `ref` names. The site build uses the pointers of the bump pull request, so it can fail when a bump moves a project that another project links to, or when this repository's tool changed. The failing step in the log names the page. The fix belongs in the project whose page it is: see [operations](../maintainers/operations.md#when-a-bump-pull-request-fails).

## A change to `docs/` is not on the site

The site shows the commit that the project's pointer in this repository records, not the project's branch. Check, in order: the change is merged in the project's repository; the project has released since (a project with releases is bumped to its latest release only); the Bump projects workflow has run and its pull request has merged; the deploy run after the merge passed. See [adding a project](adding-a-project.md#how-documentation-reaches-the-site).

## Sharp fails to load on NixOS

```text
Sharp is required for image optimization but failed to load
```

The native `sharp` module cannot find the C++ library (`libstdc++.so.6`) as soon as a project's `docs/` contains an image. Provide the library for the command:

```bash
LD_LIBRARY_PATH="$(nix eval --raw nixpkgs#stdenv.cc.cc.lib.outPath)/lib" node build/cli.js build
```

The build prints a hint when Jx's output mentions `sharp` or `libstdc++`. Ubuntu CI is not affected.

## Hooks rewrite `docs/`

A pre-commit hook that stamps a copyright comment above the front matter does not break the build, because staging moves the comment, but GitHub and Obsidian then show the front matter as text. Exclude `^docs/` from that hook, and keep a formatter from reflowing the Markdown: the lint reports lines by number, and a reformatted file moves them.

## Looking inside a build

When something is wrong and the message is not enough, the build keeps everything it did in `.site-docs/` at the workspace root, which git ignores:

- `.site-docs/jx.log` is the raw output of the last Jx run.
- `.site-docs/site/` is the assembled Jx project: the shell's files, the generated `project.json`, the catalog in `data/`, each project's two pages in `pages/<path>/`, the staged Markdown in `.generated/docs/<path>/docs/`, each project's sidebar in `.generated/nav/<path>.json` and its facts in `.generated/config/<path>.json`.
- When Jx fails, the build prints `docs: jx build failed. The assembled project is <root>; run: <node> <jx.js> build <root>`. Run that command to see Jx's own output again.

The root is assembled from empty on every run, so anything you change in it lasts only until the next build, and `jx build` run by hand writes to `.site-docs/site/dist`, not to `./dist`, and skips the post-build steps.

> [!WARNING]
> Jx's own `validate` command does not work on the assembled root. It fails with `project.schema.json not found`, and when run after `jx schema` its validator reports the shell's own pages and layouts as invalid, because its schema for a `Function` entry has no `timing` key and the shell's pages use `timing: "compiler"`, which Jx's compiler accepts. Nothing in that report is yours to fix. Use `check` for the checks that apply to the site.
