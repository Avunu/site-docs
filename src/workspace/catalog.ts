// The project catalog the switcher is rendered from, for the one site. The bundled snapshot of the
// avunu.net catalog says which projects exist (26 of them, most without documentation); the registry
// says which have documentation here and where, so those entries get their `docs` address and the
// projects the snapshot does not know yet are added.
import type { Catalog, CatalogProject } from "../lib/types.js";
import type { Workspace } from "./registry.js";

/** The address of a project's documentation on the site: `https://docs.avunu.net/frappe-nix/`. */
export const docsUrl = (ws: Pick<Workspace, "domain">, path: string): string =>
  `https://${ws.domain}/${path}/`;

export function workspaceCatalog(base: Catalog, ws: Workspace, generated: string): Catalog {
  const bySlug = new Map(base.projects.map((project) => [project.slug, project]));
  const projects: CatalogProject[] = base.projects.map((project) => ({ ...project, docs: null }));
  const known = new Map(projects.map((project) => [project.slug, project]));
  for (const entry of ws.projects) {
    const docs = docsUrl(ws, entry.path);
    const existing = known.get(entry.slug);
    if (existing !== undefined) {
      existing.docs = docs;
      continue;
    }
    // A project that renames before the avunu.net catalog knows its new name: it still has a page.
    const origin = bySlug.get(entry.slug);
    projects.push({
      slug: entry.slug,
      title: entry.name,
      platform: entry.platform,
      summary: entry.tagline,
      repo: entry.repo,
      page: origin?.page ?? `${base.site}/open-source/${entry.slug}/`,
      docs,
      license: entry.license,
      status: "active",
      suite: null,
    });
  }
  projects.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { ...base, generated, projects };
}
