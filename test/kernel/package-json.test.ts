// The contract of package.json that a Dependabot bump or a careless edit must not break. Versions are
// not asserted (the Jx pins move with every Jx release); their shape is.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { name, packageRoot, version } from "../../src/lib/package-info.js";
import { PLATFORMS } from "../../src/lib/platforms.js";
import { REPO_ROOT } from "../support/index.js";

interface Pkg {
  name: string;
  version: string;
  private?: boolean;
  type: string;
  engines: Record<string, string>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  license: string;
  [key: string]: unknown;
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as Pkg;
const EXACT = /^\d+\.\d+\.\d+$/;

describe("package.json", () => {
  test("the runtime dependencies are the four Jx packages and yaml, nothing else, each pinned exactly", () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@jxsuite/compiler",
      "@jxsuite/parser",
      "@jxsuite/runtime",
      "@jxsuite/search",
      "yaml",
    ]);
    for (const [dependency, range] of Object.entries(pkg.dependencies)) {
      expect(range, dependency).toMatch(EXACT);
    }
  });

  test("the development tools are pinned exactly (@types/node follows the Node floor)", () => {
    for (const [dependency, range] of Object.entries(pkg.devDependencies)) {
      if (dependency === "@types/node") expect(range).toMatch(/^\^22\.\d+\.\d+$/);
      else expect(range, dependency).toMatch(EXACT);
    }
    for (const tool of ["oxfmt", "oxlint", "typescript", "vitest", "ajv"]) {
      expect(pkg.devDependencies, tool).toHaveProperty(tool);
    }
  });

  test("it is a site, not a package: private, never published, nothing runs on install", () => {
    expect(pkg.private).toBe(true);
    for (const key of ["bin", "exports", "files", "publishConfig", "main"]) {
      expect(pkg, key).not.toHaveProperty(key);
    }
    for (const hook of [
      "preinstall",
      "install",
      "postinstall",
      "prepare",
      "prepack",
      "prepublish",
    ]) {
      expect(pkg.scripts, hook).not.toHaveProperty(hook);
    }
  });

  test("MIT, ESM and the Node floor", () => {
    expect(pkg.license).toBe("MIT");
    expect(pkg.type).toBe("module");
    expect(pkg.engines).toEqual({ node: ">=22.19.0" });
  });

  test("the scripts every pipeline calls exist", () => {
    for (const script of [
      "build",
      "clean",
      "format",
      "format:check",
      "lint",
      "typecheck",
      "test",
      "check",
      "docs:build",
      "docs:check",
    ]) {
      expect(pkg.scripts, script).toHaveProperty(script);
    }
    expect(pkg.scripts.check).toBe(
      "npm run format:check && npm run lint && npm run typecheck && npm test",
    );
    expect(pkg.scripts["docs:build"]).toBe("node build/cli.js build");
    expect(pkg.scripts["docs:check"]).toBe("node build/cli.js check");
  });
});

describe("package-info", () => {
  test("name and version come from package.json, and packageRoot is the folder that holds it", () => {
    expect(name).toBe(pkg.name);
    expect(version).toBe(pkg.version);
    expect(packageRoot).toBe(REPO_ROOT);
    expect(packageRoot.endsWith("/")).toBe(false);
  });
});

describe("platforms", () => {
  test("are the five of the registry, in this order", () => {
    expect([...PLATFORMS]).toEqual(["frappe", "odoo", "wordpress", "nixos", "general"]);
  });
});
