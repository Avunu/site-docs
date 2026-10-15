import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import { PLATFORMS } from "../../src/lib/platforms.js";
import {
  PROJECT_KEYS,
  PROJECT_PATH,
  RESERVED_PATHS,
  RegistryError,
  docsPrefix,
  projectDocs,
  projectRoot,
  readRegistry,
  validateRegistry,
} from "../../src/workspace/registry.js";
import { REPO_ROOT, tempDir, writeTree } from "../support/index.js";

const project = (over: Record<string, unknown> = {}) => ({
  path: "frappe-nix",
  slug: "frappe-nix",
  name: "frappe-nix",
  tagline: "Reproducible Nix infrastructure for Frappe.",
  platform: "nixos",
  repo: "https://github.com/Avunu/frappe-nix",
  license: "MIT",
  branch: "main",
  ...over,
});

const registry = (over: Record<string, unknown> = {}, projects: unknown[] = [project()]) => ({
  domain: "docs.avunu.net",
  name: "Avunu documentation",
  tagline: "Documentation for Avunu's open-source projects.",
  org: "https://github.com/Avunu",
  projects,
  ...over,
});

describe("validateRegistry", () => {
  test("a valid registry has no problem, with or without the optional keys", () => {
    expect(validateRegistry(registry())).toEqual([]);
    expect(
      validateRegistry(
        registry({ $schema: "./projects.schema.json" }, [
          project({ path: "a-project", slug: "a_project", docs: "documentation/user" }),
          project({
            path: "site-docs",
            slug: "docusystem",
            repo: "https://github.com/Avunu/site-docs",
            local: true,
          }),
        ]),
      ),
    ).toEqual([]);
  });

  test("it must be an object with the four settings and a list", () => {
    expect(validateRegistry(null)).toEqual(["projects.json must be a JSON object (got null)"]);
    expect(validateRegistry([])).toEqual(["projects.json must be a JSON object (got an array)"]);
    const problems = validateRegistry({});
    for (const key of ["domain", "name", "tagline", "org"]) {
      expect(problems).toContain(`projects.json: "${key}" is required`);
    }
    expect(problems).toContain('projects.json: "projects" must be a list (got undefined)');
    expect(validateRegistry(registry({ extra: 1 }))).toEqual([
      'projects.json: "extra" is not a setting of the workspace',
    ]);
  });

  test("the domain is a host name, the organization a GitHub address", () => {
    expect(validateRegistry(registry({ domain: "https://docs.avunu.net" }))[0]).toContain(
      '"domain" must be a host name without a scheme',
    );
    expect(validateRegistry(registry({ org: "https://example.com/Avunu" }))[0]).toContain(
      '"org" must look like https://github.com/Avunu',
    );
  });

  test("a path is one lowercase URL segment, not reserved, and unique", () => {
    for (const path of ["Frappe", "a/b", "a_b", "-a", "a b", ""]) {
      expect(
        validateRegistry(registry({}, [project({ path })])).join("\n"),
        JSON.stringify(path),
      ).toMatch(/"path"/);
    }
    for (const path of RESERVED_PATHS) {
      expect(validateRegistry(registry({}, [project({ path })]))).toEqual([
        `project ${path}: "path" may not be "${path}": the site publishes its own ${path} at its root`,
      ]);
    }
    const two = validateRegistry(
      registry({}, [project(), project({ slug: "other", repo: "https://github.com/Avunu/o" })]),
    );
    expect(two).toContain('project frappe-nix: "path" is used by an earlier project');
    expect(PROJECT_PATH.test("odoo-nix")).toBe(true);
  });

  test("a slug may hold an underscore, a path may not, and a slug or repository is used once", () => {
    expect(validateRegistry(registry({}, [project({ slug: "erpnext_taskview" })]))).toEqual([]);
    const problems = validateRegistry(
      registry({}, [
        project({ path: "a" }),
        project({ path: "b" }),
        project({ path: "c", slug: "c", repo: "https://github.com/Avunu/FRAPPE-NIX" }),
      ]),
    );
    expect(problems).toContain('project b: "slug" is used by an earlier project');
    expect(problems).toContain('project b: "repo" is used by an earlier project');
    expect(problems).toContain('project c: "repo" is used by an earlier project');
  });

  test("the text keys are required, bounded and may not hold ${...}", () => {
    expect(validateRegistry(registry({}, [project({ name: undefined })]))).toEqual([
      'project frappe-nix: "name" is required',
    ]);
    expect(validateRegistry(registry({}, [project({ name: "  " })]))[0]).toContain(
      '"name" must be a non-empty string',
    );
    expect(validateRegistry(registry({}, [project({ name: "x".repeat(81) })]))).toEqual([
      'project frappe-nix: "name" is longer than 80 characters',
    ]);
    expect(validateRegistry(registry({}, [project({ tagline: "x".repeat(201) })]))).toEqual([
      'project frappe-nix: "tagline" is longer than 200 characters',
    ]);
    for (const key of ["name", "tagline", "license"]) {
      expect(validateRegistry(registry({}, [project({ [key]: "a ${b}" })]))[0]).toContain(
        `"${key}" must not contain \${...}`,
      );
    }
    expect(validateRegistry(registry({ name: "x ${y}" }))[0]).toContain(
      'projects.json: "name" must not contain ${...}',
    );
  });

  test("platform, repository, branch and docs folder are checked", () => {
    expect(validateRegistry(registry({}, [project({ platform: "java" })]))[0]).toContain(
      '"platform" must be one of frappe, odoo, wordpress, nixos, general',
    );
    expect(
      validateRegistry(registry({}, [project({ repo: "https://gitlab.com/Avunu/x" })]))[0],
    ).toContain('"repo" must look like https://github.com/Avunu/project');
    for (const branch of ["a..b", "a b", "-x", 'a"b']) {
      expect(validateRegistry(registry({}, [project({ branch })]))[0], branch).toContain(
        '"branch" is not a branch name that is safe in a URL',
      );
    }
    for (const docs of ["/docs", "../docs", "a/../b"]) {
      expect(validateRegistry(registry({}, [project({ docs })]))[0], docs).toContain(
        '"docs" must be a folder inside the repository',
      );
    }
    expect(validateRegistry(registry({}, [project({ local: "yes" })]))[0]).toContain(
      '"local" must be true or false',
    );
    expect(validateRegistry(registry({}, [project({ extra: 1 })]))).toEqual([
      'project frappe-nix: "extra" is not a project setting',
    ]);
  });

  test("the projects are listed in path order, so that a change shows as one line", () => {
    const problems = validateRegistry(
      registry({}, [
        project({ path: "b", slug: "b", repo: "https://github.com/Avunu/b" }),
        project({ path: "a", slug: "a", repo: "https://github.com/Avunu/a" }),
      ]),
    );
    expect(problems).toEqual([
      'projects.json: the projects are not sorted by "path": keep the list in order so that a change shows as one line',
    ]);
  });

  test("a local project may share the repository address of the workspace's own", () => {
    expect(
      validateRegistry(
        registry({}, [
          project({ path: "a", slug: "a", local: true }),
          project({ path: "b", slug: "b", local: true }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("readRegistry", () => {
  const write = (text: string) => writeTree(tempDir("registry-"), { "projects.json": text });

  test("reads the settings and the projects, defaulting the docs folder to docs", () => {
    const root = write(
      JSON.stringify(
        registry({}, [
          project(),
          project({
            path: "z",
            slug: "z",
            repo: "https://github.com/A/z",
            docs: "d/u",
            local: true,
          }),
        ]),
      ),
    );
    const ws = readRegistry(root);
    expect(ws).toMatchObject({
      domain: "docs.avunu.net",
      name: "Avunu documentation",
      org: "https://github.com/Avunu",
    });
    expect(ws.projects.map((p) => [p.path, p.docs, p.local])).toEqual([
      ["frappe-nix", "docs", undefined],
      ["z", "d/u", true],
    ]);
  });

  test("a missing file, a file that is not JSON and an invalid registry are RegistryErrors", () => {
    expect(() => readRegistry(tempDir("registry-"))).toThrow(RegistryError);
    expect(() => readRegistry(tempDir("registry-"))).toThrow(/is not a docs workspace/);
    expect(() => readRegistry(write("{"))).toThrow(/is not valid JSON/);
    try {
      readRegistry(write(JSON.stringify({ domain: "x", projects: [] })));
      throw new Error("not reached");
    } catch (error) {
      expect(error).toBeInstanceOf(RegistryError);
      expect((error as RegistryError).problems.length).toBeGreaterThan(2);
    }
  });

  test("a byte order mark does not stop the file from being read", () => {
    expect(readRegistry(write(`﻿${JSON.stringify(registry())}`)).projects).toHaveLength(1);
  });
});

describe("where a project is", () => {
  const sub = { path: "frappe-nix" };
  // `resolve` puts the drive in front on Windows, so the expectations are made with it too.
  const root = resolve("/w");

  test("a project is a submodule, a local project is the workspace, a source replaces both", () => {
    expect(projectRoot("/w", sub)).toBe(join(root, "projects", "frappe-nix"));
    expect(projectRoot("/w", { path: "site-docs", local: true })).toBe(root);
    expect(projectRoot("/w", sub, { "frappe-nix": "/elsewhere/checkout" })).toBe(
      resolve("/elsewhere/checkout"),
    );
    expect(projectRoot("/w", sub, { other: "/x" })).toBe(join(root, "projects", "frappe-nix"));
  });

  test("the Markdown folder is below the project, whatever depth the setting has", () => {
    expect(projectDocs("/w", { ...project(), docs: "documentation/user" } as never)).toBe(
      join(root, "projects", "frappe-nix", "documentation", "user"),
    );
    expect(docsPrefix(sub)).toBe("/frappe-nix/docs");
  });
});

describe("projects.schema.json", () => {
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, "projects.schema.json"), "utf8")) as {
    properties: Record<string, unknown>;
    $defs: { project: { properties: Record<string, any>; required: string[] } };
  };
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(schema);

  test("it lists the settings the build knows, and the platforms of the build", () => {
    expect(Object.keys(schema.$defs.project.properties)).toEqual([...PROJECT_KEYS]);
    expect(schema.$defs.project.properties.platform.enum).toEqual([...PLATFORMS]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["$schema", "domain", "name", "org", "projects", "tagline"].sort(),
    );
    expect(schema.$defs.project.properties.path.not.enum).toEqual([...RESERVED_PATHS]);
  });

  test("it agrees with the build on what is valid and what is not", () => {
    const cases: Array<[string, unknown]> = [
      ["valid", registry()],
      ["a ${} in the name", registry({ name: "a ${b}" })],
      ["an upper-case path", registry({}, [project({ path: "Frappe" })])],
      ["a reserved path", registry({}, [project({ path: "assets" })])],
      ["an unknown platform", registry({}, [project({ platform: "java" })])],
      ["a missing branch", registry({}, [project({ branch: undefined })])],
      ["an unknown project setting", registry({}, [project({ extra: 1 })])],
      ["an unknown setting", registry({ extra: 1 })],
      ["an absolute docs folder", registry({}, [project({ docs: "/docs" })])],
      ["a docs folder with ..", registry({}, [project({ docs: "a/../b" })])],
      ["a scheme in the domain", registry({ domain: "https://docs.avunu.net" })],
      ["a gitlab repository", registry({}, [project({ repo: "https://gitlab.com/a/b" })])],
      ["a long tagline", registry({}, [project({ tagline: "x".repeat(201) })])],
    ];
    for (const [name, value] of cases) {
      const build = validateRegistry(value).length === 0;
      expect(validate(value), `${name}: the schema says ${JSON.stringify(validate.errors)}`).toBe(
        build,
      );
    }
  });
});
