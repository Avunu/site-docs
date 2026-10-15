// The site assets built by the real, pinned Jx: a workspace of two projects is assembled by the real
// workspace build (registry, stage, lint, nav, the pages of each project made from the templates of
// site/), the released Jx compiler builds it, and what comes out is read as a browser, a search
// engine and a screen reader would: `Done: N routes` with N as expected, and a header, a sidebar and
// callouts that are already in the HTML. The two projects differ in everything a page can show
// (name, platform, repository, branch, license, Markdown folder), so a page that reads the wrong
// project's entry, or a sidebar that lists the other project's pages, fails here.
//
// Only Jx runs here: what the build does to the output afterwards (canonical addresses, the sitemap,
// the 404 page's place) is tested with the postbuild, and the whole thing by test/integration.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { REPO_ROOT } from "../support/index.js";
import { DOC_FIXTURES, DOC_ROUTES, routesOf } from "./support/fixtures.js";
import { distOf, filesUnder, jxVersions, readDist, runJx, type JxRun } from "./support/root.js";
import { COMPONENTS, JX_PACKAGES, PAGES, PROJECT, readJson, readText } from "./support/site.js";
import {
  assembleWorkspace,
  WORKSPACE,
  type Assembled,
  type WorkspaceSpec,
} from "./support/workspace.js";

/** A line of Jx output that the build's strict mode treats as a problem. */
const PROBLEM = /^(?:Content\b|Warning:|Error)/;

interface Built extends Assembled {
  run: JxRun;
  /** `/`-separated paths of every file of dist/. */
  files: string[];
  /** The text of every .html file of dist/, by path. */
  pages: Record<string, string>;
}

const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "docs-site-")));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Assembles the workspace, adds `staged` (files of the root, by path) and runs Jx on it. */
async function build(
  name: string,
  spec: WorkspaceSpec = WORKSPACE,
  staged: Record<string, string> = {},
): Promise<Built> {
  const assembled = await assembleWorkspace(join(work, name), spec);
  for (const [path, text] of Object.entries(staged)) {
    const file = join(assembled.jxRoot, ...path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const run = runJx(assembled.jxRoot);
  const files = filesUnder(distOf(assembled.jxRoot));
  const pages = Object.fromEntries(
    files.filter((f) => f.endsWith(".html")).map((f) => [f, readDist(assembled.jxRoot, f)]),
  );
  return { ...assembled, run, files, pages };
}

const EXAMPLE = WORKSPACE.projects.find((p) => p.path === "example")!;
const OTHER = WORKSPACE.projects.find((p) => p.path === "other")!;
const PATHS = WORKSPACE.projects.map((p) => p.path);
/** Every documentation route of every project. */
const ALL_DOC_ROUTES = PATHS.flatMap((path) => routesOf(path)).sort();

let main: Built;

beforeAll(async () => {
  // Strict like CI (`links: "error"`), with a `node_modules` folder in the staged documentation of
  // `example`: the stage never copies one, so it is put there by hand, and the `exclude` rule of the
  // docs content type must keep it out of the site all the same.
  main = await build("main", WORKSPACE, {
    ".generated/docs/example/docs/node_modules/pkg/README.md":
      "---\ntitle: Vendored\n---\n\nNot a page.\n",
  });
}, 120_000);

// ── helpers to read the HTML ────────────────────────────────────────────────────────────────────
/** The page without its stylesheets and scripts, which carry words that are not content. */
const content = (html: string): string =>
  html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "");
const decode = (text: string): string =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
const count = (html: string, pattern: RegExp): number => (html.match(pattern) ?? []).length;
/** The `data-jx-props` of the first element with this tag, parsed. */
function propsOf(html: string, tag: string): any {
  const match = new RegExp(`<${tag}\\b[^>]*data-jx-props="([^"]*)"`).exec(html);
  expect(match, `<${tag}> has no data-jx-props`).not.toBeNull();
  return JSON.parse(decode(match![1]!));
}
const pageOf = (built: Built, route: string): string => {
  const html = built.pages[`${route.slice(1)}index.html`];
  expect(html, `no page for ${route}`).toBeDefined();
  return html!;
};
/** The route of a file of dist/: `example/docs/index.html` is `/example/docs/`. */
const routeOf = (file: string): string => `/${file.replace(/index\.html$/, "")}`;

describe("the build", () => {
  test("runs the released Jx the package pins, exactly", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const pins = Object.fromEntries(
      Object.entries(manifest.dependencies).filter(([name]) => name.startsWith("@jxsuite/")),
    );
    expect(Object.keys(pins).sort()).toEqual([...JX_PACKAGES].sort());
    expect(jxVersions()).toEqual(pins);
  });

  test("succeeds in strict mode (links: error) and prints no line of a document problem", () => {
    expect(main.run.status, main.run.output).toBe(0);
    expect(main.run.output.split("\n").filter((line) => PROBLEM.test(line))).toEqual([]);
    // What the build found before Jx: nothing wrong with the fixture, in either project.
    expect(main.problems.filter((p) => p.level === "error")).toEqual([]);
  });

  test("reports `Done: N routes`: the site's own pages, and for every project a landing page and its documents", () => {
    expect(PAGES).toEqual(["pages/404.json", "pages/index.json"]);
    for (const path of PATHS) {
      expect(Object.keys(main.navs[path]!.pages).sort(), path).toEqual(routesOf(path));
    }
    expect(main.run.routes).toBe(PAGES.length + PATHS.length * (1 + DOC_ROUTES.length));
    expect(main.run.routes).toBe(24);
  });

  test("publishes the routes of the docs content type of each project, and only those", () => {
    for (const path of PATHS) {
      const published = Object.keys(main.pages)
        .filter((file) => file.startsWith(`${path}/docs/`))
        .map(routeOf)
        .sort();
      expect(published, path).toEqual(routesOf(path));
    }
    expect(Object.keys(main.pages).sort()).toEqual(
      [
        "404/index.html",
        "index.html",
        ...PATHS.map((path) => `${path}/index.html`),
        ...ALL_DOC_ROUTES.map((route) => `${route.slice(1)}index.html`),
      ].sort(),
    );
  });

  test("leaves out underscore and dot paths, node_modules, drafts and pages with publish: false", () => {
    expect(DOC_FIXTURES.filter((f) => f.route === undefined)).toHaveLength(5);
    // Nothing is written under a project's docs/ but its published routes (a page and its Markdown copy)...
    for (const path of PATHS) {
      const written = new Set(
        main.files
          .filter((f) => f.startsWith(`${path}/docs/`))
          .map((f) => `/${f.replace(/[^/]+$/, "")}`),
      );
      expect([...written].sort(), path).toEqual(routesOf(path));
    }
    // ...and no word of a left-out file reaches the search index.
    const index = readDist(main.jxRoot, "search-index.json");
    for (const word of ["Private", "Vendored", "Draft", "Unpublished", "Not a page", "footer.md"]) {
      expect(index, word).not.toContain(word);
    }
    // Every published page of every project is in the one search index, at its own address; nothing else is.
    const documents = JSON.parse(index).documents as Array<{ url: string }>;
    const urls = new Set(documents.map((d) => d.url.split("#")[0]));
    expect([...urls].sort()).toEqual(ALL_DOC_ROUTES);
  });

  test("names the three index spellings (README.md, readme.md, index.md) as the page of their folder", () => {
    for (const path of PATHS) {
      for (const route of ["/docs/", "/docs/guides/", "/docs/faq/", "/docs/reference/advanced/"]) {
        expect(main.pages[`${path}${route}index.html`], `${path}${route}`).toBeDefined();
      }
      // A file name with capitals and a space becomes a slug.
      expect(main.pages[`${path}/docs/guides/configuration-options/index.html`]).toBeDefined();
    }
  });

  test("emits every component as components/<tag>.js (and its stylesheet) and leaves no custom element empty", () => {
    for (const file of COMPONENTS) {
      const tag = String(readJson(file).tagName);
      expect(main.files, tag).toContain(`components/${tag}.js`);
    }
    for (const [page, html] of Object.entries(main.pages)) {
      for (const file of COMPONENTS) {
        const tag = String(readJson(file).tagName);
        expect(html, `${page}: <${tag}> is empty`).not.toMatch(
          new RegExp(`<${tag}\\b[^>]*>\\s*</${tag}>`),
        );
      }
    }
  });

  test("evaluates every compiler-timed value: no template text, and no project token, is left in any page", () => {
    for (const [page, html] of Object.entries(main.pages)) {
      expect(content(html), page).not.toContain("${"); // includes `${state`: a value that was not computed
      expect(html, page).not.toContain("@@PATH@@");
    }
  });

  test("a page has exactly one h1: the documents, the landing pages and the 404 page", () => {
    for (const [page, html] of Object.entries(main.pages)) {
      expect(count(content(html), /<h1[\s>]/g), page).toBe(1);
    }
    for (const path of PATHS) {
      // getting-started.md has one `# Getting started` that says the title: it is that h1, with its anchor.
      expect(pageOf(main, `/${path}/docs/getting-started/`)).toContain(
        '<h1 id="getting-started">Getting started</h1>',
      );
      // README.md has none: the h1 is written from the title. guides/install.md has two: one is demoted.
      expect(pageOf(main, `/${path}/docs/`)).toContain("Example Project documentation</h1>");
      expect(content(pageOf(main, `/${path}/docs/guides/install/`))).toContain(
        '<h2 id="a-second-top-level-heading">A second top-level heading</h2>',
      );
    }
  });
});

describe("the header, already in the HTML", () => {
  /** The name in the header and where it links. */
  const nameLink = (html: string): { href: string; text: string } => {
    const match = /<a class="name" href="([^"]*)">([^<]*)<\/a>/.exec(html);
    expect(match, "no project name in the header").not.toBeNull();
    return { href: match![1]!, text: decode(match![2]!) };
  };

  test("names the project on its pages, and the site on the pages that belong to no project", () => {
    for (const project of WORKSPACE.projects) {
      for (const route of ["/", "/docs/", "/docs/guides/install/"]) {
        const html = pageOf(main, `/${project.path}${route}`);
        const { href, text } = nameLink(html);
        expect(text, route).toBe(project.name);
        expect(href, `${project.path}${route}`).toBe(`/${project.path}/`);
        expect(html, route).toContain('aria-label="Avunu, go to avunu.net"');
        expect(html, route).toContain('<a class="skip-link" href="#main">Skip to content</a>');
      }
    }
    for (const route of ["/", "/404/"]) {
      const html = pageOf(main, route);
      expect(nameLink(html), route).toEqual({ href: "/", text: WORKSPACE.name });
      expect(html, route).toContain('aria-label="Avunu, go to avunu.net"');
    }
  });

  test("holds the search, the theme toggle and the project switcher, rendered from the catalog", () => {
    const html = pageOf(main, "/example/docs/");
    expect(html).toContain("<docs-search");
    expect(html).toContain("<theme-toggle");
    const snapshot = JSON.parse(readText("data/projects.snapshot.json")) as {
      projects: Array<{ slug: string }>;
    };
    const switcher = propsOf(html, "project-switcher") as {
      current: string;
      groups: Array<{ platform: string; label: string; items: Array<Record<string, unknown>> }>;
    };
    expect(switcher.current).toBe("example");
    expect(switcher.groups.map((g) => g.platform)).toEqual([
      "frappe",
      "odoo",
      "wordpress",
      "nixos",
      "general",
    ]);
    expect(switcher.groups.map((g) => g.label)).toEqual([
      "Frappe & ERPNext",
      "Odoo",
      "WordPress",
      "NixOS",
      "General",
    ]);
    // The bundled catalog, and the registry's projects (that the catalog may not know yet) added to it.
    const items = switcher.groups.flatMap((g) => g.items);
    expect(items.map((i) => i.slug).sort()).toEqual(
      [...new Set([...snapshot.projects.map((p) => p.slug), "example", "other"])].sort(),
    );
    // A project of this site links to its own landing page here; one that is not links to avunu.net.
    expect(items.find((i) => i.slug === "other")).toMatchObject({
      href: "https://docs.example.org/other/",
      caption: "Docs",
    });
    expect(items.find((i) => i.slug === "frappe-nix")).toMatchObject({
      href: "https://avunu.net/open-source/frappe-nix/",
      caption: "avunu.net",
    });
  });

  test("the switcher marks exactly the project of the page, and nobody on a page of no project", () => {
    for (const project of WORKSPACE.projects) {
      for (const route of ["/", "/docs/", "/docs/guides/install/"]) {
        const switcher = propsOf(pageOf(main, `/${project.path}${route}`), "project-switcher") as {
          current: string;
          groups: Array<{ items: Array<Record<string, unknown>> }>;
        };
        expect(switcher.current).toBe(project.slug);
        expect(switcher.groups.flatMap((g) => g.items).filter((i) => i.current)).toEqual([
          expect.objectContaining({
            slug: project.slug,
            href: `https://docs.example.org/${project.path}/`,
            caption: "You are here",
          }),
        ]);
      }
    }
    for (const route of ["/", "/404/"]) {
      const switcher = propsOf(pageOf(main, route), "project-switcher") as {
        groups: Array<{ items: Array<{ current: boolean }> }>;
      };
      expect(
        switcher.groups.flatMap((g) => g.items).filter((i) => i.current),
        route,
      ).toEqual([]);
    }
  });

  test("the search is told the quick links of the project's own documentation", () => {
    for (const path of PATHS) {
      const search = propsOf(pageOf(main, `/${path}/docs/`), "docs-search") as {
        links: Array<{ href: string }>;
      };
      expect(search.links.map((l) => l.href)).toEqual([
        `/${path}/docs/`,
        `/${path}/docs/guides/`,
        `/${path}/docs/faq/`,
        `/${path}/docs/reference/api/`,
      ]);
    }
  });
});

describe("the sidebar and the drawer, already in the HTML", () => {
  const links = (html: string, tag: string): Array<{ href: string; current: string }> =>
    [
      ...(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "g").exec(html)?.[0] ?? "").matchAll(
        /<a href="([^"]+)" aria-current="(page|false)"/g,
      ),
    ].map((m) => ({ href: m[1]!, current: m[2]! }));

  test("lists every page of the project's nav once, in reading order of the sections, with a group for a folder", () => {
    const html = pageOf(main, "/example/docs/guides/install/");
    const sidebar = links(html, "docs-sidebar");
    expect(sidebar.map((l) => l.href).sort()).toEqual(routesOf("example"));
    expect(html).toContain('<nav aria-label="Documentation">');
    expect(html).toContain("<summary>Guides</summary>");
    expect(html).toContain("<summary>Questions</summary>");
    expect(html).toContain('<details class="group" open><summary>Advanced</summary>');
    // The label of a folder's README is "Overview"; a nav_title is used as it is.
    expect(html).toContain(">Programming interface</a>");
  });

  test("never lists a page of another project: each sidebar and drawer holds its own project's pages", () => {
    for (const project of WORKSPACE.projects) {
      const mine = routesOf(project.path);
      const others = ALL_DOC_ROUTES.filter((route) => !mine.includes(route));
      for (const route of mine) {
        const html = pageOf(main, route);
        for (const sidebar of html.matchAll(/<docs-sidebar\b[\s\S]*?<\/docs-sidebar>/g)) {
          const hrefs = links(sidebar[0], "docs-sidebar").map((l) => l.href);
          expect(hrefs.sort(), route).toEqual(mine);
          expect(
            hrefs.filter((href) => others.includes(href)),
            route,
          ).toEqual([]);
        }
        // Nor does its previous and next link leave the project.
        const pager = [...content(html).matchAll(/<a class="(?:prev|next)" href="([^"]+)"/g)];
        for (const [, href] of pager) {
          expect(href!.startsWith(`/${project.path}/docs/`), route).toBe(true);
        }
      }
    }
  });

  test("marks the current page, and only that one, in the page and in the drawer", () => {
    for (const route of ALL_DOC_ROUTES) {
      const html = pageOf(main, route);
      const sidebars = [...html.matchAll(/<docs-sidebar\b[\s\S]*?<\/docs-sidebar>/g)].map(
        (m) => m[0],
      );
      expect(sidebars, route).toHaveLength(2); // the one beside the page and the one in the drawer
      for (const sidebar of sidebars) {
        const current = links(sidebar, "docs-sidebar").filter((l) => l.current === "page");
        expect(current, route).toEqual([{ href: route, current: "page" }]);
      }
    }
  });

  test("opens every section when the site is small (the nav says expandAll)", () => {
    for (const path of PATHS) {
      const nav = main.navs[path]!;
      expect(nav.expandAll, path).toBe(true);
      const html = pageOf(main, `/${path}/docs/`);
      expect(count(html, /<details class="section" open>/g), path).toBe(2 * nav.sections.length);
    }
  });

  test("has a drawer that is a popover with a close button, for narrow screens", () => {
    const html = pageOf(main, "/example/docs/");
    expect(html).toContain('<div id="docs-drawer" class="drawer" popover="auto" role="dialog"');
    expect(html).toContain('popovertarget="docs-drawer"');
    expect(html).toContain('class="drawer-close"');
  });

  test("the landing pages have no sidebar", () => {
    for (const route of ["/", "/example/", "/other/", "/404/"]) {
      expect(pageOf(main, route), route).not.toContain("<docs-sidebar");
    }
  });
});

describe("the page, already in the HTML", () => {
  test("renders GitHub alerts as callouts of the five kinds, and no alert marker is left", () => {
    const kinds = new Set<string>();
    for (const route of ALL_DOC_ROUTES) {
      const html = content(pageOf(main, route));
      for (const m of html.matchAll(/<docs-callout data-alert="(\w+)"/g)) kinds.add(m[1]!);
      expect(html, route).not.toMatch(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/);
    }
    expect([...kinds].sort()).toEqual(["caution", "important", "note", "tip", "warning"]);
    const tip = content(pageOf(main, "/example/docs/getting-started/"));
    expect(tip).toMatch(
      /<docs-callout data-alert="tip"[^>]*>[\s\S]*?<div class="body" role="note">/,
    );
    expect(tip).toContain("that introduces them.</p></div></docs-callout>");
  });

  test("highlights code, keeps tables, and builds the table of contents from the headings", () => {
    const html = content(pageOf(main, "/example/docs/getting-started/"));
    expect(html).toContain('<code class="language-bash shiki">');
    expect(html).toContain("<table><thead>");
    expect(html).toContain('<a href="#requirements" class="d2">Requirements</a>');
    expect(html).toContain('<a href="#troubleshooting" class="d2">Troubleshooting</a>');
    expect(html).toContain('<a class="top-link" href="#main">Back to top');
  });

  test("shows the date and the tags of a page that has them, and hides the empty rows of one that has none", () => {
    const html = content(pageOf(main, "/other/docs/getting-started/"));
    expect(html).toContain('<time datetime="2026-10-01">2026-10-01</time>');
    expect(html).toContain("<li>install</li>");
    expect(html).toContain("<li>quick-start</li>");
    expect(content(pageOf(main, "/other/docs/guides/install/"))).toContain(
      '<div class="meta" hidden>',
    );
  });

  test("links the previous and next page from the project's own nav", () => {
    for (const path of PATHS) {
      const html = content(pageOf(main, `/${path}/docs/guides/install/`));
      expect(html).toContain(`<a class="prev" href="/${path}/docs/guides/">`);
      expect(html).toContain(`<a class="next" href="/${path}/docs/guides/configuration-options/">`);
      // The first page has no previous and the last has no next: the link is there, hidden and empty.
      const flat = main.navs[path]!.flat;
      const first = pageOf(main, flat[0]!.url);
      const last = pageOf(main, flat.at(-1)!.url);
      expect(first).toContain('<a class="prev" href="" hidden>');
      expect(first).toContain(`<a class="next" href="${flat[1]!.url}">`);
      expect(last).toContain('<a class="next" href="" hidden>');
      expect(last).toContain(`<a class="prev" href="${flat.at(-2)!.url}">`);
    }
  });

  test("resolves links between pages, with a space in a file name and an anchor, to page URLs of the project", () => {
    for (const path of PATHS) {
      const html = content(pageOf(main, `/${path}/docs/getting-started/`));
      expect(html).toContain(`href="/${path}/docs/guides/configuration-options/#options"`);
      expect(content(pageOf(main, `/${path}/docs/`))).toContain(
        `href="/${path}/docs/guides/install/"`,
      );
    }
  });

  test("links Edit this page to the repository, branch and docs folder of the page's own project", () => {
    expect(pageOf(main, "/example/docs/guides/install/")).toContain(
      `href="${EXAMPLE.repo}/edit/${EXAMPLE.branch}/docs/guides/install.md"`,
    );
    expect(pageOf(main, "/example/docs/guides/configuration-options/")).toContain(
      `href="${EXAMPLE.repo}/edit/${EXAMPLE.branch}/docs/guides/Configuration%20Options.md"`,
    );
    expect(pageOf(main, "/example/docs/")).toContain(
      `href="${EXAMPLE.repo}/edit/${EXAMPLE.branch}/docs/README.md"`,
    );
    // A project whose Markdown is not in docs/, on another branch, gets links that reach the files.
    expect(pageOf(main, "/other/docs/guides/install/")).toContain(
      `href="${OTHER.repo}/edit/trunk/documentation/user/guides/install.md"`,
    );
    expect(pageOf(main, "/other/docs/")).toContain(
      `href="${OTHER.repo}/edit/trunk/documentation/user/README.md"`,
    );
    // Neither project's page points at the other's repository, or into the other's folder.
    for (const route of routesOf("example")) {
      expect(pageOf(main, route), route).not.toContain(`${OTHER.repo}/edit/`);
    }
    for (const route of routesOf("other")) {
      expect(pageOf(main, route), route).not.toContain(`${EXAMPLE.repo}/edit/`);
      expect(pageOf(main, route), route).not.toContain("/edit/trunk/docs/");
    }
  });

  test("sets the title, the description and the social tags from the document and the page's own project", () => {
    const html = pageOf(main, "/example/docs/getting-started/");
    expect(html).toContain("<title>Getting started · Example Project</title>");
    expect(html).toContain(
      '<meta name="description" content="Install the example project and run it for the first time.">',
    );
    expect(html).toContain(
      '<meta property="og:title" content="Getting started · Example Project">',
    );
    expect(html).toContain(
      '<meta name="twitter:title" content="Getting started · Example Project">',
    );
    expect(html).toContain(
      '<meta content="https://docs.example.org/example/docs/getting-started" property="og:url">',
    );
    // The site is one site: its name is the site's, whichever project the page documents.
    expect(html).toContain(`<meta content="${WORKSPACE.name}" property="og:site_name">`);
    expect(pageOf(main, "/example/docs/")).toContain(
      "<title>Example Project documentation · Example Project</title>",
    );
    expect(html).toContain('<html lang="en">');
    // The same document in the other project says the other project's name.
    const other = pageOf(main, "/other/docs/getting-started/");
    expect(other).toContain("<title>Getting started · Other Project</title>");
    expect(other).toContain('<meta property="og:title" content="Getting started · Other Project">');
    expect(other).toContain(
      '<meta content="https://docs.example.org/other/docs/getting-started" property="og:url">',
    );
    expect(other).not.toContain("Example Project</title>");
  });

  test("gives every page a canonical address on the site's domain, in its own project", () => {
    for (const [file, html] of Object.entries(main.pages)) {
      const canonical = /<link href="([^"]+)" rel="canonical">/.exec(html)?.[1];
      expect(canonical, file).toBeDefined();
      // Jx writes it without the trailing slash; the build corrects that afterwards.
      expect(canonical!.replace(/\/$/, ""), file).toBe(
        `https://${WORKSPACE.domain}${routeOf(file).replace(/\/$/, "")}`,
      );
    }
  });
});

describe("the landing pages and the 404 page", () => {
  test("a project's landing page names the project, says what it is and offers its documentation and its repository", () => {
    for (const project of WORKSPACE.projects) {
      const html = content(pageOf(main, `/${project.path}/`));
      expect(html).toContain(`<h1 id="home-title">${project.name}</h1>`);
      expect(html).toContain(`<p class="lede">${project.tagline}</p>`);
      expect(html).toContain(
        `<a class="btn primary" href="/${project.path}/docs/">Read the documentation`,
      );
      expect(html).toContain(`<a class="btn secondary" href="${project.repo}">`);
      expect(html).toContain("<li><b>License </b>");
      expect(html).toContain(`<span>${project.license}</span>`);
    }
    const platform = (path: string, label: string) => {
      const html = content(pageOf(main, `/${path}/`));
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).toContain(`Open source · ${label}`);
    };
    platform("example", "General");
    platform("other", "Odoo");
  });

  test("a project's landing page shows the first pages of its own nav as cards", () => {
    for (const path of PATHS) {
      const html = content(pageOf(main, `/${path}/`));
      const cards = [...html.matchAll(/<a class="card" href="([^"]+)">/g)].map((m) => m[1]);
      const nav = main.navs[path]!;
      expect(cards).toEqual(nav.featured.map((f) => f.url));
      expect(nav.featured.length).toBeGreaterThan(0);
      expect(cards.every((href) => href!.startsWith(`/${path}/docs/`))).toBe(true);
    }
  });

  test("the site's landing page names the site and lists every project that has documentation, by platform", () => {
    const html = content(pageOf(main, "/"));
    expect(html).toContain(`<h1 id="home-title">${WORKSPACE.name}</h1>`);
    expect(html).toContain(`<p class="lede">${WORKSPACE.tagline}</p>`);
    expect(html).toContain(`<a class="btn secondary" href="${WORKSPACE.org}">`);
    // Groups in the fixed order of the platforms, a project's card in its platform's group.
    const groups = [...html.matchAll(/<h2 id="group-(\w+)">([^<]*)<\/h2>/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(groups).toEqual([
      ["odoo", "Odoo"],
      ["general", "General"],
    ]);
    const cards = [...html.matchAll(/<a class="card" href="([^"]+)">/g)].map((m) => m[1]);
    expect(cards).toEqual(["/other/", "/example/"]);
    expect(html).toContain('<span class="t">Other Project</span>');
    expect(html).toContain('<span class="k">Apache-2.0</span>');
    expect(html).toContain(`<span class="d">${EXAMPLE.tagline}</span>`);
    // Only the projects of this site have a card: the bundled catalog's other projects are not listed.
    expect(cards).toHaveLength(PATHS.length);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
  });

  test("the 404 page says so and offers a way back to the site", () => {
    const html = content(pageOf(main, "/404/"));
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain('<a class="btn" href="/">Browse the documentation</a>');
    expect(html).toContain(
      '<a class="btn secondary" href="https://avunu.net/">Back to avunu.net</a>',
    );
  });

  test("every page has the footer with its project's license (the site's, off a project) and the Avunu mark", () => {
    for (const [page, html] of Object.entries(main.pages)) {
      const project = WORKSPACE.projects.find((p) => page.startsWith(`${p.path}/`));
      const name = project?.name ?? WORKSPACE.name;
      const license = project?.license ?? "MIT";
      expect(html, page).toContain("<docs-footer");
      expect(content(html), page).toContain(`${name} is released under the ${license} license.`);
      expect(html, page).toContain('src="/brand/avunu-logo-light.svg"');
    }
  });
});

describe("the files Jx publishes next to the pages", () => {
  test("copies public/: fonts with their licenses, marks, favicons, .nojekyll and the one CNAME of the site", () => {
    for (const file of [
      ".nojekyll",
      "CNAME",
      "favicon.svg",
      "favicon.ico",
      "brand/avunu-icon.svg",
      "brand/avunu-logo-light.svg",
      "fonts/LICENSE-Figtree.txt",
      "fonts/LICENSE-JetBrainsMono.txt",
    ]) {
      expect(main.files, file).toContain(file);
    }
    expect(main.files.filter((f) => /^fonts\/.*\.woff2$/.test(f))).toHaveLength(6);
    // One domain for every project: there is no CNAME per project.
    expect(readDist(main.jxRoot, "CNAME")).toBe(`${WORKSPACE.domain}\n`);
    expect(main.files.filter((f) => f.endsWith("CNAME"))).toEqual(["CNAME"]);
  });

  test("writes the sitemap, robots.txt and the search index for the site's domain", () => {
    expect(readDist(main.jxRoot, "robots.txt")).toContain(
      `Sitemap: https://${WORKSPACE.domain}/sitemap.xml`,
    );
    const sitemap = readDist(main.jxRoot, "sitemap.xml");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs.every((loc) => loc.startsWith(`https://${WORKSPACE.domain}/`))).toBe(true);
    for (const path of PATHS) {
      expect(sitemap).toContain(
        `<loc>https://${WORKSPACE.domain}/${path}/docs/getting-started</loc>`,
      );
    }
    expect(sitemap).toContain(`<loc>https://${WORKSPACE.domain}/</loc>`);
    expect(JSON.parse(readDist(main.jxRoot, "search-index.json")).version).toBe(1);
  });

  test("every font a stylesheet names is in the output, and every font in the output is named", () => {
    const html = pageOf(main, "/");
    const named = new Set(
      [...html.matchAll(/url\("\/(fonts\/[\w-]+\.woff2)"\)/g)].map((m) => m[1]!),
    );
    expect(named.size).toBe(6);
    const published = main.files.filter((f) => /^fonts\/.*\.woff2$/.test(f));
    expect([...named].sort()).toEqual(published.sort());
    expect(html).toContain(
      '<link rel="preload" href="/fonts/figtree-latin-wght-normal.woff2" as="font"',
    );
    // No page names a font host or any other third-party origin for a resource it loads.
    for (const [page, text] of Object.entries(main.pages)) {
      const loaded = [...text.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
        .map((m) => new URL(m[1]!).hostname)
        .filter((host) => !["avunu.net", "github.com", WORKSPACE.domain].includes(host));
      expect(loaded, page).toEqual([]);
      expect(text, page).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/);
    }
  });
});

describe("light and dark", () => {
  test("every page carries the tokens of both themes, and the stored choice is applied before first paint", () => {
    const html = pageOf(main, "/example/docs/");
    expect(html).toContain(`:root { --color-bg: ${PROJECT.style["--color-bg"]};`);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("data-color-scheme");
    expect(html).toContain('localStorage.getItem("jx-color-scheme")');
    expect(html).toContain(
      '<meta name="theme-color" content="#120F19" media="(prefers-color-scheme: dark)">',
    );
    // The scheme script runs in <head>, before the body, so there is no flash.
    expect(html.indexOf("jx-color-scheme")).toBeLessThan(html.indexOf("<body"));
  });

  test("the theme toggle is a component that is loaded on every page", () => {
    for (const [page, html] of Object.entries(main.pages)) {
      expect(html, page).toContain(
        '<script type="module" src="/components/theme-toggle.js"></script>',
      );
    }
  });
});

describe("a title that holds markup", () => {
  // Jx escapes every text node and attribute it writes except the text of <title>, which it writes
  // as it is: a title with `</title>` in it ended the element and put what followed into the head.
  // The titles of pages come from front matter and from headings (a code span or an entity in a
  // heading is plain text in the title), so both are tried, in one project; the other project, built
  // from the same documents, must come out exactly as it did without them.
  const PAYLOAD = '</title><script>document.documentElement.setAttribute("data-pwn","1")</script>';
  const TITLES: Record<string, string> = {
    "/example/docs/evil-front-matter/": `Evil ${PAYLOAD}`,
    "/example/docs/evil-heading/": `Code ${PAYLOAD} span`,
  };
  let hostile: Built;

  beforeAll(async () => {
    const extraDocs = {
      "evil-front-matter.md": `---\ntitle: '${TITLES["/example/docs/evil-front-matter/"]!.replaceAll("'", "''")}'\n---\n\nBody.\n`,
      "evil-heading.md": `# Code \`${PAYLOAD}\` span\n\nBody.\n`,
    };
    hostile = await build("hostile", {
      ...WORKSPACE,
      projects: WORKSPACE.projects.map((project) =>
        Object.assign({}, project, project.path === "example" ? { extraDocs } : {}),
      ),
    });
  }, 120_000);

  test("is built without a problem", () => {
    expect(hostile.run.status, hostile.run.output).toBe(0);
    expect(hostile.run.output.split("\n").filter((line) => PROBLEM.test(line))).toEqual([]);
  });

  test("is text in <title>: one element, nothing after it, the page's own title around it", () => {
    for (const route of Object.keys(TITLES)) {
      const html = pageOf(hostile, route);
      const head = html.slice(0, html.lastIndexOf("</head>"));
      expect(count(head, /<title>/g), route).toBe(1);
      expect(count(head, /<\/title>/g), route).toBe(1);
      const text = /<title>([\s\S]*?)<\/title>/.exec(head)![1]!;
      expect(text, route).not.toMatch(/[<>]/);
      expect(decode(text), route).toBe(`${TITLES[route]} · Example Project`);
      // no script came out of it, in the head or anywhere else on the page
      expect(html, route).not.toContain(`<script>document.documentElement.setAttribute("data-pwn"`);
    }
  });

  test("is text in the social tags and in the page's h1 as well", () => {
    for (const route of Object.keys(TITLES)) {
      const html = pageOf(hostile, route);
      const og = /<meta property="og:title" content="([^"]*)">/.exec(html)![1]!;
      expect(decode(og), route).toBe(`${TITLES[route]} · Example Project`);
      expect(og, route).not.toContain("<");
      expect(content(html), route).not.toContain("</title><script>");
    }
  });

  test("leaves the other project's pages as they were, byte for byte", () => {
    for (const route of [...routesOf("other"), "/other/"]) {
      expect(pageOf(hostile, route), route).toBe(pageOf(main, route));
    }
  });
});
