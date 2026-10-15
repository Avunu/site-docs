// The pages of each project, made from two templates of the shell.
//
// One Jx project holds every project's documentation. A project's pages are the same two files with
// its own entries named in them: the landing page (`/<path>/`) and the catch-all for its documentation
// (`/<path>/*`, which Jx fits to exactly the entries whose address starts with `/<path>/`). Each file
// names the project's `config` and `nav` entry in its own state, which overrides the layout's default
// (the workspace's own entry), so the layout and every component read the right project without a
// computed id (a ContentEntry id has to be a literal or a route parameter: Jx does not resolve one
// computed from state at build time).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceProject } from "./registry.js";

/** What a template writes where the project's path goes. */
export const PATH_TOKEN = "@@PATH@@";

/** The templates of the shell, relative to the project root (`site/templates/` in the repository). */
export const TEMPLATES = {
  index: "templates/project-index.json",
  docs: "templates/project-docs.json",
} as const;

/** A template with the project's path in it; throws when the template has no place for it. */
export function renderTemplate(
  template: string,
  project: Pick<WorkspaceProject, "path">,
  name: string,
): string {
  if (!template.includes(PATH_TOKEN)) {
    throw new Error(`${name} does not contain ${PATH_TOKEN}: it names no project's entry`);
  }
  const out = template.replaceAll(PATH_TOKEN, project.path);
  if (out.includes("@@")) {
    const left = /@@[A-Z_]+@@/.exec(out)?.[0] ?? "@@";
    throw new Error(`${name} still contains ${left} after the project's path was put in`);
  }
  return out;
}

/** Writes `pages/<path>/index.json` and `pages/<path>/[...path].json` for every project. Returns the files. */
export function writeProjectPages(root: string, projects: readonly WorkspaceProject[]): string[] {
  const index = readFileSync(join(root, ...TEMPLATES.index.split("/")), "utf8");
  const docs = readFileSync(join(root, ...TEMPLATES.docs.split("/")), "utf8");
  const written: string[] = [];
  for (const project of projects) {
    const dir = join(root, "pages", project.path);
    mkdirSync(dir, { recursive: true });
    const files: Array<[string, string]> = [
      ["index.json", renderTemplate(index, project, TEMPLATES.index)],
      ["[...path].json", renderTemplate(docs, project, TEMPLATES.docs)],
    ];
    for (const [name, text] of files) {
      writeFileSync(join(dir, name), text);
      written.push(`pages/${project.path}/${name}`);
    }
  }
  return written;
}
