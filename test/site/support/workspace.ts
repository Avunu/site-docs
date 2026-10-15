// A workspace for the site tests: the real workspace build (registry, stage, lint, nav, the pages of
// each project from the templates), stopped before Jx runs so that a test runs the pinned Jx itself
// and reads what it wrote. Nothing is stood in for: the root a test builds is the root a real build
// builds.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildWorkspace } from "../../../src/workspace/build.js";
import type { NavData, Problem } from "../../../src/lib/types.js";
import { DOCS_FIXTURE } from "./fixtures.js";

export interface ProjectSpec {
  path: string;
  slug: string;
  name: string;
  tagline: string;
  platform: "frappe" | "odoo" | "wordpress" | "nixos" | "general";
  /** `https://github.com/<owner>/<repo>` */
  repo: string;
  license: string;
  branch: string;
  /** The Markdown folder inside the repository (default `docs`). */
  docs?: string;
  /** More Markdown, by path below the Markdown folder. */
  extraDocs?: Record<string, string>;
}

export interface WorkspaceSpec {
  domain: string;
  name: string;
  tagline: string;
  org: string;
  projects: ProjectSpec[];
}

export interface Assembled {
  /** The folder with projects.json. */
  dir: string;
  /** The Jx project root, `<dir>/.docusystem/site`. */
  jxRoot: string;
  /** The problems the build up to Jx collected. */
  problems: Problem[];
  /** The sidebar data of each project, by path, as the layouts read it. */
  navs: Record<string, NavData>;
}

/** The workspace of the site tests: two projects that differ in everything a page can show. */
export const WORKSPACE: WorkspaceSpec = {
  domain: "docs.example.org",
  name: "Example documentation",
  tagline: "Documentation for the example projects.",
  org: "https://github.com/Example",
  projects: [
    {
      path: "example",
      slug: "example",
      name: "Example Project",
      tagline: "A fixture that stands in for a project.",
      platform: "general",
      repo: "https://github.com/Avunu/example",
      license: "MIT",
      branch: "main",
    },
    {
      // Another project: its own name, repository, branch, platform, license and Markdown folder.
      path: "other",
      slug: "other",
      name: "Other Project",
      tagline: "Another fixture, on another platform.",
      platform: "odoo",
      repo: "https://github.com/Avunu/other",
      license: "Apache-2.0",
      branch: "trunk",
      docs: "documentation/user",
    },
  ],
};

const writeText = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** Writes the workspace into `dir` (the docs fixture in every project) and assembles the Jx root. */
export async function assembleWorkspace(
  dir: string,
  spec: WorkspaceSpec = WORKSPACE,
): Promise<Assembled> {
  const projects = [...spec.projects].sort((a, b) => (a.path < b.path ? -1 : 1));
  writeText(
    join(dir, "projects.json"),
    `${JSON.stringify(
      {
        domain: spec.domain,
        name: spec.name,
        tagline: spec.tagline,
        org: spec.org,
        projects: projects.map(({ extraDocs: _extra, ...project }) => ({
          ...project,
          docs: project.docs ?? "docs",
        })),
      },
      null,
      2,
    )}\n`,
  );
  for (const project of projects) {
    const docs = join(dir, "projects", project.path, ...(project.docs ?? "docs").split("/"));
    cpSync(DOCS_FIXTURE, docs, { recursive: true });
    for (const [path, text] of Object.entries(project.extraDocs ?? {})) {
      writeText(join(docs, ...path.split("/")), text);
    }
  }
  const lines: string[] = [];
  const result = await buildWorkspace({
    root: dir,
    env: {},
    strict: true,
    stopAfterNav: true,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  if (!result.ok || result.jxRoot === undefined) {
    throw new Error(`the workspace did not assemble:\n${lines.join("\n")}`);
  }
  const navs = Object.fromEntries(
    projects.map((project) => [
      project.path,
      JSON.parse(
        readFileSync(join(result.jxRoot!, ".generated", "nav", `${project.path}.json`), "utf8"),
      ) as NavData,
    ]),
  );
  return { dir, jxRoot: result.jxRoot, problems: result.problems, navs };
}
