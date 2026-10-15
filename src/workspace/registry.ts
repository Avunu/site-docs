// The registry of the workspace: `projects.json`, the list of projects whose documentation the one
// site publishes. Each project is a git submodule at `projects/<path>/` (or, for the workspace's own
// documentation, `local`), and its `docs/` folder is published at `/<path>/docs/`.
//
// `path` is a configuration value and never derived from the repository name: a repository is renamed
// without its address changing. It is also the URL segment, so it is restricted to what a URL segment
// and a folder name can both carry without escaping.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PLATFORMS, type Platform } from "../lib/platforms.js";

export const REGISTRY_FILE = "projects.json";

// A slug is a catalog key, so it may have underscores (erpnext_taskview); a path may not.
export const SLUG = /^[a-z0-9][a-z0-9_-]*$/;
export const REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
export const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
// A branch name that is safe to write into a URL: no spaces, quotes, "..", or a leading dash.
export const BRANCH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9_][\w./-]{0,99}$/;

// The text keys are shown by components that hand them on as props, and Jx evaluates every string
// that holds `${` as JavaScript (a `license` of "MIT${...}" ran code on every page).
export const NO_EXPRESSION = /^(?![\s\S]*\$\{)/;

export const NAME_MAX = 80;
export const TAGLINE_MAX = 200;
export const LICENSE_MAX = 80;

/** A project path: one URL segment, lowercase, no underscore (a catalog slug may have one, a path may not). */
export const PROJECT_PATH = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Names a project may not take: they are files or folders that the site itself publishes at its root.
 * A project at `/assets/` would collide with the Jx runtime, one at `/404/` with the not-found page.
 */
export const RESERVED_PATHS = [
  "assets",
  "brand",
  "components",
  "data",
  "fonts",
  "images",
  "public",
  "404",
] as const;

export interface WorkspaceProject {
  /** The URL segment and the submodule folder name: `projects/<path>`. */
  path: string;
  /** The key of the project in the avunu.net catalog (it may hold underscores: `erpnext_taskview`). */
  slug: string;
  name: string;
  tagline: string;
  platform: Platform;
  /** https://github.com/<owner>/<repo>: Edit this page, the header link, repository links in the Markdown. */
  repo: string;
  license: string;
  /** The default branch of the repository: the edit links name it, and a project without a release follows it. */
  branch: string;
  /** The Markdown folder inside the repository. Default `docs`. */
  docs: string;
  /** The project lives in this repository (its documentation is the workspace's own), not in a submodule. */
  local?: boolean;
}

export interface Workspace {
  /** The domain the site is served from. */
  domain: string;
  /** The name and tagline of the site (the landing page and the not-found page). */
  name: string;
  tagline: string;
  /** The organization on GitHub (the footer and the header of pages that belong to no project). */
  org: string;
  projects: WorkspaceProject[];
}

export class RegistryError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"));
    this.name = "RegistryError";
  }
}

type Bag = Record<string, unknown>;
const isObject = (value: unknown): value is Bag =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function got(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string")
    return JSON.stringify(value.length > 60 ? `${value.slice(0, 57)}...` : value);
  return typeof value === "object" ? "an object" : String(value);
}

/** The text key `key` of `bag`, or a problem naming `where`. */
function field(
  bag: Bag,
  key: string,
  where: string,
  problems: string[],
  o: { max?: number; optional?: boolean } = {},
): string | undefined {
  const value = bag[key];
  if (value === undefined) {
    if (o.optional !== true) problems.push(`${where}: "${key}" is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${where}: "${key}" must be a non-empty string (got ${got(value)})`);
    return undefined;
  }
  if (!NO_EXPRESSION.test(value)) {
    problems.push(
      `${where}: "${key}" must not contain \${...}: Jx runs it as JavaScript when the site is built`,
    );
    return undefined;
  }
  if (o.max !== undefined && [...value].length > o.max) {
    problems.push(`${where}: "${key}" is longer than ${o.max} characters`);
    return undefined;
  }
  return value;
}

/** The settings of a project, in the order the schema lists them. */
export const PROJECT_KEYS = [
  "path",
  "slug",
  "name",
  "tagline",
  "platform",
  "repo",
  "license",
  "branch",
  "docs",
  "local",
] as const;

/** Every problem of a parsed `projects.json`, one line each, naming the entry; empty when it is valid. */
export function validateRegistry(raw: unknown): string[] {
  if (!isObject(raw)) return [`${REGISTRY_FILE} must be a JSON object (got ${got(raw)})`];
  const problems: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!["$schema", "domain", "name", "tagline", "org", "projects"].includes(key)) {
      problems.push(`${REGISTRY_FILE}: "${key}" is not a setting of the workspace`);
    }
  }
  const domain = field(raw, "domain", REGISTRY_FILE, problems);
  if (domain !== undefined && !DOMAIN.test(domain)) {
    problems.push(
      `${REGISTRY_FILE}: "domain" must be a host name without a scheme (got ${got(domain)})`,
    );
  }
  field(raw, "name", REGISTRY_FILE, problems, { max: NAME_MAX });
  field(raw, "tagline", REGISTRY_FILE, problems, { max: TAGLINE_MAX });
  const org = field(raw, "org", REGISTRY_FILE, problems);
  if (org !== undefined && !/^https:\/\/github\.com\/[\w.-]+$/.test(org)) {
    problems.push(
      `${REGISTRY_FILE}: "org" must look like https://github.com/Avunu (got ${got(org)})`,
    );
  }

  const projects = raw.projects;
  if (!Array.isArray(projects)) {
    problems.push(`${REGISTRY_FILE}: "projects" must be a list (got ${got(projects)})`);
    return problems;
  }
  const paths = new Set<string>();
  const slugs = new Set<string>();
  const repos = new Set<string>();
  projects.forEach((entry, index) => {
    const where =
      isObject(entry) && typeof entry.path === "string"
        ? `project ${entry.path}`
        : `project #${index + 1}`;
    if (!isObject(entry)) {
      problems.push(`${where}: must be an object (got ${got(entry)})`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!(PROJECT_KEYS as readonly string[]).includes(key))
        problems.push(`${where}: "${key}" is not a project setting`);
    }
    const path = field(entry, "path", where, problems);
    if (path !== undefined) {
      if (!PROJECT_PATH.test(path)) {
        problems.push(
          `${where}: "path" must be lowercase letters, digits and hyphens, one segment (got ${got(path)})`,
        );
      } else if ((RESERVED_PATHS as readonly string[]).includes(path)) {
        problems.push(
          `${where}: "path" may not be "${path}": the site publishes its own ${path} at its root`,
        );
      } else if (paths.has(path)) problems.push(`${where}: "path" is used by an earlier project`);
      paths.add(path);
    }
    const slug = field(entry, "slug", where, problems);
    if (slug !== undefined) {
      if (!SLUG.test(slug))
        problems.push(
          `${where}: "slug" must be lowercase letters, digits, hyphens and underscores (got ${got(slug)})`,
        );
      else if (slugs.has(slug)) problems.push(`${where}: "slug" is used by an earlier project`);
      slugs.add(slug);
    }
    field(entry, "name", where, problems, { max: NAME_MAX });
    field(entry, "tagline", where, problems, { max: TAGLINE_MAX });
    field(entry, "license", where, problems, { max: LICENSE_MAX });
    const platform = field(entry, "platform", where, problems);
    if (platform !== undefined && !(PLATFORMS as readonly string[]).includes(platform)) {
      problems.push(
        `${where}: "platform" must be one of ${PLATFORMS.join(", ")} (got ${got(platform)})`,
      );
    }
    const repo = field(entry, "repo", where, problems);
    if (repo !== undefined) {
      if (!REPO.test(repo))
        problems.push(
          `${where}: "repo" must look like https://github.com/Avunu/project (got ${got(repo)})`,
        );
      else if (repos.has(repo.toLowerCase()) && entry.local !== true)
        problems.push(`${where}: "repo" is used by an earlier project`);
      repos.add(repo.toLowerCase());
    }
    const branch = field(entry, "branch", where, problems);
    if (branch !== undefined && !BRANCH.test(branch)) {
      problems.push(
        `${where}: "branch" is not a branch name that is safe in a URL (got ${got(branch)})`,
      );
    }
    const docs = field(entry, "docs", where, problems, { optional: true });
    if (docs !== undefined && (docs.startsWith("/") || docs.split("/").includes(".."))) {
      problems.push(
        `${where}: "docs" must be a folder inside the repository, without a leading slash or .. (got ${got(docs)})`,
      );
    }
    if (entry.local !== undefined && typeof entry.local !== "boolean") {
      problems.push(`${where}: "local" must be true or false (got ${got(entry.local)})`);
    }
  });
  const sorted = [...paths].sort();
  if (paths.size > 0 && [...paths].some((p, i) => p !== sorted[i])) {
    problems.push(
      `${REGISTRY_FILE}: the projects are not sorted by "path": keep the list in order so that a change shows as one line`,
    );
  }
  return problems;
}

/** Reads and validates `<root>/projects.json`; every problem is listed in the error. */
export function readRegistry(root: string): Workspace {
  const file = join(root, REGISTRY_FILE);
  if (!existsSync(file)) {
    throw new RegistryError([`${file} does not exist: this folder is not a docs workspace`]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new RegistryError([`${REGISTRY_FILE} is not valid JSON: ${(error as Error).message}`]);
  }
  const problems = validateRegistry(parsed);
  if (problems.length > 0) throw new RegistryError(problems);
  const bag = parsed as Bag;
  return {
    domain: bag.domain as string,
    name: bag.name as string,
    tagline: bag.tagline as string,
    org: bag.org as string,
    projects: (bag.projects as Bag[]).map((entry) => {
      const project: WorkspaceProject = {
        path: entry.path as string,
        slug: entry.slug as string,
        name: entry.name as string,
        tagline: entry.tagline as string,
        platform: entry.platform as Platform,
        repo: entry.repo as string,
        license: entry.license as string,
        branch: entry.branch as string,
        docs: (entry.docs as string | undefined) ?? "docs",
      };
      if (entry.local === true) project.local = true;
      return project;
    }),
  };
}

/**
 * Where a project's repository is on disk: `projects/<path>` below the workspace, the workspace itself
 * for a `local` project, or the folder `sources` names for it (`--source <path>=<dir>`: a project's own
 * pull request is checked against its own checkout instead of the pinned submodule).
 */
export function projectRoot(
  root: string,
  project: Pick<WorkspaceProject, "path" | "local">,
  sources: Readonly<Record<string, string>> = {},
): string {
  const given = sources[project.path];
  if (given !== undefined) return resolve(given);
  return project.local === true ? resolve(root) : join(resolve(root), "projects", project.path);
}

/** The Markdown folder of a project. */
export function projectDocs(
  root: string,
  project: WorkspaceProject,
  sources: Readonly<Record<string, string>> = {},
): string {
  return join(projectRoot(root, project, sources), ...project.docs.split("/"));
}

/** Where a project's documentation starts on the site: `/frappe-nix/docs`. */
export const docsPrefix = (project: Pick<WorkspaceProject, "path">): string =>
  `/${project.path}/docs`;
