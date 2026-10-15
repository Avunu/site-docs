#!/usr/bin/env node
// Moves the submodule pointers of the documentation workspace to the commit each project should be
// built from. Run by the `Bump projects` workflow (.github/workflows/bump.yml) in a checkout WITHOUT
// submodules; it needs `git` and the GitHub CLI (`gh`, authenticated through GH_TOKEN) and nothing else.
//
// For every project of projects.json that is not `local` (or just the one named by --project):
//
//   1. target commit: the commit of the tag of the latest non-prerelease GitHub Release
//      (`gh api repos/<owner>/<repo>/releases/latest`, tag resolved with `git ls-remote`, annotated
//      tags peeled); a project with no such release gets the head of its `branch` until it has one;
//   2. current commit: what the gitlink of projects/<path> records at HEAD (`git ls-tree`);
//   3. when they differ, the gitlink in the INDEX is rewritten with `git update-index --cacheinfo`,
//      which needs no checkout of the submodule and no history. When the submodule happens to be
//      initialised, the one commit is also fetched into it (shallow). Nothing is committed: the caller
//      commits the index.
//
//   node scripts/bump-submodules.mjs [--project <path>] [--registry <file>] [--json <file>]
//                                    [--summary <file>] [--dry-run]
//
//   --project <path>    Only this project (its `path` in projects.json).
//   --registry <file>   The registry. Default: projects.json
//   --json <file>       Write the report: { changed, skipped, unchanged } (see `report` below).
//   --summary <file>    Write the Markdown for a pull request body.
//   --dry-run           Resolve and report, but change neither the index nor any submodule.
//
// A project whose lookup fails (no network, a release whose tag is gone, no gitlink yet) is reported
// under `skipped` and never stops the others. Exit codes: 0 done, whether or not anything changed;
// 1 the registry cannot be read or a report cannot be written; 2 usage error.
//
// `changed` entries: { path, repo, from, to, fromTag, toTag, reason } where from/to are 40-character
// commits, fromTag/toTag are tag names or null, and reason is "release" or "branch".
//
// Everything that decides something is a pure function exported for tests; the git and gh calls go
// through an injectable runner (`run(command, args, { cwd }) => { status, stdout, stderr }`).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SHA = /^[0-9a-f]{40}$/;
/** `path` of a project: a URL segment and the folder name under projects/. */
export const PATH_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
/** Tag names that are safe to print into Markdown and a commit message. */
const TAG = /^[A-Za-z0-9][A-Za-z0-9._+/@-]*$/;
const REPO_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

// ---- the registry ----

/**
 * Reads projects.json: every entry with the facts the script needs, validated, in file order.
 * Throws an Error that names the problem. `local` entries (the workspace repository itself) are kept
 * and flagged; bumping skips them.
 */
export function parseRegistry(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new Error(`not valid JSON: ${error.message}`, { cause: error });
  }
  if (doc === null || typeof doc !== "object" || !Array.isArray(doc.projects)) {
    throw new Error('expected an object with a "projects" array');
  }
  const seen = new Set();
  return doc.projects.map((entry, at) => {
    const where = `projects[${at}]`;
    if (entry === null || typeof entry !== "object") throw new Error(`${where}: not an object`);
    if (typeof entry.path !== "string" || !PATH_SEGMENT.test(entry.path)) {
      throw new Error(`${where}: "path" must be lowercase letters, digits and hyphens`);
    }
    if (seen.has(entry.path)) throw new Error(`${where}: path "${entry.path}" is listed twice`);
    seen.add(entry.path);
    const match = typeof entry.repo === "string" ? REPO_URL.exec(entry.repo) : null;
    if (match === null) {
      throw new Error(`${where} (${entry.path}): "repo" must be https://github.com/<owner>/<name>`);
    }
    const local = entry.local === true;
    if (!local && (typeof entry.branch !== "string" || !BRANCH.test(entry.branch))) {
      throw new Error(`${where} (${entry.path}): "branch" must be a branch name`);
    }
    const [, owner, name] = match;
    return {
      path: entry.path,
      repo: `https://github.com/${owner}/${name}`,
      owner,
      name,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      branch: typeof entry.branch === "string" ? entry.branch : "",
      local,
    };
  });
}

// ---- reading git and gh output ----

/** The commit a gitlink records, from `git ls-tree HEAD <path>` output; null when there is none. */
export function parseGitlink(lsTree) {
  const match = /^160000 commit ([0-9a-f]{40})\t/.exec(lsTree.trim());
  return match === null ? null : (match[1] ?? null);
}

/**
 * `git ls-remote <url> refs/heads/<branch> refs/tags/*` output as { heads, tags }, both Maps from name
 * to commit. An annotated tag is reported by git twice (the tag object, then `^{}` for the commit it
 * points at); `tags` holds the commit.
 */
export function parseLsRemote(text) {
  const heads = new Map();
  const direct = new Map();
  const peeled = new Map();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{40})\t(\S+)$/.exec(line.trimEnd());
    if (match === null) continue;
    const [, sha = "", ref = ""] = match;
    if (ref.startsWith("refs/heads/")) {
      heads.set(ref.slice("refs/heads/".length), sha);
    } else if (ref.startsWith("refs/tags/")) {
      const name = ref.slice("refs/tags/".length);
      if (name.endsWith("^{}")) peeled.set(name.slice(0, -3), sha);
      else direct.set(name, sha);
    }
  }
  const tags = new Map();
  for (const [name, sha] of direct) tags.set(name, peeled.get(name) ?? sha);
  return { heads, tags };
}

/** { tag } from the JSON of `releases/latest`; throws when it is not a published, final release. */
export function parseLatestRelease(text) {
  let release;
  try {
    release = JSON.parse(text);
  } catch (error) {
    throw new Error(`the release answer is not JSON: ${error.message}`, { cause: error });
  }
  if (release === null || typeof release !== "object" || typeof release.tag_name !== "string") {
    throw new Error("the release answer has no tag_name");
  }
  if (release.draft === true || release.prerelease === true) {
    throw new Error(`release ${release.tag_name} is a draft or a prerelease`);
  }
  if (!TAG.test(release.tag_name)) {
    throw new Error("the latest release has a tag name with unexpected characters");
  }
  return { tag: release.tag_name };
}

/**
 * What `gh api repos/<o>/<r>/releases/latest` said: a release, "none" (the repository has no final
 * release: GitHub answers 404), or an error (anything else, which is never read as "no release").
 */
export function classifyRelease(result) {
  if (result.status === 0) return { kind: "release", ...parseLatestRelease(result.stdout) };
  if (/HTTP 404/.test(result.stderr)) return { kind: "none" };
  return { kind: "error", message: `gh api failed: ${firstLine(result.stderr) || "no message"}` };
}

/** The target of a bump: the release's tag commit, else the head of the branch. Throws when it cannot. */
export function chooseTarget({ release, refs, branch }) {
  if (release.kind === "release") {
    const to = refs.tags.get(release.tag);
    if (to === undefined) {
      throw new Error(`the latest release is ${release.tag} but the repository has no such tag`);
    }
    return { to, toTag: release.tag, reason: "release" };
  }
  const to = refs.heads.get(branch);
  if (to === undefined) {
    throw new Error(`no release, and the branch ${branch} does not exist`);
  }
  return { to, toTag: null, reason: "branch" };
}

/** The version-looking numbers of a tag, for ordering: `v1.10.2` -> [1, 10, 2]. */
function versionOf(tag) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(tag);
  return match === null ? [] : [match[1], match[2] ?? "0", match[3] ?? "0"].map(Number);
}

/** The tag that names `sha`, when one does: the highest version if several do. */
export function tagForSha(tags, sha) {
  const names = [...tags]
    .filter(([name, commit]) => commit === sha && TAG.test(name))
    .map(([name]) => name);
  names.sort((a, b) => {
    const [x, y] = [versionOf(a), versionOf(b)];
    for (let i = 0; i < 3; i += 1) {
      const diff = (y[i] ?? 0) - (x[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.length - b.length || a.localeCompare(b);
  });
  return names[0] ?? null;
}

const firstLine = (text) => (text ?? "").trim().split("\n")[0] ?? "";

/** A message safe to put in Markdown and in a workflow command: one line, no markup characters. */
export function clean(message) {
  return String(message)
    .replaceAll(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replaceAll(/[<>|`&[\]\\]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

// ---- the report ----

const short = (sha) => sha.slice(0, 7);

/** The compare page of two commits. */
export const compareUrl = (repo, from, to) => `${repo}/compare/${from}...${to}`;

/** The Markdown for a pull request body. */
export function renderSummary({ changed, skipped, unchanged }) {
  const out = [];
  if (changed.length === 0) {
    out.push("Nothing to bump: every project is at its target commit.", "");
  } else {
    out.push(
      "Moves each project to its latest release, or, for a project that has no release yet,",
      "to the head of its default branch.",
      "",
      "| Project | From | To | Why | Changes |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const c of changed) {
      const from = c.fromTag === null ? short(c.from) : `\`${c.fromTag}\` (${short(c.from)})`;
      const to = c.toTag === null ? short(c.to) : `\`${c.toTag}\` (${short(c.to)})`;
      const why = c.reason === "release" ? "latest release" : "no release yet: branch head";
      out.push(
        `| [${c.path}](${c.repo}) | ${from} | ${to} | ${why} | [compare](${compareUrl(c.repo, c.from, c.to)}) |`,
      );
    }
    out.push("");
  }
  if (skipped.length > 0) {
    out.push("Skipped (the next run tries again):", "");
    for (const s of skipped) out.push(`- ${s.path}: ${clean(s.error)}`);
    out.push("");
  }
  if (unchanged.length > 0) out.push(`${unchanged.length} project(s) were already up to date.`, "");
  return `${out.join("\n").trimEnd()}\n`;
}

// ---- the work ----

/** Runs a command and returns { status, stdout, stderr }; never throws, never prompts. */
export function systemRunner(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || (result.error === undefined ? "" : String(result.error.message)),
  };
}

/** The commit `project` should be built from, and the refs it was chosen from. Throws on failure. */
export function lookupProject(project, run) {
  const listing = run("git", [
    "ls-remote",
    project.cloneUrl,
    `refs/heads/${project.branch}`,
    "refs/tags/*",
  ]);
  if (listing.status !== 0) {
    throw new Error(`git ls-remote failed: ${firstLine(listing.stderr) || "no message"}`);
  }
  const refs = parseLsRemote(listing.stdout);
  const release = classifyRelease(
    run("gh", ["api", `repos/${project.owner}/${project.name}/releases/latest`]),
  );
  if (release.kind === "error") throw new Error(release.message);
  return { ...chooseTarget({ release, refs, branch: project.branch }), refs };
}

/**
 * Bumps the projects in the working tree at `cwd`. `only` limits it to one path. Returns
 * { changed, skipped, unchanged } (see the top of this file). With `dryRun` nothing is changed.
 */
export function bump({ projects, only, dryRun = false }, { run, exists, cwd, warn = () => {} }) {
  const changed = [];
  const skipped = [];
  const unchanged = [];
  for (const project of projects) {
    if (project.local || (only !== undefined && project.path !== only)) continue;
    const folder = `projects/${project.path}`;
    try {
      const tree = run("git", ["ls-tree", "HEAD", folder], { cwd });
      if (tree.status !== 0) throw new Error(`git ls-tree failed: ${firstLine(tree.stderr)}`);
      const from = parseGitlink(tree.stdout);
      if (from === null) {
        throw new Error(`no submodule at ${folder} in HEAD: add it first (operations guide)`);
      }
      const target = lookupProject(project, run);
      if (!SHA.test(target.to)) throw new Error("the target is not a commit");
      if (target.to === from) {
        unchanged.push(project.path);
        continue;
      }
      if (!dryRun) {
        const update = run(
          "git",
          ["update-index", "--cacheinfo", `160000,${target.to},${folder}`],
          {
            cwd,
          },
        );
        if (update.status !== 0) {
          throw new Error(`git update-index failed: ${firstLine(update.stderr)}`);
        }
        // Only when the submodule is checked out here (a developer's clone): the workflow's is not.
        if (exists(join(cwd, folder, ".git"))) {
          const fetch = run("git", ["fetch", "--depth", "1", "origin", target.to], {
            cwd: join(cwd, folder),
          });
          if (fetch.status !== 0) {
            warn(`${project.path}: could not fetch ${short(target.to)} into ${folder}`);
          }
        }
      }
      changed.push({
        path: project.path,
        repo: project.repo,
        from,
        to: target.to,
        fromTag: tagForSha(target.refs.tags, from),
        toTag: target.toTag,
        reason: target.reason,
      });
    } catch (error) {
      skipped.push({ path: project.path, repo: project.repo, error: clean(error.message) });
    }
  }
  return { changed, skipped, unchanged };
}

const USAGE = [
  "Usage: node scripts/bump-submodules.mjs [--project <path>] [--registry <file>] [--json <file>]",
  "                                        [--summary <file>] [--dry-run]",
].join("\n");

const defaultIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

/** The command line. Returns the exit code. */
export function main(argv, io = defaultIo, env = {}) {
  const {
    run = systemRunner,
    exists = existsSync,
    cwd = process.cwd(),
    // GitHub Actions turns `::warning::` lines into annotations; anywhere else they would be noise.
    actions = process.env.GITHUB_ACTIONS === "true",
  } = env;
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        project: { type: "string" },
        registry: { type: "string", default: "projects.json" },
        json: { type: "string" },
        summary: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.stderr(`bump-submodules: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }

  let projects;
  try {
    projects = parseRegistry(readFileSync(resolve(cwd, values.registry), "utf8"));
  } catch (error) {
    io.stderr(`bump-submodules: ${values.registry}: ${error.message}`);
    return 1;
  }
  if (
    values.project !== undefined &&
    !projects.some((p) => p.path === values.project && !p.local)
  ) {
    io.stderr(`bump-submodules: no project with path "${values.project}" in ${values.registry}`);
    return 2;
  }

  const report = bump(
    { projects, only: values.project, dryRun: values["dry-run"] },
    {
      run,
      exists,
      cwd,
      warn: (message) =>
        io.stderr(actions ? `::warning title=bump::${clean(message)}` : `bump: ${message}`),
    },
  );
  for (const c of report.changed) {
    const label = (tag, sha) => (tag === null ? short(sha) : `${tag} (${short(sha)})`);
    io.stdout(
      `bump: ${c.path}: ${label(c.fromTag, c.from)} -> ${label(c.toTag, c.to)} (${c.reason})`,
    );
  }
  for (const s of report.skipped) {
    io.stderr(
      actions
        ? `::warning title=bump ${s.path}::skipped: ${s.error}`
        : `bump: ${s.path}: skipped: ${s.error}`,
    );
  }
  io.stdout(
    `bump: ${report.changed.length} changed, ${report.unchanged.length} up to date, ${report.skipped.length} skipped${values["dry-run"] ? " (dry run: nothing was changed)" : ""}`,
  );

  try {
    if (values.json !== undefined) {
      writeFileSync(resolve(cwd, values.json), `${JSON.stringify(report, null, 2)}\n`);
    }
    if (values.summary !== undefined) {
      writeFileSync(resolve(cwd, values.summary), renderSummary(report));
    }
  } catch (error) {
    io.stderr(`bump-submodules: cannot write the report: ${error.message}`);
    return 1;
  }
  return 0;
}

// `import.meta.main` exists only on Node 24.2+; this must also run (and not silently pass) on 22.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}
