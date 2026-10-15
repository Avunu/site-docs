import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { TYPES, problemsWith } from "../../scripts/check-pr-title.mjs";
import { REPO_ROOT } from "../support/index.js";

describe("scripts/check-pr-title.mjs", () => {
  test("accepts Conventional Commit titles, scoped, breaking or not", () => {
    for (const title of [
      "feat: add search",
      "fix(nav): order by title",
      "feat(registry)!: rename a key",
      "chore(deps): bump x",
      "chore(docs): bump 3 project(s)",
      "fix(search): index the project landing pages",
      "revert: feat: add search",
    ]) {
      expect(problemsWith(title), title).toEqual([]);
    }
  });

  test("accepts every type of the list, and only those", () => {
    for (const type of TYPES) expect(problemsWith(`${type}: something`), type).toEqual([]);
    expect(problemsWith("wip: something")).toHaveLength(1);
    expect(problemsWith("Feat: something")).toHaveLength(1);
  });

  test("rejects a title that is not a Conventional Commit", () => {
    for (const title of [
      "Update the thing",
      "feat:missing space",
      "feat: ",
      "feat(Scope): upper",
      "feat(): empty",
      "",
    ]) {
      expect(problemsWith(title), JSON.stringify(title)).toHaveLength(1);
    }
  });

  describe("as a command, the way ci.yml runs it (title and body in the environment)", () => {
    const run = (title: string) =>
      spawnSync(process.execPath, ["scripts/check-pr-title.mjs"], {
        cwd: REPO_ROOT,
        env: { PATH: process.env.PATH ?? "", PR_TITLE: title },
        encoding: "utf8",
      });

    test("exits 0 for a good title", () => {
      const result = run("feat(registry): add a key");
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });

    test("exits 1 and prints a workflow annotation for a bad one", () => {
      const result = run("Add a key");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("::error title=Pull request title::");
    });

    test("an empty environment is a failure, not a silent pass", () => {
      const result = spawnSync(process.execPath, ["scripts/check-pr-title.mjs"], {
        cwd: REPO_ROOT,
        env: { PATH: process.env.PATH ?? "" },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
    });
  });
});
