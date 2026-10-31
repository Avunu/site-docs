// release.yml and the release-please files: the releases of the shared check that every project pins in
// its docs.yml (`@<commit of a release tag> # vX.Y.Z`), so that Dependabot proposes a new pin only when a
// release is cut. The generic rules (pinned actions, least privilege, ...) are invariants.test.ts.
import { describe, expect, test } from "vitest";
import { problemsWith } from "../../scripts/check-pr-title.mjs";
import { escapeRegExp } from "../support/index.js";
import { readJson, workflow } from "./helpers.js";

const release = workflow("release.yml");
const deploy = workflow("deploy.yml");
const check = workflow("check-docs.yml");
const job = release.doc.jobs["release-please"];

/** A path filter of a workflow (`*` within a segment, `**` across segments) as a regular expression. */
const globToRegExp = (glob: string): RegExp =>
  new RegExp(
    `^${glob
      .split("**")
      .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
      .join(".*")}$`,
  );

interface Section {
  type: string;
  section: string;
  hidden?: boolean;
}

const config = readJson<{
  "release-type": string;
  "include-v-in-tag": boolean;
  "include-component-in-tag": boolean;
  "pull-request-title-pattern": string;
  "bump-minor-pre-major": boolean;
  "changelog-sections": Section[];
  packages: Record<string, Record<string, unknown>>;
}>("release-please-config.json");
const manifest = readJson<Record<string, string>>(".release-please-manifest.json");

describe("release.yml", () => {
  test("runs release-please on a push to the default branch, one run at a time", () => {
    expect(Object.keys(release.doc.on)).toEqual(["push", "workflow_dispatch"]);
    expect(release.doc.on.push).toEqual({ branches: ["main"] });
    expect(release.doc.concurrency).toEqual({ group: "release", "cancel-in-progress": false });
    expect(Object.keys(release.doc.jobs)).toEqual(["release-please"]);
    const step = job?.steps?.find((candidate) =>
      candidate.uses?.startsWith("googleapis/release-please-action@"),
    );
    expect(step?.with).toMatchObject({
      "config-file": "release-please-config.json",
      "manifest-file": ".release-please-manifest.json",
    });
  });

  test("uses the org's GitHub App when it can, and dispatches ci.yml only without it", () => {
    const step = job?.steps?.find((candidate) =>
      candidate.uses?.startsWith("googleapis/release-please-action@"),
    );
    expect(step?.with?.token).toBe("${{ steps.app-token.outputs.token || secrets.GITHUB_TOKEN }}");
    const dispatch = job?.steps?.find(
      (candidate) => candidate.name === "Run CI on the release pull request",
    );
    expect(dispatch?.if).toContain("steps.app.outputs.enabled != 'true'");
    expect(dispatch?.run).toContain("gh workflow run ci.yml");
  });

  test("a release pull request changes nothing deploy.yml watches: merging it publishes nothing", () => {
    const paths = (deploy.doc.on.push as { paths: string[] }).paths;
    for (const file of ["CHANGELOG.md", "version.txt", ".release-please-manifest.json"]) {
      expect(
        paths.filter((pattern) => globToRegExp(pattern).test(file)),
        file,
      ).toEqual([]);
    }
  });
});

describe("release-please-config.json", () => {
  test("tags the repository vX.Y.Z, with no component, from a manifest that starts at the last release", () => {
    expect(config["release-type"]).toBe("simple");
    expect(config["include-v-in-tag"]).toBe(true);
    expect(config["include-component-in-tag"]).toBe(false);
    expect(Object.keys(config.packages)).toEqual(["."]);
    expect(manifest["."]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("the release pull request's title passes the pull request title check", () => {
    const title = config["pull-request-title-pattern"].replace("${version}", "0.2.0");
    expect(title).toBe("chore: release v0.2.0");
    expect(problemsWith(title)).toEqual([]);
  });

  test("feat, fix, perf and revert make a release; chore (the bump pull requests) and the rest do not", () => {
    const visible = config["changelog-sections"].filter((section) => section.hidden !== true);
    expect(visible.map((section) => section.type)).toEqual(["feat", "fix", "perf", "revert"]);
    const hidden = config["changelog-sections"].filter((section) => section.hidden === true);
    expect(hidden.map((section) => section.type)).toContain("chore");
  });
});

describe("check-docs.yml", () => {
  test("tells callers to pin the commit of a release tag, with the tag in the comment", () => {
    expect(check.text).toContain("check-docs.yml@<commit of a release tag> # vX.Y.Z");
  });
});
