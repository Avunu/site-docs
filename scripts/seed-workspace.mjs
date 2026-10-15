#!/usr/bin/env node
// Seeds the documentation workspace: writes projects.json and .gitmodules, and records one gitlink
// (a submodule pointer) per project in the index, from the repositories listed in fleet.json.
//
// For every repository of the fleet the script reads docs-site/docusystem.config.json on its default
// branch (`gh api repos/<owner>/<name>/contents/...`) and `branch` from `gh repo view`. The registry
// entry is made of the file's name, tagline, slug, platform, repo and license; its `path` is the first
// label of the file's `domain` (`carbon-theme.avunu.net` -> `carbon-theme`), because that label already
// carries the planned names of the repositories that are about to be renamed. This repository itself is
// the workspace, not a submodule: it is registered as `site-docs` with `"local": true`, and its own
// pages are in docs/. It is found from `git remote get-url origin`, or --self.
//
//   node scripts/seed-workspace.mjs [--dry-run] [--refresh] [--no-pins] [--fleet <file>]
//                                   [--registry <file>] [--gitmodules <file>] [--self <owner/name>]
//
//   --dry-run     Read from GitHub, write nothing (no file, no index entry); print what would be written.
//   --refresh     Replace the entries that projects.json already has with fresh ones. Without it, an
//                 entry that is already there is kept as it is (a maintainer may have edited it).
//   --no-pins     Write the two files only; record no gitlink.
//   --fleet       The repositories. Default: fleet.json
//   --registry    Default: projects.json (its header, `domain`, `name`, `tagline` and `org`, is kept if
//                 the file exists)
//   --gitmodules  Default: .gitmodules (only the `projects/*` sections are managed; any other section
//                 is left alone)
//   --self        The workspace repository as owner/name. Default: the `origin` remote.
//
// A gitlink that already exists is never moved (that is the bump workflow's job). A new one points at
// what the bump workflow would choose: the tag commit of the latest release, else the head of the
// default branch. Idempotent: running it again changes nothing. Nothing is committed and no submodule
// is cloned; `git submodule update --init --depth 1` does that.
//
// Exit codes: 0 done; 1 a repository could not be read (nothing is written then); 2 usage error.
import { mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PATH_SEGMENT, lookupProject, parseRegistry, systemRunner } from "./bump-submodules.mjs";

/** The header of a new projects.json. */
export const DEFAULT_HEADER = {
  domain: "docs.avunu.net",
  name: "Avunu documentation",
  tagline: "Documentation for Avunu's open-source projects.",
  org: "https://github.com/Avunu",
};
const PLATFORMS = ["frappe", "odoo", "wordpress", "nixos", "general"];
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const REPO_URL = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;
/** The keys of an entry in the order they are written; any other key follows. */
const ENTRY_KEYS = [
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
];
/** The path under which the workspace repository registers itself. */
export const SELF_PATH = "site-docs";

// ---- pure: a config file to a registry entry ----

/** The first label of a domain, which is the `path` of the project: `carbon-theme.avunu.net` -> `carbon-theme`. */
export function pathFromDomain(domain) {
  if (typeof domain !== "string" || domain === "") throw new Error('the config has no "domain"');
  const label = domain.split(".")[0] ?? "";
  if (!PATH_SEGMENT.test(label)) {
    throw new Error(`the first label of the domain "${domain}" is not a valid path`);
  }
  return label;
}

/** Text that is shown on a page: no `${`, markup or control character (the build evaluates `${...}`). */
const plain = (text) => !/\$\{|[<>\p{Cc}]/u.test(text);

/**
 * A registry entry from the text of docs-site/docusystem.config.json. `branch` is the repository's
 * default branch. With `pathOverride` (the workspace repository) the domain is not read and the entry is
 * flagged `local`. Throws an Error that names the problem.
 */
export function projectFromConfig(text, { branch, pathOverride }) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new Error(`the config is not valid JSON: ${error.message}`, { cause: error });
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("the config is not an object");
  }
  for (const key of ["name", "tagline", "slug", "platform", "repo", "license"]) {
    if (typeof config[key] !== "string" || config[key].trim() === "") {
      throw new Error(`the config has no "${key}"`);
    }
  }
  for (const key of ["name", "tagline", "license"]) {
    if (!plain(config[key]))
      throw new Error(`"${key}" contains markup, "\${" or a control character`);
  }
  if (!SLUG.test(config.slug))
    throw new Error(`"slug" ${JSON.stringify(config.slug)} is not valid`);
  if (!PLATFORMS.includes(config.platform)) {
    throw new Error(`"platform" must be one of ${PLATFORMS.join(", ")}, not ${config.platform}`);
  }
  if (!REPO_URL.test(config.repo))
    throw new Error('"repo" must be https://github.com/<owner>/<name>');
  if (typeof branch !== "string" || branch === "") throw new Error("the default branch is unknown");
  const entry = {
    path: pathOverride ?? pathFromDomain(config.domain),
    slug: config.slug,
    name: config.name,
    tagline: config.tagline,
    platform: config.platform,
    repo: config.repo,
    license: config.license,
    branch,
    docs: "docs",
  };
  if (pathOverride !== undefined) entry.local = true;
  return entry;
}

// ---- pure: the registry and .gitmodules ----

const ordered = (entry) => {
  const known = ENTRY_KEYS.filter((key) => key in entry).map((key) => [key, entry[key]]);
  const rest = Object.entries(entry).filter(([key]) => !ENTRY_KEYS.includes(key));
  return Object.fromEntries([...known, ...rest]);
};

/**
 * The registry document: the header of `existing` (or the default one), the entries of `existing`
 * (kept as they are unless `refresh`), the new entries, sorted by path. Throws when two entries have the
 * same path or slug.
 */
export function mergeRegistry(existing, entries, { refresh = false } = {}) {
  const header = {};
  for (const key of Object.keys(DEFAULT_HEADER))
    header[key] = existing?.[key] ?? DEFAULT_HEADER[key];
  const byPath = new Map();
  for (const entry of existing?.projects ?? []) byPath.set(entry.path, entry);
  const fresh = new Set();
  for (const entry of entries) {
    if (fresh.has(entry.path)) {
      throw new Error(`two repositories have the path "${entry.path}": check their domains`);
    }
    fresh.add(entry.path);
    if (refresh || !byPath.has(entry.path)) byPath.set(entry.path, entry);
  }
  const projects = [...byPath.values()].map(ordered).sort((a, b) => (a.path < b.path ? -1 : 1));
  const slugs = new Map();
  for (const project of projects) {
    const other = slugs.get(project.slug);
    if (other !== undefined) {
      throw new Error(
        `the projects "${other}" and "${project.path}" have the same slug "${project.slug}"`,
      );
    }
    slugs.set(project.slug, project.path);
  }
  return { ...header, projects };
}

/** projects.json as text. */
export const renderRegistry = (registry) => `${JSON.stringify(registry, null, 2)}\n`;

/** The sections of a .gitmodules text: the lines before the first one, and { name, lines } per section. */
function sections(text) {
  const preamble = [];
  const found = [];
  let current = null;
  for (const line of text.split("\n")) {
    const header = /^\[submodule "([^"]+)"\]\s*$/.exec(line);
    if (header !== null) {
      current = { name: header[1] ?? "", lines: [line] };
      found.push(current);
    } else if (current === null) {
      preamble.push(line);
    } else {
      current.lines.push(line);
    }
  }
  return { preamble, found };
}

/**
 * .gitmodules for the registry: one `projects/<path>` section per project that is not `local`, shallow,
 * following the project's branch. Sections of `existing` that are not under projects/ are kept as they
 * are, first.
 */
export function renderGitmodules(existing, projects) {
  const { preamble, found } = sections(existing ?? "");
  const kept = [
    ...preamble,
    ...found.filter((s) => !s.name.startsWith("projects/")).flatMap((s) => s.lines),
  ];
  const blocks = projects
    .filter((project) => project.local !== true)
    .map((project) =>
      [
        `[submodule "projects/${project.path}"]`,
        `\tpath = projects/${project.path}`,
        `\turl = ${project.repo}.git`,
        `\tbranch = ${project.branch}`,
        "\tshallow = true",
      ].join("\n"),
    );
  const head = kept.join("\n").trim();
  return `${[...(head === "" ? [] : [head]), ...blocks].join("\n")}\n`;
}

/** owner/name from a git remote URL (https or scp-like ssh); null when it is not a GitHub address. */
export function repoFromRemote(url) {
  const match = /github\.com[/:]([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  );
  return match?.[1] ?? null;
}

// ---- the work ----

const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";

/** The entry for one repository (owner/name), read from GitHub. Throws an Error that names the problem. */
export function readProject(fullName, run, { pathOverride } = {}) {
  const view = run("gh", [
    "repo",
    "view",
    fullName,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  if (view.status !== 0) throw new Error(`gh repo view failed: ${firstLine(view.stderr)}`);
  const file = run("gh", [
    "api",
    "-H",
    "Accept: application/vnd.github.raw+json",
    `repos/${fullName}/contents/docs-site/docusystem.config.json`,
  ]);
  if (file.status !== 0) {
    throw new Error(`docs-site/docusystem.config.json: ${firstLine(file.stderr) || "unreadable"}`);
  }
  return projectFromConfig(file.stdout, { branch: view.stdout.trim(), pathOverride });
}

const USAGE =
  "Usage: node scripts/seed-workspace.mjs [--dry-run] [--refresh] [--no-pins] [--fleet <file>] [--registry <file>] [--gitmodules <file>] [--self <owner/name>]";

const defaultIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

/** The command line. Returns the exit code. */
export function main(argv, io = defaultIo, env = {}) {
  const { run = systemRunner, cwd = process.cwd() } = env;
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "dry-run": { type: "boolean", default: false },
        refresh: { type: "boolean", default: false },
        "no-pins": { type: "boolean", default: false },
        fleet: { type: "string", default: "fleet.json" },
        registry: { type: "string", default: "projects.json" },
        gitmodules: { type: "string", default: ".gitmodules" },
        self: { type: "string" },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.stderr(`seed-workspace: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  const dryRun = values["dry-run"];
  const at = (file) => resolve(cwd, file);

  let fleet;
  try {
    fleet = JSON.parse(readFileSync(at(values.fleet), "utf8"));
    if (
      !Array.isArray(fleet) ||
      fleet.some((e) => typeof e?.repo !== "string" || !FULL_NAME.test(e.repo))
    ) {
      throw new Error('expected an array of { "repo": "<owner>/<name>" }');
    }
  } catch (error) {
    io.stderr(`seed-workspace: ${values.fleet}: ${error.message}`);
    return 2;
  }

  let self = values.self;
  if (self === undefined) {
    const origin = run("git", ["remote", "get-url", "origin"], { cwd });
    self = origin.status === 0 ? (repoFromRemote(origin.stdout) ?? undefined) : undefined;
  }
  if (self === undefined || !FULL_NAME.test(self)) {
    io.stderr("seed-workspace: cannot tell which repository this is: pass --self <owner/name>");
    return 2;
  }

  // Everything is read before anything is written: one unreadable repository writes nothing.
  const sameRepo = (a, b) => a.toLowerCase() === b.toLowerCase();
  const wanted = [
    ...fleet
      .map((entry) => ({ fullName: entry.repo }))
      .filter((item) => !sameRepo(item.fullName, self)),
    { fullName: self, pathOverride: SELF_PATH },
  ];
  const entries = [];
  const failures = [];
  for (const item of wanted) {
    try {
      const entry = readProject(item.fullName, run, item);
      entries.push(entry);
      io.stdout(`seed: ${item.fullName} -> ${entry.path}${entry.local ? " (local)" : ""}`);
    } catch (error) {
      failures.push(item.fullName);
      io.stderr(`seed-workspace: ${item.fullName}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    io.stderr(
      `seed-workspace: ${failures.length} repositories could not be read; nothing was written`,
    );
    return 1;
  }

  let existing = null;
  if (existsSync(at(values.registry))) {
    try {
      existing = JSON.parse(readFileSync(at(values.registry), "utf8"));
    } catch (error) {
      io.stderr(`seed-workspace: ${values.registry}: ${error.message}`);
      return 1;
    }
  }
  let registry;
  try {
    registry = mergeRegistry(existing, entries, { refresh: values.refresh });
  } catch (error) {
    io.stderr(`seed-workspace: ${error.message}`);
    return 1;
  }
  const registryText = renderRegistry(registry);
  const modulesText = renderGitmodules(
    existsSync(at(values.gitmodules)) ? readFileSync(at(values.gitmodules), "utf8") : null,
    registry.projects,
  );

  // The gitlinks: only where there is none yet.
  const pins = [];
  let pinFailures = 0;
  if (!values["no-pins"]) {
    for (const project of parseRegistry(registryText)) {
      if (project.local) continue;
      const folder = `projects/${project.path}`;
      const current = run("git", ["ls-files", "--stage", "--", folder], { cwd });
      if (current.status === 0 && current.stdout.startsWith("160000 ")) continue;
      try {
        const target = lookupProject(project, run);
        pins.push({ folder, to: target.to, reason: target.reason, tag: target.toTag });
        io.stdout(
          `pin: ${folder} -> ${target.toTag ?? target.to.slice(0, 7)} (${target.reason === "release" ? "latest release" : `head of ${project.branch}`})`,
        );
      } catch (error) {
        pinFailures += 1;
        io.stderr(`seed-workspace: ${folder}: cannot choose a commit: ${error.message}`);
      }
    }
  }

  if (dryRun) {
    io.stdout(`--- ${values.registry} (would be written)\n${registryText}`);
    io.stdout(`--- ${values.gitmodules} (would be written)\n${modulesText}`);
    io.stdout(`seed: dry run, nothing was written (${pins.length} gitlink(s) would be added)`);
    return pinFailures === 0 ? 0 : 1;
  }

  writeFileSync(at(values.registry), registryText);
  writeFileSync(at(values.gitmodules), modulesText);
  for (const pin of pins) {
    const update = run(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${pin.to},${pin.folder}`],
      {
        cwd,
      },
    );
    if (update.status !== 0) {
      pinFailures += 1;
      io.stderr(
        `seed-workspace: ${pin.folder}: git update-index failed: ${firstLine(update.stderr)}`,
      );
      continue;
    }
    // The empty folder an uninitialised submodule leaves, so `git status` does not show it deleted.
    mkdirSync(at(pin.folder), { recursive: true });
  }
  io.stdout(
    `seed: wrote ${values.registry} (${registry.projects.length} projects) and ${values.gitmodules}; ${pins.length - pinFailures} gitlink(s) added`,
  );
  return pinFailures === 0 ? 0 : 1;
}

// `import.meta.main` exists only on Node 24.2+; this must also run (and not silently pass) on 22.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
