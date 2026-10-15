// The documentation fixture of the site tests: test/site/fixtures/docs, and what each file of it must
// become. The table is the contract between three parties that each compute it on their own: the
// `docs` content type of project.base.json (Jx), the helpers of docs.ts and the sidebar of nav.ts.
// Routes are those of one project's documentation, below its prefix: `/docs/guides/` is
// `/example/docs/guides/` in the project `example`.
import { join } from "node:path";
import { SITE_FIXTURES } from "./site.js";

/** The folder that stands in for a project's `docs/`. */
export const DOCS_FIXTURE: string = join(SITE_FIXTURES, "docs");

export type DocFixture =
  | { file: string; route: string }
  | { file: string; route?: undefined; left: string };

/** Every file of DOCS_FIXTURE: the route it is published at (below the prefix), or why it is left out. */
export const DOC_FIXTURES: readonly DocFixture[] = [
  { file: "README.md", route: "/docs/" },
  { file: "faq/general.md", route: "/docs/faq/general/" },
  { file: "faq/readme.md", route: "/docs/faq/" },
  { file: "getting-started.md", route: "/docs/getting-started/" },
  { file: "guides/Configuration Options.md", route: "/docs/guides/configuration-options/" },
  { file: "guides/README.md", route: "/docs/guides/" },
  { file: "guides/install.md", route: "/docs/guides/install/" },
  { file: "reference/advanced/index.md", route: "/docs/reference/advanced/" },
  { file: "reference/advanced/internals.md", route: "/docs/reference/advanced/internals/" },
  { file: "reference/api.md", route: "/docs/reference/api/" },
  { file: "_partials/footer.md", left: "a folder whose name starts with _" },
  { file: "_private.md", left: "a file whose name starts with _" },
  { file: ".hidden/secret.md", left: "a folder whose name starts with a dot" },
  { file: "draft.md", left: "draft: true" },
  { file: "unpublished.md", left: "publish: false" },
];

/** The routes of one project's documentation, below its prefix, sorted. */
export const DOC_ROUTES: string[] = DOC_FIXTURES.flatMap((f) => (f.route ? [f.route] : [])).sort();

/** The routes of the documentation of the project at `path`: `/<path>/docs/...`. */
export const routesOf = (path: string): string[] => DOC_ROUTES.map((route) => `/${path}${route}`);
