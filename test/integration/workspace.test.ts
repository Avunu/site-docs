// The workspace as a whole, built by the real command line with the real pinned Jx: two projects with
// their own repository, branch and docs folder become one site, and each stays out of the other's way.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runCli, tempDir } from "../support/index.js";
import { jxEnv, workspaceFrom, type Workspace } from "./support.js";

const registry = (extra: Record<string, unknown>[] = []) =>
  JSON.stringify({
    domain: "docs.example.org",
    name: "Example documentation",
    tagline: "Two projects, one site.",
    org: "https://github.com/Example",
    projects: [
      {
        path: "demo",
        slug: "demo",
        name: "Demo",
        tagline: "The first project.",
        platform: "general",
        repo: "https://github.com/Example/demo",
        license: "MIT",
        branch: "main",
        docs: "docs",
      },
      {
        path: "other",
        slug: "other",
        name: "Other",
        tagline: "The second project, on another branch and in another folder.",
        platform: "odoo",
        repo: "https://github.com/Example/other-renamed",
        license: "Apache-2.0",
        branch: "trunk",
        docs: "documentation/user",
      },
      ...extra,
    ],
  });

const OTHER_DOCS = {
  "projects/other/documentation/user/README.md":
    "---\ntitle: Other home\n---\n\n# Other home\n\nThe second project's home. See the [guide](guide.md).\n",
  "projects/other/documentation/user/guide.md":
    "---\ntitle: Other guide\n---\n\n# Other guide\n\nA page with a unique word: zanzibar.\n",
};

const twoProjects = (files: Record<string, string> = {}, shared = false): Workspace =>
  workspaceFrom("clean", { "projects.json": registry(), ...OTHER_DOCS, ...files }, { shared });

const run = (repo: Workspace, argv: string[], env: NodeJS.ProcessEnv = {}) =>
  runCli(argv, { cwd: repo.dir, env: jxEnv(env) });

const page = (repo: Workspace, ...parts: string[]) =>
  readFileSync(join(repo.dist, ...parts, "index.html"), "utf8");

describe("two projects, one site", () => {
  const repo = twoProjects({}, true);
  let output = "";

  test("a strict build of both succeeds and publishes the pages of both under their own paths", async () => {
    const { code, stdout, stderr } = await run(repo, ["build"], { CI: "true" });
    output = `${stdout}\n${stderr}`;
    expect(code, output).toBe(0);
    for (const route of [
      [],
      ["demo"],
      ["demo", "docs"],
      ["demo", "docs", "guide", "install"],
      ["other"],
      ["other", "docs"],
      ["other", "docs", "guide"],
    ]) {
      expect(existsSync(join(repo.dist, ...route, "index.html")), route.join("/")).toBe(true);
    }
    expect(existsSync(join(repo.dist, "404.html"))).toBe(true);
    expect(readFileSync(join(repo.dist, "CNAME"), "utf8").trim()).toBe("docs.example.org");
  });

  test("the landing page of the site links to both projects and says nothing of a sidebar", () => {
    const home = page(repo);
    expect(home).toContain('href="/demo/"');
    expect(home).toContain('href="/other/"');
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(home).not.toContain("docs-sidebar");
  });

  test("a project's sidebar lists its own pages and none of the other's", () => {
    const demo = page(repo, "demo", "docs");
    const other = page(repo, "other", "docs");
    expect(demo).toContain('href="/demo/docs/guide/install/"');
    expect(demo).not.toContain("/other/docs/");
    expect(other).toContain('href="/other/docs/guide/"');
    expect(other).not.toContain("/demo/docs/");
  });

  test("each page names its own project, and links its repository, branch and docs folder", () => {
    expect(page(repo, "other", "docs", "guide")).toContain(
      "https://github.com/Example/other-renamed/edit/trunk/documentation/user/guide.md",
    );
    expect(page(repo, "demo", "docs", "guide", "install")).toContain(
      "https://github.com/Example/demo/edit/main/docs/guide/install.md",
    );
    expect(page(repo, "other", "docs")).toMatch(/<title>[^<]*Other[^<]*<\/title>/);
    expect(page(repo, "demo", "docs")).toMatch(/<title>[^<]*Demo[^<]*<\/title>/);
  });

  test("the sitemap, the canonical addresses and the search index use the workspace's domain and every project", () => {
    const sitemap = readFileSync(join(repo.dist, "sitemap.xml"), "utf8");
    for (const url of ["/", "/demo/", "/demo/docs/", "/other/", "/other/docs/guide/"]) {
      expect(sitemap).toContain(`<loc>https://docs.example.org${url}</loc>`);
    }
    expect(page(repo, "other", "docs", "guide")).toMatch(
      /<link[^>]*href="https:\/\/docs\.example\.org\/other\/docs\/guide\/"[^>]*rel="canonical"/,
    );
    const index = JSON.parse(readFileSync(join(repo.dist, "search-index.json"), "utf8")) as {
      documents: Array<{ url: string }>;
    };
    const urls = new Set(index.documents.map((d) => d.url));
    expect(urls.has("/other/docs/guide/")).toBe(true);
    expect(urls.has("/demo/docs/guide/install/")).toBe(true);
  });

  test("a link between the pages of one project stays in that project", () => {
    expect(page(repo, "other", "docs")).toContain('href="/other/docs/guide/"');
  });
});

describe("--only and --source", () => {
  test("--only builds the named project and leaves the others out of the site", async () => {
    const repo = twoProjects();
    const { code, stdout, stderr } = await run(repo, ["build", "--lenient", "--only", "other"]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(existsSync(join(repo.dist, "other", "docs", "guide", "index.html"))).toBe(true);
    expect(existsSync(join(repo.dist, "demo"))).toBe(false);
    expect(stdout).toMatch(/registry: 1 of 2 project\(s\)/);
  });

  test("--source builds a project from a checkout elsewhere, in place of projects/<path>", async () => {
    const repo = twoProjects();
    const checkout = tempDir("checkout-");
    mkdirSync(join(checkout, "documentation", "user"), { recursive: true });
    writeFileSync(
      join(checkout, "documentation", "user", "README.md"),
      "---\ntitle: From a checkout\n---\n\n# From a checkout\n\nThe pull request's own copy.\n",
    );
    const { code, stdout, stderr } = await run(repo, [
      "build",
      "--lenient",
      "--only",
      "other",
      "--source",
      `other=${checkout}`,
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(page(repo, "other", "docs")).toContain("The pull request&#39;s own copy");
    expect(existsSync(join(repo.dist, "other", "docs", "guide"))).toBe(false);
  });

  test("a project that is not in the registry is refused", async () => {
    const repo = twoProjects();
    const { code, stderr } = await run(repo, ["build", "--only", "nope"]);
    expect(code).toBe(1);
    expect(stderr).toContain("no such project: nope");
    expect(existsSync(repo.root)).toBe(false);
  });
});

describe("what stops a build before Jx runs", () => {
  test("a project whose folder is not checked out says how to get it", async () => {
    const repo = workspaceFrom("clean", { "projects.json": registry() });
    const { code, stderr } = await run(repo, ["build", "--lenient"]);
    expect(code).toBe(1);
    expect(stderr).toContain("other: documentation/user/ is not in");
    expect(stderr).toContain("git submodule update --init projects/other");
    expect(existsSync(repo.dist)).toBe(false);
  });

  test("an invalid registry lists every problem and builds nothing", async () => {
    const repo = workspaceFrom("clean", {
      "projects.json": JSON.stringify({ domain: "nope", projects: [{ path: "Bad Path" }] }),
    });
    const { code, stderr } = await run(repo, ["build"]);
    expect(code).toBe(1);
    expect(stderr).toContain('"domain" must be a host name without a scheme');
    expect(stderr).toContain('"path" must be lowercase letters, digits and hyphens');
    expect(existsSync(repo.root)).toBe(false);
  });

  test("a folder without a README.md is named, and its project is the one that fails", async () => {
    const repo = workspaceFrom("clean", {
      "projects.json": registry(),
      "projects/other/documentation/user/guide.md":
        OTHER_DOCS["projects/other/documentation/user/guide.md"],
    });
    const { code, stderr } = await run(repo, ["build", "--lenient"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/nav: error: other: .*README\.md is missing/);
    expect(existsSync(repo.dist)).toBe(false);
  });

  test("a failed build leaves the previous site exactly as it was", async () => {
    const repo = twoProjects();
    expect((await run(repo, ["build", "--lenient"])).code).toBe(0);
    const before = page(repo, "demo", "docs");
    writeFileSync(
      join(repo.docsDir, "guide", "broken.md"),
      "---\ntitle: Broken\n---\n\n[a](https://x.example/${process.exit(1)}) and [b](javascript:alert(1))\n",
    );
    const failed = await run(repo, ["build"], { CI: "true" });
    expect(failed.code).toBe(1);
    expect(page(repo, "demo", "docs")).toBe(before);
  });
});

describe("check --ci", () => {
  test("prints the summary and the step outputs of a passing run", async () => {
    const repo = twoProjects();
    const summary = join(repo.dir, "summary.md");
    const outputs = join(repo.dir, "outputs.txt");
    writeFileSync(summary, "");
    writeFileSync(outputs, "");
    const { code, stdout, stderr } = await run(repo, ["check", "--ci"], {
      CI: "true",
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: outputs,
    });
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(stdout).toContain("check: all steps passed");
    const text = readFileSync(summary, "utf8");
    expect(text).toContain("### Documentation check: passed");
    expect(text).toContain("| Build | ok: ");
    expect(text).toContain("2 project(s)");
    expect(text).toContain("| Links | ok: ");
    expect(text).toContain("https://docs.example.org/");
    const out = readFileSync(outputs, "utf8");
    expect(out).toContain(`dist=${repo.dist}`);
    expect(out).toMatch(/^pages=\d+$/m);
  });

  test("a broken link in one project fails the check and names the page", async () => {
    const repo = twoProjects({
      "projects/other/documentation/user/guide.md":
        "---\ntitle: Other guide\n---\n\n# Other guide\n\n[gone](missing.md)\n",
    });
    const { code, stdout, stderr } = await run(repo, ["check"], { CI: "true" });
    expect(code).toBe(1);
    expect(`${stdout}\n${stderr}`).toMatch(/missing/);
  });
});

describe("check --only (how a project's own pull request is checked)", () => {
  test("passes strictly for one project of two: the pages of the others are not linked", async () => {
    const repo = twoProjects();
    const { code, stdout, stderr } = await run(repo, ["check", "--only", "other"], { CI: "true" });
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    expect(existsSync(join(repo.dist, "demo"))).toBe(false);
  });
});

describe("annotations name files the run can attach them to", () => {
  const hostile =
    '---\ntitle: Hostile\n---\n\n# Hostile\n\n<iframe src="https://x.example/"></iframe>\n';

  test("in the workspace a project's file is below projects/<path>/", async () => {
    const repo = twoProjects({ "projects/other/documentation/user/hostile.md": hostile });
    const { stdout } = await run(repo, ["check", "--ci", "--only", "other"], { CI: "true" });
    expect(stdout).toMatch(
      /^::error file=projects\/other\/documentation\/user\/hostile\.md,line=7,title=lint::/m,
    );
  });

  test("in a project's own pull request it is relative to the project's repository", async () => {
    const repo = twoProjects();
    const checkout = tempDir("checkout-");
    mkdirSync(join(checkout, "documentation", "user"), { recursive: true });
    writeFileSync(join(checkout, "documentation", "user", "README.md"), "# Home\n");
    writeFileSync(join(checkout, "documentation", "user", "hostile.md"), hostile);
    const { stdout } = await run(
      repo,
      ["check", "--ci", "--only", "other", "--source", `other=${checkout}`],
      { CI: "true" },
    );
    expect(stdout).toMatch(/^::error file=documentation\/user\/hostile\.md,line=7,title=lint::/m);
  });
});
