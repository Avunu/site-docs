// scripts/seed-workspace.mjs: the mapping from a repository's config file to a registry entry, the
// registry and .gitmodules it renders, and the command line, which runs against a fake `gh` and a real
// git repository (never against GitHub).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRegistry, systemRunner, type Runner } from "../../scripts/bump-submodules.mjs";
import {
  DEFAULT_HEADER,
  SELF_PATH,
  main,
  mergeRegistry,
  pathFromDomain,
  projectFromConfig,
  readProject,
  renderGitmodules,
  renderRegistry,
  repoFromRemote,
  type Entry,
} from "../../scripts/seed-workspace.mjs";
import { git, initRepo, tempDir } from "../support/index.js";

const config = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    $schema: "./node_modules/@avunu/docusystem/config.schema.json",
    name: "Carbon Frappe",
    tagline: "A theme for Frappe.",
    slug: "carbon_frappe",
    platform: "frappe",
    repo: "https://github.com/Avunu/carbon_frappe",
    domain: "carbon-theme.avunu.net",
    license: "MIT",
    ...extra,
  });

const entry = (path: string, extra: Partial<Entry> = {}): Entry => ({
  path,
  slug: path.replaceAll("-", "_"),
  name: path,
  tagline: `About ${path}.`,
  platform: "general",
  repo: `https://github.com/Avunu/${path}`,
  license: "MIT",
  branch: "main",
  docs: "docs",
  ...extra,
});

describe("pathFromDomain", () => {
  test("is the first label of the domain, which carries the planned name", () => {
    expect(pathFromDomain("carbon-theme.avunu.net")).toBe("carbon-theme");
    expect(pathFromDomain("frappe-nix.avunu.net")).toBe("frappe-nix");
    expect(pathFromDomain("docs")).toBe("docs");
  });

  test.each([
    undefined,
    null,
    "",
    3,
    "Carbon.avunu.net",
    ".avunu.net",
    "-x.avunu.net",
    "a_b.avunu.net",
  ])("refuses %s", (domain) => {
    expect(() => pathFromDomain(domain)).toThrow();
  });
});

describe("projectFromConfig", () => {
  test("takes name, tagline, slug, platform, repo and license from the file, and the path from its domain", () => {
    expect(projectFromConfig(config(), { branch: "develop" })).toEqual({
      path: "carbon-theme",
      slug: "carbon_frappe",
      name: "Carbon Frappe",
      tagline: "A theme for Frappe.",
      platform: "frappe",
      repo: "https://github.com/Avunu/carbon_frappe",
      license: "MIT",
      branch: "develop",
      docs: "docs",
    });
  });

  test("the workspace repository itself is `local`, under the path it is given, whatever its domain says", () => {
    const own = projectFromConfig(config({ domain: "docusystem.avunu.net" }), {
      branch: "main",
      pathOverride: SELF_PATH,
    });
    expect(own).toMatchObject({ path: "site-docs", local: true, branch: "main" });
    expect(Object.keys(own).at(-1)).toBe("local");
    // No domain is needed for it.
    expect(
      projectFromConfig(config({ domain: undefined }), { branch: "main", pathOverride: SELF_PATH })
        .path,
    ).toBe("site-docs");
  });

  test.each([
    ["not JSON", "{", /not valid JSON/],
    ["not an object", "[]", /not an object/],
    ["no name", config({ name: "" }), /no "name"/],
    ["no tagline", config({ tagline: undefined }), /no "tagline"/],
    ["no license", config({ license: " " }), /no "license"/],
    ["no domain", config({ domain: undefined }), /"domain"/],
    ["an unknown platform", config({ platform: "linux" }), /"platform" must be one of/],
    ["a slug with a capital", config({ slug: "Carbon" }), /"slug"/],
    ["a repo that is not on GitHub", config({ repo: "https://example.test/x" }), /"repo"/],
    ["markup in the tagline", config({ tagline: "a <b>b</b>" }), /markup/],
    ["a template expression in the name", config({ name: "${process.env.X}" }), /markup/],
    ["a control character in the license", config({ license: "MIT\u0007" }), /markup/],
  ])("refuses %s", (_what, text, message) => {
    expect(() => projectFromConfig(text, { branch: "main" })).toThrow(message);
  });

  test("refuses a missing default branch", () => {
    expect(() => projectFromConfig(config(), { branch: "" })).toThrow(/default branch/);
  });
});

describe("mergeRegistry and renderRegistry", () => {
  test("a new registry has the default header and the entries sorted by path, keys in the documented order", () => {
    const registry = mergeRegistry(null, [
      entry("zeta"),
      entry("alpha"),
      entry("site-docs", { local: true }),
    ]);
    expect(registry).toMatchObject({ ...DEFAULT_HEADER });
    expect(registry.projects.map((p) => p.path)).toEqual(["alpha", "site-docs", "zeta"]);
    expect(Object.keys(registry.projects[1] ?? {})).toEqual([
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
    ]);
    expect(renderRegistry(registry).endsWith("}\n")).toBe(true);
    expect(JSON.parse(renderRegistry(registry))).toEqual(registry);
  });

  test("keeps the header and the entries a maintainer already has, adds only the new ones", () => {
    const existing = {
      domain: "docs.example.test",
      name: "Mine",
      tagline: "Edited.",
      org: "https://github.com/Mine",
      projects: [entry("alpha", { tagline: "Edited by hand." })],
    };
    const merged = mergeRegistry(existing, [entry("alpha"), entry("beta")]);
    expect(merged).toMatchObject({
      domain: "docs.example.test",
      name: "Mine",
      org: "https://github.com/Mine",
    });
    expect(merged.projects.map((p) => [p.path, p.tagline])).toEqual([
      ["alpha", "Edited by hand."],
      ["beta", "About beta."],
    ]);
  });

  test("--refresh replaces the existing entries with fresh ones, and keeps one that is no longer listed", () => {
    const existing = { projects: [entry("alpha", { tagline: "Old." }), entry("gone")] };
    const merged = mergeRegistry(existing, [entry("alpha")], { refresh: true });
    expect(merged.projects.map((p) => [p.path, p.tagline])).toEqual([
      ["alpha", "About alpha."],
      ["gone", "About gone."],
    ]);
  });

  test("is idempotent: merging a registry with the entries it was made from changes nothing", () => {
    const first = mergeRegistry(null, [entry("beta"), entry("alpha")]);
    const second = mergeRegistry(JSON.parse(renderRegistry(first)) as typeof first, [
      entry("alpha"),
      entry("beta"),
    ]);
    expect(renderRegistry(second)).toBe(renderRegistry(first));
  });

  test("two repositories with one domain label, or one slug, are an error that names both", () => {
    expect(() => mergeRegistry(null, [entry("alpha"), entry("alpha")])).toThrow(
      /same path|path "alpha"/,
    );
    expect(() =>
      mergeRegistry(null, [entry("alpha", { slug: "x" }), entry("beta", { slug: "x" })]),
    ).toThrow(/"alpha" and "beta" have the same slug "x"/);
  });

  test("the output is what the bump script reads", () => {
    const text = renderRegistry(
      mergeRegistry(null, [entry("alpha"), entry("site-docs", { local: true })]),
    );
    expect(parseRegistry(text).map((p) => [p.path, p.local])).toEqual([
      ["alpha", false],
      ["site-docs", true],
    ]);
  });
});

describe("renderGitmodules", () => {
  const projects = [
    { path: "alpha", repo: "https://github.com/Avunu/alpha_x", branch: "develop" },
    { path: "site-docs", repo: "https://github.com/Avunu/docusystem", branch: "main", local: true },
    { path: "beta", repo: "https://github.com/Avunu/beta", branch: "main" },
  ];

  test("one shallow section per project that is not local, following the project's branch", () => {
    expect(renderGitmodules(null, projects)).toBe(
      [
        '[submodule "projects/alpha"]',
        "\tpath = projects/alpha",
        "\turl = https://github.com/Avunu/alpha_x.git",
        "\tbranch = develop",
        "\tshallow = true",
        '[submodule "projects/beta"]',
        "\tpath = projects/beta",
        "\turl = https://github.com/Avunu/beta.git",
        "\tbranch = main",
        "\tshallow = true",
        "",
      ].join("\n"),
    );
  });

  test("is idempotent, drops a project that was removed, and leaves sections outside projects/ alone", () => {
    const first = renderGitmodules(
      '[submodule "vendor/x"]\n\tpath = vendor/x\n\turl = https://example.test/x.git\n',
      projects,
    );
    expect(first.startsWith('[submodule "vendor/x"]')).toBe(true);
    expect(renderGitmodules(first, projects)).toBe(first);
    const without = renderGitmodules(
      first,
      projects.filter((p) => p.path !== "beta"),
    );
    expect(without).toContain("projects/alpha");
    expect(without).not.toContain("projects/beta");
    expect(without).toContain('[submodule "vendor/x"]');
  });
});

describe("repoFromRemote", () => {
  test.each([
    ["https://github.com/Avunu/docusystem.git", "Avunu/docusystem"],
    ["https://github.com/Avunu/site-docs\n", "Avunu/site-docs"],
    ["git@github.com:Avunu/docusystem.git", "Avunu/docusystem"],
    ["https://example.test/x/y.git", null],
  ])("%s", (url, expected) => {
    expect(repoFromRemote(url)).toBe(expected);
  });
});

// ---- the command line ----

interface Repo {
  config: string | null;
  branch: string;
  release?: string;
}

const TIP = "1".repeat(40);
const TAGGED = "2".repeat(40);

/** `gh` and `git ls-remote` answered from `repos`; every other git command runs for real. */
function runnerFor(repos: Record<string, Repo>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (command, args, options) => {
    calls.push([command, ...args]);
    const named = (text: string | undefined): Repo | undefined => {
      const name = /(?:repos\/|view |github\.com\/)([^/\s]+\/[^/\s.]+)/.exec(text ?? "")?.[1];
      return name === undefined ? undefined : repos[name];
    };
    if (command === "gh" && args[0] === "repo") {
      const repo = repos[args[2] ?? ""];
      return repo === undefined
        ? { status: 1, stdout: "", stderr: "Could not resolve to a Repository" }
        : { status: 0, stdout: `${repo.branch}\n`, stderr: "" };
    }
    if (command === "gh" && args[0] === "api" && args[1] === "-H") {
      const repo = named(args[3]);
      return repo?.config == null
        ? { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }
        : { status: 0, stdout: repo.config, stderr: "" };
    }
    if (command === "gh" && args[0] === "api") {
      const repo = named(args[1]);
      return repo?.release === undefined
        ? { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }
        : { status: 0, stdout: JSON.stringify({ tag_name: repo.release }), stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      const repo = named(args[1]);
      return repo === undefined
        ? { status: 128, stdout: "", stderr: "fatal: repository not found" }
        : {
            status: 0,
            stdout: `${TIP}\trefs/heads/${repo.branch}\n${TAGGED}\trefs/tags/v1.0.0\n`,
            stderr: "",
          };
    }
    return systemRunner(command, args, options);
  };
  return { run, calls };
}

const repos = (): Record<string, Repo> => ({
  "Avunu/carbon_frappe": { config: config(), branch: "develop", release: "v1.0.0" },
  "Avunu/frappe-nix": {
    config: config({
      name: "frappe-nix",
      slug: "frappe-nix",
      platform: "nixos",
      repo: "https://github.com/Avunu/frappe-nix",
      domain: "frappe-nix.avunu.net",
    }),
    branch: "main",
  },
  "Avunu/docusystem": {
    config: config({
      name: "docusystem",
      slug: "docusystem",
      platform: "general",
      repo: "https://github.com/Avunu/docusystem",
      domain: "docusystem.avunu.net",
    }),
    branch: "main",
  },
});

function workspace(fleet: string[] = ["Avunu/carbon_frappe", "Avunu/frappe-nix"]): string {
  const dir = tempDir();
  initRepo(dir, { origin: "https://github.com/Avunu/docusystem.git" });
  writeFileSync(join(dir, "fleet.json"), JSON.stringify(fleet.map((repo) => ({ repo }))));
  return dir;
}

const lines = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) },
  };
};

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");

describe("readProject", () => {
  test("asks for the default branch and the raw config of the default branch, and maps them", () => {
    const { run, calls } = runnerFor(repos());
    expect(readProject("Avunu/carbon_frappe", run)).toMatchObject({
      path: "carbon-theme",
      branch: "develop",
    });
    expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["gh repo", "gh api"]);
    expect(calls[1]).toEqual([
      "gh",
      "api",
      "-H",
      "Accept: application/vnd.github.raw+json",
      "repos/Avunu/carbon_frappe/contents/docs-site/docusystem.config.json",
    ]);
  });

  test("says which file could not be read", () => {
    const { run } = runnerFor({ "Avunu/x": { config: null, branch: "main" } });
    expect(() => readProject("Avunu/x", run)).toThrow(
      /docs-site\/docusystem.config.json: gh: Not Found/,
    );
    expect(() => readProject("Avunu/missing", run)).toThrow(/gh repo view failed/);
  });
});

describe("main", () => {
  test("--dry-run reads GitHub and the local git state, prints the plan and the two files, and writes nothing", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    const { out, err, io } = lines();
    expect(main(["--dry-run"], io, { run, cwd: dir })).toBe(0);
    expect(err).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("seed: Avunu/carbon_frappe -> carbon-theme");
    expect(text).toContain("seed: Avunu/docusystem -> site-docs (local)");
    expect(text).toContain("pin: projects/carbon-theme -> v1.0.0 (latest release)");
    expect(text).toContain("pin: projects/frappe-nix -> 1111111 (head of main)");
    expect(text).toContain("--- projects.json (would be written)");
    expect(text).toContain('[submodule "projects/carbon-theme"]');
    expect(text).toContain("dry run, nothing was written (2 gitlink(s) would be added)");
    expect(existsSync(join(dir, "projects.json"))).toBe(false);
    expect(existsSync(join(dir, ".gitmodules"))).toBe(false);
    expect(git(dir, "ls-files", "--stage")).toBe("");
  });

  test("writes projects.json and .gitmodules and records one gitlink per submodule, none for the local project", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    const { out, err, io } = lines();
    expect(main([], io, { run, cwd: dir })).toBe(0);
    expect(err).toEqual([]);

    const registry = JSON.parse(read(dir, "projects.json")) as { projects: Entry[] };
    expect(registry.projects.map((p) => p.path)).toEqual([
      "carbon-theme",
      "frappe-nix",
      "site-docs",
    ]);
    expect(registry.projects[2]).toMatchObject({
      local: true,
      repo: "https://github.com/Avunu/docusystem",
    });
    expect(parseRegistry(read(dir, "projects.json"))).toHaveLength(3);
    expect(read(dir, ".gitmodules")).toContain(
      "\turl = https://github.com/Avunu/carbon_frappe.git",
    );
    expect(git(dir, "ls-files", "--stage")).toBe(
      [`160000 ${TAGGED} 0\tprojects/carbon-theme`, `160000 ${TIP} 0\tprojects/frappe-nix`].join(
        "\n",
      ),
    );
    expect(existsSync(join(dir, "projects", "carbon-theme"))).toBe(true); // the empty folder of an uninitialised submodule
    expect(out.at(-1)).toContain("wrote projects.json (3 projects)");
  });

  test("is idempotent: a second run changes neither file nor any gitlink", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    expect(main([], lines().io, { run, cwd: dir })).toBe(0);
    const [registry, modules, index] = [
      read(dir, "projects.json"),
      read(dir, ".gitmodules"),
      git(dir, "ls-files", "--stage"),
    ];
    const again = lines();
    expect(main([], again.io, { run, cwd: dir })).toBe(0);
    expect(read(dir, "projects.json")).toBe(registry);
    expect(read(dir, ".gitmodules")).toBe(modules);
    expect(git(dir, "ls-files", "--stage")).toBe(index);
    expect(again.out.some((line) => line.startsWith("pin:"))).toBe(false);
  });

  test("never moves a gitlink that exists, keeps an entry that was edited, and --refresh replaces it", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    expect(main([], lines().io, { run, cwd: dir })).toBe(0);
    const edited = JSON.parse(read(dir, "projects.json")) as { projects: Entry[] };
    const first = edited.projects[0] as Entry;
    first.tagline = "Edited by hand.";
    writeFileSync(join(dir, "projects.json"), renderRegistry(edited as never));
    const moved = "9".repeat(40);
    git(dir, "update-index", "--cacheinfo", `160000,${moved},projects/carbon-theme`);

    expect(main([], lines().io, { run, cwd: dir })).toBe(0);
    expect(
      (JSON.parse(read(dir, "projects.json")) as { projects: Entry[] }).projects[0]?.tagline,
    ).toBe("Edited by hand.");
    expect(git(dir, "ls-files", "--stage", "projects/carbon-theme")).toContain(moved);

    expect(main(["--refresh"], lines().io, { run, cwd: dir })).toBe(0);
    expect(
      (JSON.parse(read(dir, "projects.json")) as { projects: Entry[] }).projects[0]?.tagline,
    ).toBe("A theme for Frappe.");
    expect(git(dir, "ls-files", "--stage", "projects/carbon-theme")).toContain(moved);
  });

  test("--no-pins writes the two files and no gitlink", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    expect(main(["--no-pins"], lines().io, { run, cwd: dir })).toBe(0);
    expect(existsSync(join(dir, "projects.json"))).toBe(true);
    expect(git(dir, "ls-files", "--stage")).toBe("");
  });

  test("one repository that cannot be read writes nothing and exits 1, naming it", () => {
    const dir = workspace(["Avunu/carbon_frappe", "Avunu/frappe-nix", "Avunu/no-config"]);
    const all = { ...repos(), "Avunu/no-config": { config: null, branch: "main" } };
    const { run } = runnerFor(all);
    const { err, io } = lines();
    expect(main([], io, { run, cwd: dir })).toBe(1);
    expect(err.join("\n")).toContain("Avunu/no-config: docs-site/docusystem.config.json");
    expect(err.at(-1)).toContain("nothing was written");
    expect(existsSync(join(dir, "projects.json"))).toBe(false);
  });

  test("this repository is found from `origin` or --self, and is not read twice when the fleet lists it", () => {
    const dir = workspace(["Avunu/carbon_frappe", "Avunu/docusystem"]);
    const { run, calls } = runnerFor(repos());
    expect(main(["--dry-run"], lines().io, { run, cwd: dir })).toBe(0);
    expect(
      calls.filter((c) => c.join(" ").includes("repos/Avunu/docusystem/contents")),
    ).toHaveLength(1);

    const bare = tempDir();
    initRepo(bare);
    writeFileSync(join(bare, "fleet.json"), "[]");
    const { err, io } = lines();
    expect(main(["--dry-run"], io, { run, cwd: bare })).toBe(2);
    expect(err.join("\n")).toContain("pass --self");
    expect(main(["--dry-run", "--self", "Avunu/docusystem"], lines().io, { run, cwd: bare })).toBe(
      0,
    );
  });

  test("a usage error and an unreadable fleet file are 2", () => {
    const dir = workspace();
    const { run } = runnerFor(repos());
    const { err, io } = lines();
    expect(main(["--bogus"], io, { run, cwd: dir })).toBe(2);
    writeFileSync(join(dir, "fleet.json"), '[{"repo":"not a repo"}]');
    expect(main([], io, { run, cwd: dir })).toBe(2);
    expect(err.join("\n")).toContain("fleet.json");
    mkdirSync(join(dir, "sub"));
    expect(main(["--fleet", "sub/missing.json"], io, { run, cwd: dir })).toBe(2);
  });
});
