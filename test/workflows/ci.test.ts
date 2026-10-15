// ci.yml: the one required check, the workflow lint pins, the browser suites, and the dispatch trigger
// the bump pull request depends on.
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { hasJq, runOf, workflow } from "./helpers.js";

const ci = workflow("ci.yml");
const jobs = ci.doc.jobs;

const needsOf = (id: string): string[] => {
  const needs = jobs[id]?.needs;
  return needs === undefined ? [] : Array.isArray(needs) ? needs : [needs];
};

describe("ci.yml", () => {
  test("starts on pull requests, pushes to main and by hand (the bump branch needs the last)", () => {
    expect(Object.keys(ci.doc.on).sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    expect(ci.doc.on.push).toEqual({ branches: ["main"] });
    expect(ci.doc.permissions).toEqual({});
  });

  test("has the checks, the browser suites, the workflow lint, the title check, the workspace build and the informational Windows row", () => {
    expect(Object.keys(jobs).sort()).toEqual([
      "check",
      "ci",
      "pr-title",
      "verify",
      "windows",
      "workflows",
      "workspace",
    ]);
  });

  test("`ci` is the one required check: it waits for every job except the informational one and runs always", () => {
    expect(jobs.ci?.name).toBe("ci");
    expect(jobs.ci?.if).toBe("${{ always() }}");
    expect(jobs.ci?.permissions).toEqual({});
    const waitedFor = needsOf("ci").sort();
    const others = Object.keys(jobs)
      .filter((id) => id !== "ci" && id !== "windows")
      .sort();
    expect(waitedFor).toEqual(others);
    expect(waitedFor).not.toContain("windows");
  });

  test.skipIf(!hasJq)(
    "the `ci` script passes on success and skipped, and fails on failure and cancellation",
    () => {
      const script = runOf(ci, "ci", "Every job passed (a skipped one is fine)");
      const decide = (results: Record<string, string>): number | null => {
        const needs = Object.fromEntries(
          Object.entries(results).map(([id, result]) => [id, { result }]),
        );
        return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
          env: { PATH: process.env.PATH ?? "", RESULTS: JSON.stringify(needs) },
          encoding: "utf8",
        }).status;
      };
      expect(decide({ check: "success", workspace: "skipped", "pr-title": "skipped" })).toBe(0);
      expect(decide({ check: "success", verify: "failure" })).toBe(1);
      expect(decide({ check: "success", verify: "cancelled" })).toBe(1);
      expect(decide({ check: "failure", workspace: "skipped" })).toBe(1);
    },
  );

  test("the Windows row is informational: unit tests only, on Node 24, and it can never fail the run", () => {
    const windows = jobs.windows;
    expect(windows?.["runs-on"]).toBe("windows-latest");
    expect(windows?.["continue-on-error"]).toBe(true);
    const node = windows?.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"));
    expect(node?.with).toMatchObject({ "node-version": "24" });
    expect(windows?.steps?.map((step) => step.run)).toContain("npm test -- --project unit");
  });

  test("the pull request title is checked on pull requests only, and reaches the script through env", () => {
    expect(jobs["pr-title"]?.if).toBe("${{ github.event_name == 'pull_request' }}");
    const step = jobs["pr-title"]?.steps?.find(
      (candidate) => candidate.run === "node scripts/check-pr-title.mjs",
    );
    expect(step?.env).toEqual({ PR_TITLE: "${{ github.event.pull_request.title }}" });
  });

  test("a pull request run cancels the one it replaces; a push or dispatch run never cancels", () => {
    expect(ci.doc.concurrency).toEqual({
      group: "ci-${{ github.event.pull_request.number || github.ref }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });
});

describe("the workflow lint", () => {
  const lint = jobs.workflows;

  test("downloads actionlint 1.7.12 and verifies its sha256 before it runs", () => {
    const step = lint?.steps?.find((candidate) => candidate.name === "Install actionlint");
    expect(step?.env?.ACTIONLINT_VERSION).toBe("1.7.12");
    expect(step?.env?.ACTIONLINT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    const script = step?.run ?? "";
    expect(script.indexOf("sha256sum --check --strict")).toBeGreaterThan(script.indexOf("curl "));
    expect(script.indexOf("sha256sum --check --strict")).toBeLessThan(script.indexOf("tar "));
  });

  test("lints this repository's workflows with actionlint", () => {
    expect(runOf(ci, "workflows", "actionlint")).toBe(
      "./actionlint -color .github/workflows/*.yml",
    );
  });

  test("runs zizmor 1.30.1, pedantic, online, on the workflows and the Dependabot configuration", () => {
    const zizmor = (lint?.steps ?? []).filter((step) =>
      step.uses?.startsWith("zizmorcore/zizmor-action@"),
    );
    expect(zizmor).toHaveLength(1);
    expect(zizmor[0]?.with).toMatchObject({
      version: "1.30.1",
      persona: "pedantic",
      "advanced-security": false,
    });
    expect(String(zizmor[0]?.with?.inputs).split(/\s+/)).toEqual([
      ".github/workflows",
      ".github/dependabot.yml",
    ]);
    expect(zizmor[0]?.with?.["online-audits"]).toBeUndefined();
  });
});

describe("the other jobs", () => {
  test("check is format, lint, types and both test projects, then the build", () => {
    const runs = (id: string) => (jobs[id]?.steps ?? []).map((step) => step.run).filter(Boolean);
    expect(runs("check")).toEqual([
      "npm ci --ignore-scripts --no-audit --no-fund",
      "npm run check",
      "npm run build",
    ]);
  });

  test("verify builds a fixture workspace, runs every browser suite in Chrome and keeps the screenshots", () => {
    const steps = jobs.verify?.steps ?? [];
    const scripts = steps.map((step) => step.run ?? "").join("\n");
    expect(scripts).toContain("npm run build");
    expect(scripts).toContain("bun install --frozen-lockfile");
    expect(scripts).toContain('bun run.ts --out "$RUNNER_TEMP/verify"');
    const shots = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(shots?.with).toMatchObject({ name: "verify-shots", "retention-days": 7 });
    expect(shots?.with?.path).toBe("${{ runner.temp }}/verify/shots");
  });

  test("the browser suites run under Bun, pinned to its minor", () => {
    const bun = jobs.verify?.steps?.find((step) => step.uses?.startsWith("oven-sh/setup-bun@"));
    expect(bun?.with).toMatchObject({ "bun-version": "1.4", "no-cache": true });
  });
});
