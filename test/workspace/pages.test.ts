import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  PATH_TOKEN,
  TEMPLATES,
  renderTemplate,
  writeProjectPages,
} from "../../src/workspace/pages.js";
import { REPO_ROOT, tempDir } from "../support/index.js";

const shell = (...rel: string[]) => join(REPO_ROOT, "site", ...rel);

describe("renderTemplate", () => {
  test("puts the project's path wherever the token stands", () => {
    expect(renderTemplate(`a ${PATH_TOKEN} b ${PATH_TOKEN}`, { path: "odoo-nix" }, "t")).toBe(
      "a odoo-nix b odoo-nix",
    );
  });

  test("a template with no place for the path is refused, and so is one with another token", () => {
    expect(() => renderTemplate("nothing", { path: "x" }, "t.json")).toThrow(
      `t.json does not contain ${PATH_TOKEN}`,
    );
    expect(() => renderTemplate(`${PATH_TOKEN} @@OTHER@@`, { path: "x" }, "t.json")).toThrow(
      "t.json still contains @@OTHER@@",
    );
  });
});

describe("the templates of the shell", () => {
  test("each names the project's config and nav entries, and carries no other token", () => {
    for (const rel of Object.values(TEMPLATES)) {
      const text = readFileSync(shell(...rel.split("/")), "utf8");
      expect(text, rel).toContain(PATH_TOKEN);
      expect(text.replaceAll(PATH_TOKEN, "").includes("@@"), rel).toBe(false);
      expect(JSON.parse(renderTemplate(text, { path: "demo" }, rel)), rel).toBeTypeOf("object");
    }
  });
});

describe("writeProjectPages", () => {
  const root = () => {
    const dir = tempDir("pages-");
    mkdirSync(join(dir, "templates"));
    writeFileSync(join(dir, TEMPLATES.index), `{"id":"${PATH_TOKEN}","kind":"index"}`);
    writeFileSync(join(dir, TEMPLATES.docs), `{"id":"${PATH_TOKEN}","kind":"docs"}`);
    return dir;
  };
  const projects = [{ path: "alpha" }, { path: "beta" }] as never[];

  test("writes the landing page and the catch-all of every project, and returns them", () => {
    const dir = root();
    const written = writeProjectPages(dir, projects);
    expect(written).toEqual([
      "pages/alpha/index.json",
      "pages/alpha/[...path].json",
      "pages/beta/index.json",
      "pages/beta/[...path].json",
    ]);
    expect(readFileSync(join(dir, "pages", "beta", "index.json"), "utf8")).toBe(
      '{"id":"beta","kind":"index"}',
    );
    expect(readFileSync(join(dir, "pages", "alpha", "[...path].json"), "utf8")).toBe(
      '{"id":"alpha","kind":"docs"}',
    );
  });

  test("writes nothing for no project, and never touches the templates", () => {
    const dir = root();
    expect(writeProjectPages(dir, [])).toEqual([]);
    expect(existsSync(join(dir, "pages"))).toBe(false);
    expect(readFileSync(join(dir, TEMPLATES.index), "utf8")).toContain(PATH_TOKEN);
  });

  test("a missing template is an error, not an empty site", () => {
    expect(() => writeProjectPages(tempDir("pages-"), projects)).toThrow(/ENOENT/);
  });
});
