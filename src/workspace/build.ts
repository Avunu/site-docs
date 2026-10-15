// `build` of the workspace: every project's documentation, one Jx project, one site.
//
// The steps are the ones a single project's build always had, once per project where the work is
// per project (stage, lint, nav) and once for the site where it is not (assemble, Jx, postbuild,
// assert, publish):
//
//   1 registry   projects.json, and that every project's Markdown is on disk
//   2 assemble   <root>/.site-docs/site: the shell, project.json, the catalog, the project pages
//   3 stage      each project's Markdown, copied to .generated/docs/<path>/docs, repository links rewritten
//   4 lint       each project's Markdown
//   5 nav        each project's sidebar, to .generated/nav/<path>.json, and its entry in .generated/config
//   6 jx         one build of the whole root
//   7 postbuild  canonical links, the sitemap, repository links of the page's own project
//   8 assert     what the output must be (assert.ts)
//   9 publish    <root>/dist, replaced only when everything above passed
//
// Problems are collected, not thrown, until the end of step 6; what a document problem is and how
// strictness changes it is in strict.ts.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertBuild } from "../lib/assert.js";
import { annotation } from "../lib/ci.js";
import { copyFile, ensureRealDir, removeInside, replaceDir, writeJson } from "../lib/fsutil.js";
import { jxCli, linkJxPackages } from "../lib/jx.js";
import { formatIssue, lintDocs } from "../lib/lint.js";
import { writeNav } from "../lib/nav.js";
import { runPostbuild } from "../lib/postbuild.js";
import { generateProject, packageSiteDir, readBaseProject } from "../lib/project.js";
import { spawnCommand } from "../lib/spawn.js";
import { stageSite } from "../lib/stage.js";
import {
  assertionFailure,
  doneRoutes,
  expectedRoutes,
  failureProblems,
  imageHint,
  isStrict,
  problemsIn,
  shellCommand,
  strictFailure,
} from "../lib/strict.js";
import type { Assertion, Catalog, SiteConfig, LintIssue, NavData, Problem } from "../lib/types.js";
import { workspaceCatalog } from "./catalog.js";
import { writeProjectPages } from "./pages.js";
import {
  RegistryError,
  docsPrefix,
  projectDocs,
  projectRoot,
  readRegistry,
  type Workspace,
  type WorkspaceProject,
} from "./registry.js";

export interface WorkspaceOptions {
  /** The workspace: the folder with projects.json. */
  root: string;
  env: NodeJS.ProcessEnv;
  /** Build only these projects (paths). The site is then partial: it is for a quick look, not for publishing. */
  only?: readonly string[];
  /** `<path>` to the folder to use as that project's repository instead of `projects/<path>`. */
  sources?: Readonly<Record<string, string>>;
  lenient?: boolean;
  strict?: boolean;
  /** Print a GitHub Actions annotation for every error and every located warning. */
  ci?: boolean;
  /** Stop after step 5, with the root assembled and staged . */
  stopAfterNav?: boolean;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface WorkspaceResult {
  ok: boolean;
  strict: boolean;
  pages: number;
  problems: Problem[];
  workspace?: Workspace;
  /** The projects that were built. */
  projects: WorkspaceProject[];
  /** The merged sidebar data of the projects (every address is below its project's prefix). */
  nav?: NavData;
  /** The Jx project root, and the published folder. */
  jxRoot?: string;
  dist?: string;
}

/** Folders of the workspace the CLI generates. */
export const WORK_DIR = ".site-docs";
export const DIST_DIR = "dist";

const byPath = (a: WorkspaceProject, b: WorkspaceProject): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

function emptyNav(): NavData {
  return {
    home: { label: "Projects", url: "/" },
    loose: [],
    sections: [],
    expandAll: true,
    pages: {},
    flat: [],
    featured: [],
  };
}

/** Every file of the package's shell except what is generated or a template, `/`-separated, sorted. */
function shellFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const rel = `${prefix}${entry.name}`;
      const stat = entry.isSymbolicLink() ? statSync(path) : entry;
      if (stat.isDirectory()) visit(path, `${rel}/`);
      else if (stat.isFile()) out.push(rel);
    }
  };
  visit(dir, "");
  return out.sort();
}

/** The pseudo configuration of the site itself: what project.json and the pages that belong to no project read. */
export function siteConfig(ws: Workspace): SiteConfig {
  return {
    name: ws.name,
    tagline: ws.tagline,
    slug: "docs",
    platform: "general",
    repo: ws.org,
    domain: ws.domain,
    license: "MIT",
  };
}

/** The `config` entry of a project: what the layouts and components read as `state.config.data`. */
export function projectEntry(project: WorkspaceProject): Record<string, unknown> {
  return {
    name: project.name,
    tagline: project.tagline,
    slug: project.slug,
    path: project.path,
    platform: project.platform,
    repo: project.repo,
    license: project.license,
    branch: project.branch,
    docsPath: project.docs,
    home: `/${project.path}/`,
    docs: `${docsPrefix(project)}/`,
  };
}

export async function buildWorkspace(o: WorkspaceOptions): Promise<WorkspaceResult> {
  const log = o.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const error = o.error ?? log;
  const strict = isStrict(o, o.env);
  const problems: Problem[] = [];
  let documentProblems = 0;

  const record = (
    level: "error" | "warning",
    stage: string,
    message: string,
    where: { file?: string; line?: number } = {},
  ): void => {
    problems.push({
      level,
      message,
      ...(where.file === undefined ? {} : { file: where.file }),
      ...(where.line === undefined ? {} : { line: where.line }),
    });
    if (o.ci === true && (level === "error" || where.file !== undefined)) {
      log(annotation(level, message, where.file, where.line, stage));
    }
  };
  const warn = (stage: string, message: string, where?: { file?: string; line?: number }): void => {
    error(`${stage}: warning: ${message}`);
    record("warning", stage, message, where);
  };
  const fail = (stage: string, message: string, where?: { file?: string; line?: number }): void => {
    error(`${stage}: error: ${message}`);
    record("error", stage, message, where);
  };
  const documentProblem = (
    stage: string,
    message: string,
    where?: { file?: string; line?: number },
  ): void => {
    documentProblems++;
    record(strict ? "error" : "warning", stage, message, where);
  };
  const result = (ok: boolean, rest: Partial<WorkspaceResult> = {}): WorkspaceResult => ({
    ok,
    strict,
    pages: 0,
    problems,
    projects: [],
    ...rest,
  });

  // ---- step 1: the registry ----
  let ws: Workspace;
  try {
    ws = readRegistry(o.root);
  } catch (caught) {
    if (!(caught instanceof RegistryError)) throw caught;
    for (const problem of caught.problems) fail("registry", problem);
    return result(false);
  }
  const wanted = o.only === undefined ? undefined : new Set(o.only);
  if (wanted !== undefined) {
    const unknown = [...wanted].filter((path) => !ws.projects.some((p) => p.path === path));
    if (unknown.length > 0) {
      fail("registry", `no such project: ${unknown.join(", ")} (the paths are in projects.json)`);
      return result(false);
    }
  }
  const projects = ws.projects
    .filter((p) => wanted === undefined || wanted.has(p.path))
    .sort(byPath);
  const sources = o.sources ?? {};
  let missing = 0;
  for (const project of projects) {
    try {
      if (!statSync(projectDocs(o.root, project, sources)).isDirectory())
        throw new Error("not a folder");
    } catch {
      missing++;
      const where = projectRoot(o.root, project, sources);
      fail(
        "registry",
        `${project.path}: ${project.docs}/ is not in ${where}` +
          (sources[project.path] === undefined
            ? `; run \`git submodule update --init projects/${project.path}\` (or clone with --recurse-submodules)`
            : ""),
      );
    }
  }
  if (missing > 0) return result(false, { workspace: ws });
  log(
    `registry: ${projects.length} of ${ws.projects.length} project(s) for ${ws.domain}, ` +
      (strict
        ? "strict (document problems fail the build)"
        : "lenient (document problems are warnings)"),
  );

  // ---- step 2: assemble ----
  const work = join(o.root, WORK_DIR);
  const jxRoot = join(work, "site");
  const jxDist = join(jxRoot, "dist");
  ensureRealDir(work);
  removeInside(jxRoot, work);
  mkdirSync(jxRoot, { recursive: true });
  writeFileSync(join(work, ".gitignore"), "*\n");

  const shell = packageSiteDir();
  for (const rel of shellFiles(shell)) {
    if (rel === "project.base.json" || rel.startsWith("data/")) continue;
    copyFile(join(shell, ...rel.split("/")), join(jxRoot, ...rel.split("/")));
  }
  writeJson(
    join(jxRoot, "project.json"),
    generateProject(siteConfig(ws), { strict, base: readBaseProject(shell) }),
  );

  const baseCatalog = JSON.parse(
    readFileSync(join(shell, "data", "projects.snapshot.json"), "utf8"),
  ) as Catalog;
  writeJson(
    join(jxRoot, "data", "projects.snapshot.json"),
    // A partial build (`--only`) links only the projects it builds: the landing page and the switcher
    // must not point at pages that are not in this site.
    workspaceCatalog(baseCatalog, { ...ws, projects }, baseCatalog.generated),
  );
  mkdirSync(join(jxRoot, "public"), { recursive: true });
  writeFileSync(join(jxRoot, "public", "CNAME"), `${ws.domain}\n`);
  const jx = linkJxPackages(jxRoot);
  const pagesWritten = writeProjectPages(jxRoot, projects);
  log(
    `assemble: ${jxRoot} (@jxsuite/compiler ${jx["@jxsuite/compiler"] ?? "?"}, ${pagesWritten.length} project page(s))`,
  );

  // ---- steps 3 to 5: each project ----
  const navs: NavData[] = [];
  const prefixes: string[] = [];
  const owners: NonNullable<Parameters<typeof runPostbuild>[3]["projects"]>[number][] = [];
  const nav = emptyNav();
  const sourcesOfPage: Record<string, string> = {};
  writeJson(join(jxRoot, ".generated", "config", "workspace.json"), {
    name: ws.name,
    tagline: ws.tagline,
    slug: "docs",
    path: "",
    platform: "general",
    repo: ws.org,
    license: "MIT",
    branch: "main",
    docsPath: "docs",
    home: "/",
    docs: "/",
  });
  writeJson(join(jxRoot, ".generated", "nav", "workspace.json"), emptyNav());

  for (const project of projects) {
    const repoRoot = projectRoot(o.root, project, sources);
    const docsDir = projectDocs(o.root, project, sources);
    const prefix = docsPrefix(project);
    const stagedDocs = join(jxRoot, ".generated", "docs", project.path, "docs");
    const label = `${project.path}/${project.docs}`;
    const docsFile = (rel: string): string => `${label}/${rel}`;
    // Where a GitHub annotation can attach: relative to the repository the run checked out. For a
    // project's own pull request (`--source`) that is the project's repository; otherwise the
    // workspace, where the project is a submodule (or the workspace itself).
    const annotationBase =
      sources[project.path] !== undefined || project.local === true
        ? project.docs
        : `projects/${project.path}/${project.docs}`;
    const annotationFile = (rel: string): string => `${annotationBase}/${rel}`;

    const staged = stageSite(
      { siteDir: o.root, repoRoot, docsDir, stagedDocs },
      { repo: project.repo },
      project.branch,
    );
    for (const link of staged.links) {
      log(`stage: ${docsFile(link.file)}:${link.line}  ${link.from} -> ${link.to}`);
    }
    for (const file of staged.comments) {
      log(`stage: ${docsFile(file)}  moved the comment above the front matter below it`);
    }
    for (const skipped of staged.skipped) {
      const message = `${docsFile(skipped.path)} is ${skipped.reason}: not published`;
      error(`stage: ${message}`);
      documentProblem("stage", message, { file: annotationFile(skipped.path) });
    }

    const issues: LintIssue[] = lintDocs(docsDir, { repoRoot });
    for (const issue of issues) {
      const isError = issue.level === "error";
      const level = isError && strict ? "error" : "warning";
      error(`lint: ${level}: ${formatIssue(issue, { prefix: label })}`);
      if (isError) documentProblems++;
      record(level, "lint", `${project.path}: ${issue.message}`, {
        file: annotationFile(issue.file),
        line: issue.line,
      });
    }

    let written: ReturnType<typeof writeNav>;
    try {
      written = writeNav(
        { stagedDocs, navFile: join(jxRoot, ".generated", "nav", `${project.path}.json`) },
        { name: project.name },
        { folder: project.docs, prefix },
      );
    } catch (caught) {
      fail("nav", `${project.path}: ${(caught as Error).message}`);
      return result(false, { workspace: ws, projects });
    }
    for (const warning of written.warnings) warn("nav", `${project.path}: ${warning}`);
    writeJson(join(jxRoot, ".generated", "config", `${project.path}.json`), projectEntry(project));
    navs.push(written.nav);
    prefixes.push(`${prefix}/`);
    Object.assign(nav.pages, written.nav.pages);
    for (const [route, page] of Object.entries(written.nav.pages)) {
      sourcesOfPage[route] = docsFile(page.edit);
    }
    owners.push({ prefix, repoRoot, docsDir, repo: project.repo, branch: project.branch });
    log(
      `stage: ${project.path}: ${staged.files} file(s), ${written.pages} page(s), ${issues.length} lint issue(s)`,
    );
  }
  nav.flat = navs.flatMap((n) => n.flat);

  if (o.stopAfterNav === true) return result(true, { workspace: ws, projects, nav, jxRoot });

  // ---- step 6: jx ----
  const command = [process.execPath, jxCli(), "build", jxRoot];
  log(`jx: ${shellCommand(command)}`);
  const run = await spawnCommand(command, { cwd: jxRoot, env: o.env, onLine: (line) => log(line) });
  mkdirSync(dirname(join(work, "jx.log")), { recursive: true });
  writeFileSync(join(work, "jx.log"), run.output);
  for (const line of problemsIn(run.output)) documentProblem("jx", line);
  if (run.code !== 0) {
    for (const line of failureProblems(run.output)) documentProblem("jx", line);
    error(
      `docs: jx build failed. The assembled project is ${jxRoot}; run: ${shellCommand(command)}`,
    );
    const hint = imageHint(run.output);
    if (hint !== null) error(`docs: ${hint}`);
    record("error", "jx", `jx build failed (exit code ${run.code}); see ${join(work, "jx.log")}`);
    if (strict && documentProblems > 0) error(strictFailure(documentProblems));
    return result(false, { workspace: ws, projects, nav, jxRoot });
  }
  const expected = expectedRoutes(nav, jxRoot);
  const routes = doneRoutes(run.output);
  if (routes === null) {
    const message =
      'Jx printed no "Done: N routes" line, so the number of routes could not be checked';
    error(`jx: ${strict ? "error" : "warning"}: ${message}`);
    documentProblem("jx", message);
  } else if (routes < expected) {
    const message =
      `Jx dropped routes: it built ${routes}, the documents and the site's own pages promise ${expected}. ` +
      "Two pages with one address, or a page Jx could not route, are the usual cause.";
    error(`jx: ${strict ? "error" : "warning"}: ${message}`);
    documentProblem("jx", message);
  }
  if (documentProblems > 0 && strict) {
    error(strictFailure(documentProblems));
    return result(false, { workspace: ws, projects, nav, jxRoot });
  }

  // ---- step 7: postbuild ----
  const site = siteConfig(ws);
  const summary = runPostbuild(jxDist, { ...site, branch: "main" }, nav, {
    repoRoot: o.root,
    docsDir: o.root,
    projects: owners,
  });
  for (const link of summary.repoLinks) log(`postbuild: ${link.page}  ${link.from} -> ${link.to}`);
  for (const warning of summary.warnings) warn("postbuild", warning);
  log(
    `postbuild: ${summary.pages} page(s), ${summary.sitemapUrls} in the sitemap, ` +
      `${summary.canonicals} canonical URL(s) set, ${summary.searchTitles} search title(s) fixed, ` +
      `CNAME ${summary.cname ? "present" : "absent"}`,
  );

  // ---- step 8: assert (fatal in every mode) ----
  const assertions: Assertion[] = assertBuild(jxRoot, jxDist, {
    cname: ws.domain,
    routes: expected,
    sources: sourcesOfPage,
    docsPrefixes: prefixes,
  });
  let failed = 0;
  for (const assertion of assertions) {
    if (assertion.ok) {
      log(`assert: ok: ${assertion.message}`);
    } else {
      failed++;
      error(`assert: FAIL: ${assertion.message}`);
      record("error", "assert", assertion.message);
    }
  }
  if (failed > 0) {
    for (const line of assertionFailure(failed, { strict, linted: false })) error(line);
    return result(false, { workspace: ws, projects, nav, jxRoot });
  }

  // ---- step 9: publish ----
  const dist = join(o.root, DIST_DIR);
  replaceDir(jxDist, dist);
  log(`build: ${summary.pages} page(s) of ${projects.length} project(s) written to ${dist}`);
  return result(true, { workspace: ws, projects, nav, jxRoot, dist, pages: summary.pages });
}
