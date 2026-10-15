// The generated `project.json` of the Jx project root.
//
// Jx has no project-level composition (`project.json` has no `extends`), so the project is the
// repository's `site/project.base.json` with the site's identity written into it: `name`, `url` and the
// strictness of the link check (`content.docs.links`). The pages and components are copied beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./package-info.js";
import type { SiteConfig } from "./types.js";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The repository's own `site/` folder: the Jx project files that the whole site is made from. */
export const packageSiteDir = (): string => join(packageRoot, "site");

/** `site/project.base.json` (or the one in `siteSource`, for tests). */
export function readBaseProject(siteSource: string = packageSiteDir()): Record<string, unknown> {
  const file = join(siteSource, "project.base.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${file}: ${(error as Error).message}`, { cause: error });
  }
  if (!isObject(parsed)) throw new Error(`${file} is not a JSON object`);
  return parsed;
}

/** Sets `content.docs.links` when the project has a `docs` content type. */
function setLinks(project: Json, mode: "error" | "warn"): void {
  const content = project.content;
  const docs = isObject(content) ? content.docs : undefined;
  if (isObject(docs)) docs.links = mode;
}

/**
 * The generated `project.json`: the base (without `$schema` and `$comment`, which describe the file in
 * the repository) + `name` + `url` + `content.docs.links` by strictness (`"error"` makes Jx itself fail
 * on every broken link, even when the build runs with `--lenient`, which is why it follows the
 * strictness).
 */
export function generateProject(
  config: Pick<SiteConfig, "name" | "domain">,
  o: { strict: boolean; base?: Record<string, unknown> },
): Record<string, unknown> {
  const project: Json = structuredClone(o.base ?? readBaseProject());
  delete project.$schema;
  delete project.$comment;
  project.name = config.name;
  project.url = `https://${config.domain}`;
  setLinks(project, o.strict ? "error" : "warn");
  return project;
}
