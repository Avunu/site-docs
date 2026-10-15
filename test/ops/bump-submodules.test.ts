// scripts/bump-submodules.mjs: what it decides (which commit a project should be at, what changed, what
// is skipped) is tested through pure functions and an injectable runner standing in for `git` and `gh`;
// one end-to-end test runs the real script against real git repositories and a fake `gh`.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  bump,
  chooseTarget,
  classifyRelease,
  clean,
  compareUrl,
  lookupProject,
  main,
  parseGitlink,
  parseLatestRelease,
  parseLsRemote,
  parseRegistry,
  renderSummary,
  tagForSha,
  type Project,
  type Report,
  type RunResult,
  type Runner,
} from "../../scripts/bump-submodules.mjs";
import { REPO_ROOT, git, initRepo, isWindows, tempDir } from "../support/index.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

const registryText = (projects: Record<string, unknown>[]): string =>
  JSON.stringify({ domain: "docs.example.test", projects });

const entry = (path: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  path,
  slug: path,
  name: path,
  repo: `https://github.com/Avunu/${path}`,
  branch: "main",
  ...extra,
});

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr: string): RunResult => ({ status: 1, stdout: "", stderr });

describe("parseRegistry", () => {
  test("reads the entries, derives the owner, name and clone address, and flags the local one", () => {
    const projects = parseRegistry(
      registryText([
        entry("alpha"),
        entry("site-docs", { local: true, branch: undefined }),
        entry("beta", { repo: "https://github.com/Avunu/beta.git/" }),
      ]),
    );
    expect(projects.map((p) => p.path)).toEqual(["alpha", "site-docs", "beta"]);
    expect(projects[0]).toEqual({
      path: "alpha",
      repo: "https://github.com/Avunu/alpha",
      owner: "Avunu",
      name: "alpha",
      cloneUrl: "https://github.com/Avunu/alpha.git",
      branch: "main",
      local: false,
    });
    expect(projects[1]?.local).toBe(true);
    expect(projects[2]?.repo).toBe("https://github.com/Avunu/beta");
  });

  test.each([
    ["not JSON", "{", /not valid JSON/],
    ["no projects array", "{}", /"projects" array/],
    ["a path with a capital", registryText([entry("Alpha")]), /"path"/],
    ["a path with a slash", registryText([entry("a/b")]), /"path"/],
    ["a path listed twice", registryText([entry("a"), entry("a")]), /listed twice/],
    [
      "a repo that is not on GitHub",
      registryText([entry("a", { repo: "https://x.test/a" })]),
      /"repo"/,
    ],
    ["no branch", registryText([entry("a", { branch: undefined })]), /"branch"/],
    ["a branch with a space", registryText([entry("a", { branch: "a b" })]), /"branch"/],
  ])("refuses %s", (_what, text, message) => {
    expect(() => parseRegistry(text)).toThrow(message);
  });
});

describe("reading git", () => {
  test("parseGitlink reads the commit of a gitlink and nothing else", () => {
    expect(parseGitlink(`160000 commit ${A}\tprojects/alpha\n`)).toBe(A);
    expect(parseGitlink(`100644 blob ${A}\tprojects/alpha\n`)).toBeNull();
    expect(parseGitlink("")).toBeNull();
  });

  test("parseLsRemote keeps heads, and peels annotated tags to their commit", () => {
    const refs = parseLsRemote(
      [
        `${A}\trefs/heads/main`,
        `${B}\trefs/heads/develop`,
        `${C}\trefs/tags/v1.0.0`, // an annotated tag: the tag object ...
        `${D}\trefs/tags/v1.0.0^{}`, // ... and the commit it points at
        `${A}\trefs/tags/v0.9.0`, // a lightweight tag
        "not a ref line",
      ].join("\n"),
    );
    expect([...refs.heads]).toEqual([
      ["main", A],
      ["develop", B],
    ]);
    expect([...refs.tags]).toEqual([
      ["v1.0.0", D],
      ["v0.9.0", A],
    ]);
  });

  test("tagForSha names the commit by its highest version, and by nothing unsafe", () => {
    const tags = new Map([
      ["v1.2.0", A],
      ["v1.10.0", A],
      ["v1.9.0", B],
      ["weird<tag>", C],
    ]);
    expect(tagForSha(tags, A)).toBe("v1.10.0");
    expect(tagForSha(tags, B)).toBe("v1.9.0");
    expect(tagForSha(tags, C)).toBeNull();
    expect(tagForSha(tags, D)).toBeNull();
  });
});

describe("reading gh", () => {
  test("parseLatestRelease takes the tag of a final release", () => {
    expect(parseLatestRelease(JSON.stringify({ tag_name: "v1.2.3", draft: false }))).toEqual({
      tag: "v1.2.3",
    });
  });

  test.each([
    ["a prerelease", { tag_name: "v1", prerelease: true }, /prerelease/],
    ["a draft", { tag_name: "v1", draft: true }, /draft/],
    ["no tag", { name: "x" }, /tag_name/],
    ["a tag with markup", { tag_name: "v1<b>" }, /unexpected characters/],
  ])("refuses %s", (_what, release, message) => {
    expect(() => parseLatestRelease(JSON.stringify(release))).toThrow(message);
  });

  test("classifyRelease: a 404 is no release; any other failure is an error, never 'no release'", () => {
    expect(classifyRelease(ok(JSON.stringify({ tag_name: "v2.0.0" })))).toEqual({
      kind: "release",
      tag: "v2.0.0",
    });
    expect(classifyRelease(fail("gh: Not Found (HTTP 404)"))).toEqual({ kind: "none" });
    expect(classifyRelease(fail("gh: Bad Gateway (HTTP 502)"))).toMatchObject({ kind: "error" });
    expect(classifyRelease(fail("gh: To use GitHub CLI, set GH_TOKEN"))).toMatchObject({
      kind: "error",
    });
  });
});

describe("chooseTarget", () => {
  const refs = parseLsRemote(`${A}\trefs/heads/main\n${B}\trefs/tags/v1.0.0`);

  test("a release wins over the branch, and its tag must exist", () => {
    expect(
      chooseTarget({ release: { kind: "release", tag: "v1.0.0" }, refs, branch: "main" }),
    ).toEqual({
      to: B,
      toTag: "v1.0.0",
      reason: "release",
    });
    expect(() =>
      chooseTarget({ release: { kind: "release", tag: "v9.9.9" }, refs, branch: "main" }),
    ).toThrow(/no such tag/);
  });

  test("with no release the head of the branch is the target, and the branch must exist", () => {
    expect(chooseTarget({ release: { kind: "none" }, refs, branch: "main" })).toEqual({
      to: A,
      toTag: null,
      reason: "branch",
    });
    expect(() => chooseTarget({ release: { kind: "none" }, refs, branch: "develop" })).toThrow(
      /does not exist/,
    );
  });
});

describe("clean", () => {
  test("makes a message safe for Markdown and for a workflow command", () => {
    expect(clean("a <b>x</b> | `c`\n[d](e)\u0007")).toBe("a b x /b c d (e)");
    expect(clean("x".repeat(500))).toHaveLength(240);
  });
});

describe("renderSummary", () => {
  const report: Report = {
    changed: [
      {
        path: "alpha",
        repo: "https://github.com/Avunu/alpha",
        from: A,
        to: B,
        fromTag: "v1.0.0",
        toTag: "v1.1.0",
        reason: "release",
      },
      {
        path: "beta",
        repo: "https://github.com/Avunu/beta",
        from: C,
        to: D,
        fromTag: null,
        toTag: null,
        reason: "branch",
      },
    ],
    skipped: [{ path: "gamma", repo: "https://github.com/Avunu/gamma", error: "boom <x>" }],
    unchanged: ["delta", "epsilon"],
  };

  test("lists each project old to new with a compare link, the skipped ones and the count that were current", () => {
    const text = renderSummary(report);
    expect(text).toContain("| Project | From | To | Why | Changes |");
    expect(text).toContain(
      `| [alpha](https://github.com/Avunu/alpha) | \`v1.0.0\` (aaaaaaa) | \`v1.1.0\` (bbbbbbb) | latest release | [compare](https://github.com/Avunu/alpha/compare/${A}...${B}) |`,
    );
    expect(text).toContain(
      "| [beta](https://github.com/Avunu/beta) | ccccccc | ddddddd | no release yet: branch head |",
    );
    expect(text).toContain("- gamma: boom x");
    expect(text).not.toContain("<x>");
    expect(text).toContain("2 project(s) were already up to date.");
    expect(text.endsWith("\n")).toBe(true);
  });

  test("says so when there is nothing to bump", () => {
    expect(renderSummary({ changed: [], skipped: [], unchanged: ["a"] })).toBe(
      "Nothing to bump: every project is at its target commit.\n\n1 project(s) were already up to date.\n",
    );
  });

  test("compareUrl is GitHub's compare page", () => {
    expect(compareUrl("https://github.com/o/r", "a", "b")).toBe(
      "https://github.com/o/r/compare/a...b",
    );
  });
});

// ---- bump(): the whole decision, against a fake runner ----

interface Fake {
  /** Per project name: the release answer of `gh` and the output of `git ls-remote`. */
  remotes: Record<string, { release: RunResult; refs: string | RunResult }>;
  /** The gitlinks HEAD records, by folder. */
  gitlinks: Record<string, string>;
  calls: string[][];
  run: Runner;
}

function fake(
  remotes: Fake["remotes"],
  gitlinks: Fake["gitlinks"],
  failUpdate: string[] = [],
): Fake {
  const calls: string[][] = [];
  const run: Runner = (command, args) => {
    calls.push([command, ...args]);
    if (command === "git" && args[0] === "ls-tree") {
      const folder = args[2] ?? "";
      const at = gitlinks[folder];
      return ok(at === undefined ? "" : `160000 commit ${at}\t${folder}\n`);
    }
    if (command === "git" && args[0] === "ls-remote") {
      const name = /\/([^/]+)\.git$/.exec(args[1] ?? "")?.[1] ?? "";
      const refs = remotes[name]?.refs;
      if (refs === undefined) return fail("fatal: repository not found");
      return typeof refs === "string" ? ok(refs) : refs;
    }
    if (command === "gh") {
      const name = /repos\/[^/]+\/([^/]+)\/releases\/latest/.exec(args[1] ?? "")?.[1] ?? "";
      return remotes[name]?.release ?? fail("gh: Not Found (HTTP 404)");
    }
    if (command === "git" && args[0] === "update-index") {
      return failUpdate.some((folder) => (args[2] ?? "").endsWith(folder))
        ? fail("error: cannot update")
        : ok("");
    }
    return ok("");
  };
  return { remotes, gitlinks, calls, run };
}

const refsOf = (heads: Record<string, string>, tags: Record<string, string> = {}): string =>
  [
    ...Object.entries(heads).map(([name, at]) => `${at}\trefs/heads/${name}`),
    ...Object.entries(tags).map(([name, at]) => `${at}\trefs/tags/${name}`),
  ].join("\n");

const release = (tag: string): RunResult => ok(JSON.stringify({ tag_name: tag }));
const noRelease = fail("gh: Not Found (HTTP 404)");

const projectsOf = (...paths: string[]): Project[] =>
  parseRegistry(registryText(paths.map((path) => entry(path))));

const updates = (f: Fake): string[] =>
  f.calls.filter((c) => c[1] === "update-index").map((c) => `${c[3]}`);

describe("bump", () => {
  const environment = (f: Fake, initialised: string[] = []) => ({
    run: f.run,
    exists: (path: string) => initialised.some((folder) => path.endsWith(`${folder}/.git`)),
    cwd: "/work",
  });

  test("moves a project to its latest release, a project without one to its branch head, and leaves a current one", () => {
    const f = fake(
      {
        alpha: {
          release: release("v1.1.0"),
          refs: refsOf({ main: C }, { "v1.0.0": A, "v1.1.0": B }),
        },
        beta: { release: noRelease, refs: refsOf({ main: D }) },
        delta: { release: release("v2.0.0"), refs: refsOf({ main: C }, { "v2.0.0": B }) },
      },
      {
        "projects/alpha": A,
        "projects/beta": C,
        "projects/delta": B,
      },
    );
    const report = bump({ projects: projectsOf("alpha", "beta", "delta") }, environment(f));
    expect(report.changed).toEqual([
      {
        path: "alpha",
        repo: "https://github.com/Avunu/alpha",
        from: A,
        to: B,
        fromTag: "v1.0.0",
        toTag: "v1.1.0",
        reason: "release",
      },
      {
        path: "beta",
        repo: "https://github.com/Avunu/beta",
        from: C,
        to: D,
        fromTag: null,
        toTag: null,
        reason: "branch",
      },
    ]);
    expect(report.unchanged).toEqual(["delta"]);
    expect(report.skipped).toEqual([]);
    expect(updates(f)).toEqual([`160000,${B},projects/alpha`, `160000,${D},projects/beta`]);
  });

  test("never writes anything but the index: no commit, no add, no checkout", () => {
    const f = fake(
      { alpha: { release: release("v1"), refs: refsOf({ main: C }, { v1: B }) } },
      { "projects/alpha": A },
    );
    bump({ projects: projectsOf("alpha") }, environment(f));
    const verbs = f.calls.filter((c) => c[0] === "git").map((c) => c[1]);
    expect(new Set(verbs)).toEqual(new Set(["ls-tree", "ls-remote", "update-index"]));
  });

  test("a failed lookup is reported and skipped, and the other projects are still bumped", () => {
    const f = fake(
      {
        alpha: { release: fail("gh: Bad Gateway (HTTP 502)"), refs: refsOf({ main: C }) },
        beta: { release: release("v1.0.0"), refs: refsOf({ main: C }) }, // tag missing
        delta: { release: noRelease, refs: refsOf({ main: D }) },
        epsilon: { release: noRelease, refs: fail("fatal: unable to access") },
      },
      {
        "projects/alpha": A,
        "projects/beta": A,
        "projects/delta": A,
        "projects/epsilon": A,
        "projects/zeta": A, // no remote at all
      },
    );
    const report = bump(
      { projects: projectsOf("alpha", "beta", "delta", "epsilon", "zeta") },
      environment(f),
    );
    expect(report.changed.map((c) => c.path)).toEqual(["delta"]);
    expect(report.skipped.map((s) => [s.path, s.error])).toEqual([
      ["alpha", expect.stringContaining("gh api failed: gh: Bad Gateway (HTTP 502)")],
      ["beta", expect.stringContaining("no such tag")],
      ["epsilon", expect.stringContaining("git ls-remote failed")],
      ["zeta", expect.stringContaining("git ls-remote failed")],
    ]);
    expect(updates(f)).toEqual([`160000,${D},projects/delta`]);
  });

  test("a project without a gitlink is skipped with a message that says what to do", () => {
    const f = fake({ alpha: { release: noRelease, refs: refsOf({ main: C }) } }, {});
    const report = bump({ projects: projectsOf("alpha") }, environment(f));
    expect(report.changed).toEqual([]);
    expect(report.skipped[0]?.error).toContain("no submodule at projects/alpha");
    expect(updates(f)).toEqual([]);
  });

  test("a failing git update-index is a skipped project, not a changed one", () => {
    const f = fake(
      { alpha: { release: noRelease, refs: refsOf({ main: C }) } },
      { "projects/alpha": A },
      ["projects/alpha"],
    );
    const report = bump({ projects: projectsOf("alpha") }, environment(f));
    expect(report.changed).toEqual([]);
    expect(report.skipped[0]?.error).toContain("git update-index failed");
  });

  test("--project limits the run to one project; a local project is never bumped", () => {
    const f = fake(
      {
        alpha: { release: noRelease, refs: refsOf({ main: C }) },
        beta: { release: noRelease, refs: refsOf({ main: C }) },
      },
      { "projects/alpha": A, "projects/beta": A },
    );
    const projects = parseRegistry(
      registryText([entry("alpha"), entry("beta"), entry("site-docs", { local: true })]),
    );
    expect(bump({ projects, only: "beta" }, environment(f)).changed.map((c) => c.path)).toEqual([
      "beta",
    ]);
    expect(f.calls.some((c) => c.join(" ").includes("alpha"))).toBe(false);
    const all = bump({ projects }, environment(f));
    expect(all.changed.map((c) => c.path)).toEqual(["alpha", "beta"]);
    expect(f.calls.flat().some((part) => part.includes("site-docs"))).toBe(false);
  });

  test("a dry run reports the same and changes nothing", () => {
    const f = fake(
      { alpha: { release: noRelease, refs: refsOf({ main: C }) } },
      { "projects/alpha": A },
    );
    const report = bump(
      { projects: projectsOf("alpha"), dryRun: true },
      environment(f, ["projects/alpha"]),
    );
    expect(report.changed).toHaveLength(1);
    expect(updates(f)).toEqual([]);
    expect(f.calls.some((c) => c[1] === "fetch")).toBe(false);
  });

  test("fetches the one commit into a submodule that is initialised, and into no other", () => {
    const f = fake(
      {
        alpha: { release: noRelease, refs: refsOf({ main: C }) },
        beta: { release: noRelease, refs: refsOf({ main: C }) },
      },
      { "projects/alpha": A, "projects/beta": A },
    );
    const warnings: string[] = [];
    bump(
      { projects: projectsOf("alpha", "beta") },
      { ...environment(f, ["projects/alpha"]), warn: (m) => warnings.push(m) },
    );
    expect(f.calls.filter((c) => c[1] === "fetch")).toEqual([
      ["git", "fetch", "--depth", "1", "origin", C],
    ]);
    expect(warnings).toEqual([]);
  });

  test("lookupProject asks for one branch and the tags of the clone address, then for the latest release", () => {
    const f = fake({ alpha: { release: release("v1"), refs: refsOf({ main: C }, { v1: B }) } }, {});
    const [project] = projectsOf("alpha");
    expect(lookupProject(project as Project, f.run).to).toBe(B);
    expect(f.calls).toEqual([
      ["git", "ls-remote", "https://github.com/Avunu/alpha.git", "refs/heads/main", "refs/tags/*"],
      ["gh", "api", "repos/Avunu/alpha/releases/latest"],
    ]);
  });
});

// ---- main(): files, messages, exit codes ----

describe("main", () => {
  function workspace(): { cwd: string; io: { out: string[]; err: string[] } } {
    const cwd = tempDir();
    writeFileSync(join(cwd, "projects.json"), registryText([entry("alpha"), entry("beta")]));
    return { cwd, io: { out: [], err: [] } };
  }
  const ioOf = (io: { out: string[]; err: string[] }) => ({
    stdout: (line: string) => io.out.push(line),
    stderr: (line: string) => io.err.push(line),
  });

  test("writes the JSON report and the Markdown summary, prints one line per change, exits 0", () => {
    const { cwd, io } = workspace();
    const f = fake(
      {
        alpha: {
          release: release("v1.1.0"),
          refs: refsOf({ main: C }, { "v1.0.0": A, "v1.1.0": B }),
        },
        beta: { release: noRelease, refs: refsOf({ main: C }) },
      },
      { "projects/alpha": A, "projects/beta": C },
    );
    mkdirSync(join(cwd, "out"));
    const argv = ["--json", "out/bump.json", "--summary", join(cwd, "bump.md")];
    expect(main(argv, ioOf(io), { run: f.run, cwd })).toBe(0);
    const report = JSON.parse(readFileSync(join(cwd, "out", "bump.json"), "utf8")) as Report;
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]).toMatchObject({
      path: "alpha",
      fromTag: "v1.0.0",
      toTag: "v1.1.0",
      reason: "release",
    });
    expect(report.unchanged).toEqual(["beta"]);
    expect(readFileSync(join(cwd, "bump.md"), "utf8")).toContain(
      "[alpha](https://github.com/Avunu/alpha)",
    );
    expect(io.out).toEqual([
      "bump: alpha: v1.0.0 (aaaaaaa) -> v1.1.0 (bbbbbbb) (release)",
      "bump: 1 changed, 1 up to date, 0 skipped",
    ]);
  });

  test("a report that cannot be written is the one hard failure, exit 1", () => {
    const { cwd, io } = workspace();
    const f = fake({}, {});
    expect(main(["--json", "no/such/folder/bump.json"], ioOf(io), { run: f.run, cwd })).toBe(1);
    expect(io.err.join("\n")).toContain("cannot write the report");
  });

  test("exits 0 when a lookup fails, and says which project was skipped", () => {
    const { cwd, io } = workspace();
    const f = fake({}, { "projects/alpha": A, "projects/beta": A });
    expect(main([], ioOf(io), { run: f.run, cwd })).toBe(0);
    expect(io.err.join("\n")).toMatch(/bump: alpha: skipped: git ls-remote failed/);
    expect(io.out.at(-1)).toBe("bump: 0 changed, 0 up to date, 2 skipped");
  });

  test("a usage error is 2, an unreadable registry is 1, an unknown --project is 2", () => {
    const { cwd, io } = workspace();
    const f = fake({}, {});
    expect(main(["--nope"], ioOf(io), { run: f.run, cwd })).toBe(2);
    expect(main(["--project", "gamma"], ioOf(io), { run: f.run, cwd })).toBe(2);
    expect(main(["--registry", "missing.json"], ioOf(io), { run: f.run, cwd })).toBe(1);
    writeFileSync(join(cwd, "bad.json"), "{}");
    expect(main(["--registry", "bad.json"], ioOf(io), { run: f.run, cwd })).toBe(1);
    expect(f.calls).toEqual([]);
  });
});

// ---- the real script against real git repositories and a fake gh ----

/** A bare repository `name.git` with three commits: v1.0.0 (annotated), v1.1.0 (lightweight) and an unreleased one. */
function remote(root: string, name: string): { bare: string; commits: [string, string, string] } {
  const work = join(root, "work", name);
  mkdirSync(work, { recursive: true });
  initRepo(work);
  const commits: string[] = [];
  for (const index of [1, 2, 3]) {
    writeFileSync(join(work, "README.md"), `${name} ${index}\n`);
    git(work, "add", ".");
    git(work, "commit", "--quiet", "-m", `commit ${index}`);
    commits.push(git(work, "rev-parse", "HEAD"));
    if (index === 1) git(work, "tag", "-a", "v1.0.0", "-m", "one");
    if (index === 2) git(work, "tag", "v1.1.0");
  }
  const bare = join(root, "remotes", `${name}.git`);
  mkdirSync(join(root, "remotes"), { recursive: true });
  git(root, "clone", "--quiet", "--bare", work, bare);
  git(bare, "config", "uploadpack.allowReachableSHA1InWant", "true");
  return { bare, commits: commits as [string, string, string] };
}

/** A workspace with only gitlinks in the index (no submodule checked out), remotes rewritten to the local bare ones. */
function workspaceOf(root: string, pins: Record<string, string>): string {
  const space = join(root, "space");
  mkdirSync(space);
  initRepo(space);
  writeFileSync(
    join(space, "projects.json"),
    registryText(Object.keys(pins).map((path) => entry(path))),
  );
  git(space, "add", "projects.json");
  for (const [path, at] of Object.entries(pins)) {
    git(space, "update-index", "--add", "--cacheinfo", `160000,${at},projects/${path}`);
    git(
      space,
      "config",
      `url.${join(root, "remotes", `${path}.git`)}.insteadOf`,
      `https://github.com/Avunu/${path}.git`,
    );
  }
  git(space, "commit", "--quiet", "-m", "seed");
  return space;
}

/** A folder with a fake `gh` that answers `releases/latest` from `answers` (repository name to a shell snippet). */
function fakeGh(root: string, answers: Record<string, string>): string {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const cases = Object.entries(answers)
    .map(([name, body]) => `  "api repos/Avunu/${name}/releases/latest") ${body} ;;`)
    .join("\n");
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
case "$*" in
${cases}
  *) echo 'gh: Bad Gateway (HTTP 502)' >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

const NOT_FOUND = `echo '{"message":"Not Found"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1`;
const latest = (tag: string): string =>
  `echo '{"tag_name":"${tag}","draft":false,"prerelease":false}'`;

function runScript(space: string, bin: string, args: string[]) {
  return spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "bump-submodules.mjs"), ...args], {
    cwd: space,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: space,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
}

describe.skipIf(isWindows)(
  "the script end to end: a clone WITHOUT submodules, real git, fake gh",
  () => {
    test("moves the gitlinks in the index, reports them, and leaves the working tree and HEAD alone", () => {
      const root = tempDir();
      const [a1, a2] = remote(root, "alpha").commits; // released: v1.1.0 is its latest release
      const [b1, , b3] = remote(root, "beta").commits; // no release: pinned to the head of main
      const [, d2] = remote(root, "delta").commits; // already at its release
      const [g1] = remote(root, "gamma").commits; // the release lookup fails
      const space = workspaceOf(root, { alpha: a1, beta: b1, delta: d2, gamma: g1 });
      const bin = fakeGh(root, {
        alpha: latest("v1.1.0"),
        delta: latest("v1.1.0"),
        beta: NOT_FOUND,
      });
      const head = git(space, "rev-parse", "HEAD");

      const result = runScript(space, bin, ["--json", "bump.json", "--summary", "bump.md"]);
      expect(result.status, result.stderr).toBe(0);

      const report = JSON.parse(readFileSync(join(space, "bump.json"), "utf8")) as Report;
      expect(report.changed).toEqual([
        {
          path: "alpha",
          repo: "https://github.com/Avunu/alpha",
          from: a1,
          to: a2,
          fromTag: "v1.0.0", // the annotated tag, peeled to its commit
          toTag: "v1.1.0",
          reason: "release",
        },
        {
          path: "beta",
          repo: "https://github.com/Avunu/beta",
          from: b1,
          to: b3,
          fromTag: "v1.0.0",
          toTag: null,
          reason: "branch",
        },
      ]);
      expect(report.unchanged).toEqual(["delta"]);
      expect(report.skipped.map((s) => s.path)).toEqual(["gamma"]);
      expect(report.skipped[0]?.error).toContain("HTTP 502");

      // The index records the new commits; HEAD does not; no submodule was checked out.
      const staged = git(space, "diff", "--cached", "--raw", "--no-abbrev")
        .split("\n")
        .map((line) => line.split(/\s+/));
      expect(staged.map((cols) => [cols[1], cols[3], cols[4], cols[5]])).toEqual([
        ["160000", a2, "M", "projects/alpha"],
        ["160000", b3, "M", "projects/beta"],
      ]);
      expect(git(space, "rev-parse", "HEAD")).toBe(head);
      expect(existsSync(join(space, "projects"))).toBe(false);
      const summary = readFileSync(join(space, "bump.md"), "utf8");
      expect(summary).toContain(`compare/${a1}...${a2}`);
      expect(summary).toContain("Skipped (the next run tries again)");

      // The caller commits the index: exactly the two gitlinks change.
      git(space, "commit", "--quiet", "-m", "chore(docs): bump 2 project(s)");
      expect(git(space, "diff", "--name-status", "HEAD~1", "HEAD")).toBe(
        "M\tprojects/alpha\nM\tprojects/beta",
      );

      // A second run finds nothing left to do.
      expect(runScript(space, bin, ["--json", "again.json"]).status).toBe(0);
      const second = JSON.parse(readFileSync(join(space, "again.json"), "utf8")) as Report;
      expect(second.changed).toEqual([]);
      expect(second.unchanged.sort()).toEqual(["alpha", "beta", "delta"]);
    });

    test("--project bumps one project and --dry-run changes nothing", () => {
      const root = tempDir();
      const [a1, a2] = remote(root, "alpha").commits;
      const [b1] = remote(root, "beta").commits;
      const space = workspaceOf(root, { alpha: a1, beta: b1 });
      const bin = fakeGh(root, { alpha: latest("v1.1.0"), beta: latest("v1.1.0") });

      expect(runScript(space, bin, ["--dry-run", "--json", "dry.json"]).status).toBe(0);
      const dry = JSON.parse(readFileSync(join(space, "dry.json"), "utf8")) as Report;
      expect(dry.changed.map((c) => c.path)).toEqual(["alpha", "beta"]);
      expect(git(space, "diff", "--cached", "--name-only")).toBe("");

      expect(runScript(space, bin, ["--project", "alpha"]).status).toBe(0);
      expect(git(space, "diff", "--cached", "--name-only")).toBe("projects/alpha");
      expect(git(space, "ls-files", "--stage", "projects/alpha")).toContain(a2);
      expect(runScript(space, bin, ["--project", "nope"]).status).toBe(2);
    });

    test("fetches the commit into a submodule that happens to be initialised", () => {
      const root = tempDir();
      const alpha = remote(root, "alpha");
      const [a1, a2] = alpha.commits;
      const space = workspaceOf(root, { alpha: a1 });
      // An initialised submodule: a shallow clone at projects/alpha, which has only the head commit.
      mkdirSync(join(space, "projects"));
      const folder = join(space, "projects", "alpha");
      git(root, "clone", "--quiet", "--depth", "1", `file://${alpha.bare}`, folder);
      expect(() => git(folder, "cat-file", "-e", a2)).toThrow();
      const bin = fakeGh(root, { alpha: latest("v1.1.0") });

      const result = runScript(space, bin, []);
      expect(result.status, result.stderr).toBe(0);
      expect(git(space, "ls-files", "--stage", "projects/alpha")).toContain(a2);
      expect(git(folder, "cat-file", "-t", a2)).toBe("commit");
    });
  },
);
