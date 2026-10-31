// .github/dependabot.yml: the update chain for Jx, and the commit prefixes that the pull request title
// check accepts.
import { describe, expect, test } from "vitest";
import { problemsWith } from "../../scripts/check-pr-title.mjs";
import { readYaml } from "./helpers.js";

interface Entry {
  "package-ecosystem": string;
  directory: string;
  schedule: { interval: string };
  cooldown?: { "default-days": number; exclude?: string[] };
  groups?: Record<
    string,
    { patterns?: string[]; "dependency-type"?: string; "exclude-patterns"?: string[] }
  >;
  ignore?: { "dependency-name": string; "update-types"?: string[] }[];
  "commit-message"?: { prefix: string; "prefix-development"?: string; include?: string };
}

const config = readYaml<{ version: number; updates: Entry[] }>(".github", "dependabot.yml");
/** The entry for the repository root: the build, as opposed to the browser suites in verify/. */
const entry = (ecosystem: string): Entry => {
  const found = config.updates.find(
    (candidate) => candidate["package-ecosystem"] === ecosystem && candidate.directory === "/",
  );
  if (found === undefined) throw new Error(`no ${ecosystem} entry`);
  return found;
};

describe(".github/dependabot.yml", () => {
  test("is version 2: npm and github-actions for the repository root, plus npm for verify/, all weekly", () => {
    expect(config.version).toBe(2);
    expect(
      config.updates.map((update) => `${update["package-ecosystem"]} ${update.directory}`).sort(),
    ).toEqual(["github-actions /", "npm /", "npm /verify"]);
    for (const update of config.updates) {
      expect(update.schedule.interval).toBe("weekly");
      expect(update.cooldown?.["default-days"]).toBe(7); // zizmor's dependabot-cooldown audit wants one
    }
  });

  test("the submodules are not Dependabot's: the bump workflow moves them to each project's release", () => {
    expect(config.updates.map((update) => update["package-ecosystem"])).not.toContain(
      "gitsubmodule",
    );
  });

  test("the jx group takes every @jxsuite package, without a cooldown: a Jx fix should reach the site within days", () => {
    const npm = entry("npm");
    expect(npm.groups?.jx).toEqual({ patterns: ["@jxsuite/*"] });
    expect(npm.cooldown?.exclude).toEqual(["@jxsuite/*"]);
  });

  test("the runtime group is yaml, the tooling group is every development dependency", () => {
    const npm = entry("npm");
    expect(npm.groups?.runtime).toEqual({ "dependency-type": "production", patterns: ["yaml"] });
    expect(npm.groups?.tooling).toEqual({ "dependency-type": "development", patterns: ["*"] });
    expect(Object.keys(npm.groups ?? {})).toEqual(["jx", "runtime", "tooling"]);
  });

  test("keeps @types/node on the Node floor's major", () => {
    expect(entry("npm").ignore).toEqual([
      { "dependency-name": "@types/node", "update-types": ["version-update:semver-major"] },
    ]);
  });

  test("the build's own dependencies are fix(deps), so each ships in a release of the check; the rest release nothing", () => {
    expect(entry("npm")["commit-message"]).toEqual({
      prefix: "fix",
      "prefix-development": "chore",
      include: "scope",
    });
    expect(
      config.updates.find((update) => update.directory === "/verify")?.["commit-message"],
    ).toEqual({
      prefix: "chore",
      include: "scope",
    });
    expect(entry("github-actions")["commit-message"]).toEqual({ prefix: "ci", include: "scope" });
    // The titles those settings produce are all accepted by the pull request title check.
    for (const title of [
      "fix(deps): bump the jx group with 4 updates",
      "fix(deps): bump yaml from 2.9.1 to 2.9.2",
      "chore(deps-dev): bump the tooling group with 3 updates",
      "chore(deps): bump the browser-suites group with 3 updates",
      "ci(deps): bump the actions group with 2 updates",
    ]) {
      expect(problemsWith(title), title).toEqual([]);
    }
  });
});
