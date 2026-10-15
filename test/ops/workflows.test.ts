// The operations workflows of the documentation workspace: deploy.yml (build and publish the one site),
// bump.yml (the pull workflow that moves the submodules), check-docs.yml (the reusable check a project
// calls on its own pull requests) and the Workspace build job of ci.yml. The generic rules (pinned actions,
// least privilege, no `${{ }}` in a shell, ...) are test/workflows/invariants.test.ts; this file holds what
// is particular to these four, and runs their shell steps for real against fake `git` and `gh`.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { escapeRegExp, git, initRepo, isWindows, tempDir } from "../support/index.js";
import { hasBash, hasJq, runOf, workflow, type Step } from "../workflows/helpers.js";

const deploy = workflow("deploy.yml");
const bump = workflow("bump.yml");
const check = workflow("check-docs.yml");
const ci = workflow("ci.yml");

const stepNamed = (steps: Step[] | undefined, name: string): Step => {
  const found = steps?.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no step "${name}"`);
  return found;
};

const gate = "vars.DOCS_SITE_ENABLED == 'true'";
const onDefaultBranch =
  "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)";

/** GitHub runs `run:` steps with bash -e; `pipefail` is added here because the steps that need it set it. */
function bash(script: string, cwd: string, env: Record<string, string>) {
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
    {
      cwd,
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
    },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

// ---- deploy.yml ----

describe("deploy.yml", () => {
  const build = deploy.doc.jobs.build;
  const publish = deploy.doc.jobs.deploy;

  /** The paths that can change the site. ci.yml's Workspace build job filters on the same list. */
  const PATHS = [
    "projects/**",
    ".gitmodules",
    "projects.json",
    "docs/**",
    "site/**",
    "src/**",
    "package.json",
    "package-lock.json",
    "projects.schema.json",
    "tsconfig*.json",
    ".github/workflows/deploy.yml",
  ];

  test("starts on a push of the default branch that can change the site, and by hand", () => {
    expect(Object.keys(deploy.doc.on)).toEqual(["push", "workflow_dispatch"]);
    expect(deploy.doc.on.push).toEqual({ branches: ["main"], paths: PATHS });
    expect(deploy.doc.name).toBe("Docs site");
    expect(deploy.doc.permissions).toEqual({});
  });

  test("never overlaps itself: one run per ref at a time, nothing cancelled, and one deployment at a time", () => {
    expect(deploy.doc.concurrency).toEqual({
      group: "docs-site-${{ github.ref }}",
      "cancel-in-progress": false,
    });
    expect(publish?.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
  });

  test("the build job is read-only and holds no secret; the deploy job alone can publish", () => {
    expect(build?.permissions).toEqual({ contents: "read" });
    expect(publish?.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(deploy.text).not.toContain("secrets.");
    expect(publish?.environment).toEqual({
      name: "github-pages",
      url: "${{ steps.deployment.outputs.page_url }}",
    });
  });

  test("the build checks out the submodules shallowly, installs frozen, builds, then runs `check` in CI mode", () => {
    const steps = build?.steps ?? [];
    expect(steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with).toEqual({
      submodules: "recursive",
      "fetch-depth": 1,
      "persist-credentials": false,
    });
    expect(steps.map((step) => step.run ?? step.uses?.split("@")[0])).toEqual([
      "actions/checkout",
      "actions/setup-node",
      "npm ci --ignore-scripts --no-audit --no-fund",
      "npm run build",
      "node build/cli.js check",
      "actions/upload-pages-artifact",
    ]);
    const checkStep = stepNamed(steps, "Check and build the site");
    expect(checkStep.env).toEqual({ CI: "true" });
    expect(checkStep.id).toBe("check");
  });

  test("the Pages artifact is made by the build job, from the folder `check` wrote, only when publishing", () => {
    const upload = stepNamed(build?.steps, "Package the site for GitHub Pages");
    expect(upload.with).toMatchObject({
      path: "${{ steps.check.outputs.dist }}",
      "include-hidden-files": true,
    });
    expect(upload.if).toBe("${{ env.PUBLISH == 'true' }}");
    expect(build?.env?.PUBLISH).toBe(`\${{ ${gate} && ${onDefaultBranch} }}`);
  });

  test("the deploy job waits for the build and has the same gate: the variable, and the default branch", () => {
    expect(publish?.needs).toBe("build");
    expect(publish?.if).toBe(`\${{ ${gate} && ${onDefaultBranch} }}`);
  });

  test("the deploy job runs no code of this repository: it configures Pages and deploys the artifact", () => {
    expect((publish?.steps ?? []).map((step) => step.uses?.split("@")[0])).toEqual([
      "actions/configure-pages",
      "actions/deploy-pages",
    ]);
    expect((publish?.steps ?? []).some((step) => step.run !== undefined)).toBe(false);
  });

  test("names no repository: the workflow is the same before and after the rename", () => {
    expect(deploy.text).not.toMatch(/Avunu\/|docusystem|site-docs/);
  });
});

// ---- ci.yml: the Workspace build job ----

describe("ci.yml Workspace build", () => {
  const job = ci.doc.jobs.workspace;
  const changes = stepNamed(job?.steps, "Does the change reach the site?");

  test("is a job of ci.yml named Workspace build, read-only, waited for by `ci`", () => {
    expect(job?.name).toBe("Workspace build");
    expect(job?.permissions).toEqual({ contents: "read" });
    expect(ci.doc.jobs.ci?.needs).toContain("workspace");
  });

  test("fetches the submodules only when the change reaches the site, over https alone, then checks in CI mode", () => {
    const steps = job?.steps ?? [];
    const relevant = "${{ steps.changes.outputs.relevant == 'true' }}";
    expect(stepNamed(steps, "Fetch the submodules").if).toBe(relevant);
    expect(stepNamed(steps, "Fetch the submodules").env).toEqual({ GIT_ALLOW_PROTOCOL: "https" });
    expect(stepNamed(steps, "Fetch the submodules").run).toBe(
      "git submodule update --init --depth 1 --recursive",
    );
    for (const name of [
      "Set up Node.js",
      "Install the locked dependencies",
      "Build the tool",
      "Check and build the site",
    ]) {
      expect(stepNamed(steps, name).if, name).toBe(relevant);
    }
    const checkStep = stepNamed(steps, "Check and build the site");
    expect(checkStep.run).toBe("node build/cli.js check");
    expect(checkStep.env).toEqual({ CI: "true" });
    expect(steps[0]?.with).toMatchObject({ "fetch-depth": 2, "persist-credentials": false });
    expect(steps[0]?.with).not.toHaveProperty("submodules");
  });

  /** A glob of `on.push.paths` as a regular expression: `**` crosses folders, `*` does not. */
  const globToRegExp = (glob: string): RegExp =>
    new RegExp(
      `^${glob
        .split("**")
        .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
        .join(".*")}$`,
    );

  test("filters on the same paths as the push trigger of deploy.yml, plus ci.yml itself", () => {
    const globs = (deploy.doc.on.push as { paths: string[] }).paths;
    const pattern = new RegExp(changes.env?.SITE_PATHS ?? "(unset)");
    const touched = [
      "projects/frappe-nix",
      ".gitmodules",
      "projects.json",
      "docs/maintainers/operations.md",
      "site/pages/index.json",
      "src/cli.ts",
      "package.json",
      "package-lock.json",
      "projects.schema.json",
      "tsconfig.json",
      "tsconfig.build.json",
      ".github/workflows/deploy.yml",
    ];
    const untouched = [
      "README.md",
      "docs.md",
      "projectsx.json",
      "scripts/bump-submodules.mjs",
      "test/ops/workflows.test.ts",
      ".github/workflows/bump.yml",
      "docs-site/package.json",
      "sub/src/x.ts",
      "tsconfig/x.json",
    ];
    for (const file of touched) {
      expect(
        globs.some((glob) => globToRegExp(glob).test(file)),
        `deploy.yml: ${file}`,
      ).toBe(true);
      expect(pattern.test(file), `ci.yml: ${file}`).toBe(true);
    }
    for (const file of untouched) {
      expect(
        globs.some((glob) => globToRegExp(glob).test(file)),
        `deploy.yml: ${file}`,
      ).toBe(false);
      expect(pattern.test(file), `ci.yml: ${file}`).toBe(false);
    }
    // The one difference: a change to ci.yml must run the job it contains.
    expect(pattern.test(".github/workflows/ci.yml")).toBe(true);
    expect(globs.some((glob) => globToRegExp(glob).test(".github/workflows/ci.yml"))).toBe(false);
  });

  describe.skipIf(!hasBash || isWindows)(
    "the `changes` step, run for real against a git history",
    () => {
      /** A repository with a base commit and a second one that touches `files`; runs the step in it. */
      function run(opts: {
        event: string;
        files: string[];
        registry?: boolean;
        single?: boolean;
      }): { relevant: string; out: string } {
        const dir = tempDir();
        initRepo(dir);
        const write = (name: string, text: string) => {
          mkdirSync(join(dir, name, ".."), { recursive: true });
          writeFileSync(join(dir, name), text);
        };
        write("README.md", "base\n");
        if (opts.registry !== false) write("projects.json", "{}\n");
        git(dir, "add", ".");
        git(dir, "commit", "--quiet", "-m", "base");
        if (opts.single !== true) {
          for (const file of opts.files) write(file, `${file}\n`);
          git(dir, "add", ".");
          git(dir, "commit", "--quiet", "--allow-empty", "-m", "change");
        }
        const output = join(dir, "..", `output-${Math.random()}`);
        writeFileSync(output, "");
        const result = bash(changes.run ?? "", dir, {
          EVENT_NAME: opts.event,
          SITE_PATHS: changes.env?.SITE_PATHS ?? "",
          GITHUB_OUTPUT: output,
        });
        expect(result.code, result.out).toBe(0);
        return { relevant: readFileSync(output, "utf8").trim(), out: result.out };
      }

      test("a change to a document, a project pointer, the site or the tool reaches the site", () => {
        for (const file of [
          "docs/guide/x.md",
          "projects/alpha",
          "site/pages/x.json",
          "src/a.ts",
          ".gitmodules",
        ]) {
          expect(run({ event: "pull_request", files: [file] }).relevant, file).toBe(
            "relevant=true",
          );
        }
      });

      test("a change to anything else does not, and says so", () => {
        const result = run({
          event: "pull_request",
          files: ["README.md", "scripts/x.mjs", "test/x.ts"],
        });
        expect(result.relevant).toBe("relevant=false");
        expect(result.out).toContain(
          "::notice title=workspace::the change does not reach the site",
        );
      });

      test("a manual run, and a history with no parent, always build", () => {
        expect(run({ event: "workflow_dispatch", files: ["README.md"] }).relevant).toBe(
          "relevant=true",
        );
        expect(run({ event: "push", files: [], single: true }).relevant).toBe("relevant=true");
      });

      test("without projects.json there is no workspace yet: nothing is built, and the notice says why", () => {
        const result = run({ event: "workflow_dispatch", files: ["src/a.ts"], registry: false });
        expect(result.relevant).toBe("relevant=false");
        expect(result.out).toContain("no projects.json");
      });
    },
  );
});

// ---- bump.yml ----

describe("bump.yml", () => {
  const job = bump.doc.jobs.bump;

  test("runs every 30 minutes and by hand, with an optional `project` input", () => {
    expect(bump.doc.name).toBe("Bump projects");
    expect(Object.keys(bump.doc.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
    const [schedule] = bump.doc.on.schedule as { cron: string }[];
    const minutes = /^(\d+),(\d+) \* \* \* \*$/.exec(schedule?.cron ?? "");
    expect(minutes, "two minutes an hour").not.toBeNull();
    expect(Number(minutes?.[2]) - Number(minutes?.[1])).toBe(30);
    const dispatch = bump.doc.on.workflow_dispatch as {
      inputs: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(dispatch.inputs)).toEqual(["project"]);
    expect(dispatch.inputs.project).toMatchObject({ type: "string", required: false, default: "" });
  });

  test("grants nothing at the top, and the one job the three permissions it uses", () => {
    expect(bump.doc.permissions).toEqual({});
    expect(job?.permissions).toEqual({
      contents: "write",
      "pull-requests": "write",
      actions: "write",
    });
  });

  test("runs one at a time and never cancels a run half way", () => {
    expect(bump.doc.concurrency).toEqual({ group: "bump", "cancel-in-progress": false });
  });

  test("checks out the default branch without submodules and without leaving a token behind", () => {
    const checkout = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with).toEqual({
      ref: "${{ github.event.repository.default_branch }}",
      "fetch-depth": 1,
      "persist-credentials": false,
    });
  });

  test("resolves with scripts/bump-submodules.mjs, the project input reaching the shell only through env", () => {
    const step = stepNamed(job?.steps, "Resolve the target commit of every project");
    expect(step.env).toEqual({
      GH_TOKEN: "${{ github.token }}",
      PROJECT: "${{ inputs.project }}",
    });
    expect(step.run).toContain('node scripts/bump-submodules.mjs "${args[@]}"');
    expect(step.run).toContain('--json "$RUNNER_TEMP/bump.json" --summary "$RUNNER_TEMP/bump.md"');
  });

  test("pushes with DOCS_BUMP_TOKEN when it is set and GITHUB_TOKEN when it is not, never both at once", () => {
    for (const name of [
      "Push the branch and open or update the pull request",
      "Close the pull request when nothing is left to bump",
    ]) {
      expect(stepNamed(job?.steps, name).env?.GH_TOKEN, name).toBe(
        "${{ secrets.DOCS_BUMP_TOKEN || secrets.GITHUB_TOKEN }}",
      );
    }
    expect(
      stepNamed(job?.steps, "Push the branch and open or update the pull request").env?.OWN_TOKEN,
    ).toBe("${{ secrets.DOCS_BUMP_TOKEN != '' }}");
    expect(bump.text.match(/secrets\.DOCS_BUMP_TOKEN \|\| secrets\.GITHUB_TOKEN/g)).toHaveLength(2);
  });

  test("the title and the branch are the ones the brief names, and the PR is updated through REST", () => {
    const script =
      stepNamed(job?.steps, "Push the branch and open or update the pull request").run ?? "";
    expect(job?.env?.BRANCH).toBe("bump/projects");
    expect(script).toContain('title="chore(docs): bump $count project(s)"');
    expect(script).toContain('git push --force-with-lease="refs/heads/$BRANCH:$remote"');
    expect(script).toContain('gh pr merge "$number" --auto --squash');
    expect(script).not.toMatch(
      /^\s*gh pr edit|git push [^\n]*--force(?!-with-lease)|git push [^\n]*\bmain\b/m,
    );
  });

  test("names no repository", () => {
    expect(bump.text).not.toMatch(/Avunu\/|docusystem|site-docs/);
  });

  describe.skipIf(!hasBash || !hasJq || isWindows)(
    "its shell steps, run for real against fake `git`, `gh` and `node`",
    () => {
      const pushName = "Push the branch and open or update the pull request";

      const REPORT = {
        changed: [
          {
            path: "alpha",
            repo: "https://github.com/Avunu/alpha",
            from: "a".repeat(40),
            to: "b".repeat(40),
            fromTag: "v1.0.0",
            toTag: "v1.1.0",
            reason: "release",
          },
          {
            path: "beta",
            repo: "https://github.com/Avunu/beta",
            from: "c".repeat(40),
            to: "d".repeat(40),
            fromTag: null,
            toTag: null,
            reason: "branch",
          },
        ],
        skipped: [],
        unchanged: [],
      };

      /** A temp folder with fake commands that log how they were called; returns the files and the environment. */
      function sandbox() {
        const root = tempDir();
        const bin = join(root, "bin");
        const temp = join(root, "runner-temp");
        mkdirSync(bin);
        mkdirSync(temp);
        const shim = (name: string, body: string) => {
          writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
          chmodSync(join(bin, name), 0o755);
        };
        shim(
          "git",
          `printf 'git %s\\n' "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "diff --cached") exit "\${FAKE_DIFF_EXIT:-1}" ;;
  "ls-remote origin") [ -n "\${FAKE_REMOTE_SHA:-}" ] && printf '%s\\trefs/heads/bump/projects\\n' "$FAKE_REMOTE_SHA"; exit 0 ;;
esac
if [ "$1" = push ]; then printf 'push-auth %s\\n' "$GIT_CONFIG_VALUE_0" >> "$FAKE_LOG"; fi
if [ "$1" = commit ]; then cp "$4" "$FAKE_TEMP/committed.txt"; fi
exit 0`,
        );
        shim(
          "gh",
          `printf 'gh %s\\n' "$*" >> "$FAKE_LOG"
if [ "$1 $2" = "pr list" ]; then
  n="$(cat "$FAKE_TEMP/list-calls" 2>/dev/null || echo 0)"; echo $((n + 1)) > "$FAKE_TEMP/list-calls"
  if [ "$n" = 0 ]; then printf '%s' "\${FAKE_PR_BEFORE:-}"; else printf '%s' "\${FAKE_PR_AFTER:-}"; fi
  exit 0
fi
if [ "$1 $2" = "pr merge" ] && [ -n "\${FAKE_MERGE_FAIL:-}" ]; then echo 'auto merge is not allowed' >&2; exit 1; fi
exit 0`,
        );
        writeFileSync(join(root, "log"), "");
        writeFileSync(join(temp, "bump.json"), JSON.stringify(REPORT));
        writeFileSync(join(temp, "bump.md"), "SUMMARY-OF-THE-BUMP\n");
        return {
          root,
          temp,
          log: () => readFileSync(join(root, "log"), "utf8"),
          env: {
            PATH: `${bin}:${process.env.PATH ?? ""}`,
            FAKE_LOG: join(root, "log"),
            FAKE_TEMP: temp,
            RUNNER_TEMP: temp,
            GH_TOKEN: "ghs_FAKE_TOKEN_FOR_THE_TEST",
            GH_REPO: "Owner/workspace",
            OWN_TOKEN: "true",
            BRANCH: "bump/projects",
            DEFAULT_BRANCH: "main",
            GITHUB_SERVER_URL: "https://github.example.test",
            GITHUB_RUN_ID: "123",
          } as Record<string, string>,
        };
      }

      const pushStep = (box: ReturnType<typeof sandbox>, env: Record<string, string> = {}) =>
        bash(runOf(bump, "bump", pushName), box.root, { ...box.env, ...env });

      test("commits the index on bump/projects with a body of one short line per project, then pushes under a lease", () => {
        const box = sandbox();
        const result = pushStep(box, { FAKE_REMOTE_SHA: "e".repeat(40), FAKE_PR_AFTER: "42" });
        expect(result.code, result.out).toBe(0);
        const log = box.log();
        expect(log).toContain("git config user.name github-actions[bot]");
        expect(log).toContain("git switch --create bump/projects");
        const message = readFileSync(join(box.temp, "committed.txt"), "utf8");
        expect(message).toBe(
          "chore(docs): bump 2 project(s)\n\n- alpha: v1.0.0 -> v1.1.0\n- beta: ccccccc -> ddddddd\n",
        );
        expect(message.split("\n").every((line) => line.length <= 100)).toBe(true);
        expect(log).toContain(
          `git push --force-with-lease=refs/heads/bump/projects:${"e".repeat(40)} origin HEAD:refs/heads/bump/projects`,
        );
        expect(log.indexOf("git commit")).toBeLessThan(log.indexOf("git push"));
      });

      test("a branch that does not exist yet must still not exist when it is pushed", () => {
        const box = sandbox();
        expect(pushStep(box, { FAKE_PR_AFTER: "42" }).code).toBe(0);
        expect(box.log()).toContain(
          "git push --force-with-lease=refs/heads/bump/projects: origin HEAD:refs/heads/bump/projects",
        );
      });

      test("the token reaches git through the environment, never an argument", () => {
        const box = sandbox();
        expect(pushStep(box, { FAKE_PR_AFTER: "42" }).code).toBe(0);
        const log = box.log();
        expect(log.replace(/^push-auth .*$/m, "")).not.toContain("ghs_FAKE_TOKEN_FOR_THE_TEST");
        const auth = /^push-auth AUTHORIZATION: basic (\S+)$/m.exec(log)?.[1];
        expect(Buffer.from(auth ?? "", "base64").toString()).toBe(
          "x-access-token:ghs_FAKE_TOKEN_FOR_THE_TEST",
        );
      });

      test("opens the pull request when none is open, with the summary as its body, and turns on auto-merge", () => {
        const box = sandbox();
        const result = pushStep(box, { FAKE_PR_AFTER: "42" });
        expect(result.code, result.out).toBe(0);
        const log = box.log();
        expect(log).toMatch(
          /gh pr create --base main --head bump\/projects --title chore\(docs\): bump 2 project\(s\) --body-file \S+pr-body\.md/,
        );
        expect(log).not.toContain("--method PATCH");
        expect(log).toContain("gh pr merge 42 --auto --squash");
        const body = readFileSync(join(box.temp, "pr-body.md"), "utf8");
        expect(body).toContain("SUMMARY-OF-THE-BUMP");
        expect(body).toContain("https://github.example.test/Owner/workspace/actions/runs/123");
      });

      test("updates the pull request that is open instead of opening another, through the REST API", () => {
        const box = sandbox();
        const result = pushStep(box, { FAKE_PR_BEFORE: "7", FAKE_PR_AFTER: "7" });
        expect(result.code, result.out).toBe(0);
        const log = box.log();
        expect(log).not.toContain("gh pr create");
        expect(log).toMatch(
          /gh api --method PATCH repos\/Owner\/workspace\/pulls\/7 --raw-field title=chore\(docs\): bump 2 project\(s\) --field body=@\S+pr-body\.md/,
        );
        expect(log).toContain("gh pr merge 7 --auto --squash");
      });

      test("with DOCS_BUMP_TOKEN the pull request starts CI itself: ci.yml is not dispatched, and no notice is raised", () => {
        const box = sandbox();
        const result = pushStep(box, { OWN_TOKEN: "true", FAKE_PR_AFTER: "42" });
        expect(box.log()).not.toContain("gh workflow run");
        expect(result.out).not.toContain("::notice");
      });

      test("with GITHUB_TOKEN ci.yml is dispatched on the branch, and a notice says why", () => {
        const box = sandbox();
        const result = pushStep(box, { OWN_TOKEN: "false", FAKE_PR_AFTER: "42" });
        expect(box.log()).toContain("gh workflow run ci.yml --ref bump/projects");
        expect(result.out).toContain("::notice title=DOCS_BUMP_TOKEN::DOCS_BUMP_TOKEN is not set");
        expect(result.out).toContain("deploy.yml must be run by hand");
      });

      test("a repository that does not allow auto-merge is a warning, not a failure", () => {
        const box = sandbox();
        const result = pushStep(box, { FAKE_PR_AFTER: "42", FAKE_MERGE_FAIL: "1" });
        expect(result.code, result.out).toBe(0);
        expect(result.out).toContain("::warning title=auto-merge::");
      });

      test("fails when the report lists changes but nothing is staged", () => {
        const box = sandbox();
        const result = pushStep(box, { FAKE_DIFF_EXIT: "0" });
        expect(result.code).toBe(1);
        expect(result.out).toContain("nothing is staged");
        expect(box.log()).not.toContain("git push");
      });

      describe("the step that resolves, with a fake script", () => {
        const resolve = (project: string) => {
          const box = sandbox();
          mkdirSync(join(box.root, "scripts"));
          writeFileSync(
            join(box.root, "scripts", "bump-submodules.mjs"),
            `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
console.log("ARGS " + args.join(" "));
`,
          );
          const out = join(box.root, "output");
          const summary = join(box.root, "summary");
          writeFileSync(out, "");
          writeFileSync(summary, "");
          const result = bash(
            runOf(bump, "bump", "Resolve the target commit of every project"),
            box.root,
            {
              ...box.env,
              PROJECT: project,
              GITHUB_OUTPUT: out,
              GITHUB_STEP_SUMMARY: summary,
            },
          );
          return { result, out: readFileSync(out, "utf8"), summary: readFileSync(summary, "utf8") };
        };

        test("passes the report files, counts the changes and the skipped projects, and copies the summary", () => {
          const { result, out, summary } = resolve("");
          expect(result.code, result.out).toBe(0);
          expect(result.out).toContain("ARGS --json ");
          expect(result.out).not.toContain("--project");
          expect(out).toBe("count=2\nskipped=0\n");
          expect(summary).toBe("SUMMARY-OF-THE-BUMP\n");
        });

        test("passes a project path through, and refuses anything that is not one", () => {
          const ok = resolve("frappe-nix");
          expect(ok.result.out).toContain("--project frappe-nix");
          for (const bad of ["Frappe", "a/b", "../x", "a b", "--help", "x;id", "$(id)"]) {
            const refused = resolve(bad);
            expect(refused.result.code, bad).toBe(1);
            expect(refused.result.out, bad).toContain("::error title=project::");
          }
        });
      });

      describe("the step that closes a pull request with nothing left in it", () => {
        const closeName = "Close the pull request when nothing is left to bump";
        test("closes the open one with a comment, and does nothing when there is none", () => {
          const open = sandbox();
          expect(
            bash(runOf(bump, "bump", closeName), open.root, { ...open.env, FAKE_PR_BEFORE: "9" })
              .code,
          ).toBe(0);
          expect(open.log()).toMatch(
            /gh pr close 9 --comment Every project is already at its target commit on main/,
          );
          const none = sandbox();
          expect(bash(runOf(bump, "bump", closeName), none.root, none.env).code).toBe(0);
          expect(none.log()).not.toContain("gh pr close");
        });

        test("runs only when nothing was found, nothing was skipped, and the run was not for one project", () => {
          expect(stepNamed(job?.steps, closeName).if).toBe(
            "${{ steps.resolve.outputs.count == '0' && steps.resolve.outputs.skipped == '0' && inputs.project == '' }}",
          );
          expect(stepNamed(job?.steps, pushName).if).toBe(
            "${{ steps.resolve.outputs.count != '0' }}",
          );
        });
      });
    },
  );
});

// ---- check-docs.yml ----

describe("check-docs.yml", () => {
  const job = check.doc.jobs.check;

  test("is a reusable workflow with a required `path` and a `ref` that defaults to main, and no secrets", () => {
    expect(Object.keys(check.doc.on)).toEqual(["workflow_call"]);
    const call = check.doc.on.workflow_call as { inputs: Record<string, Record<string, unknown>> };
    expect(Object.keys(call)).toEqual(["inputs"]);
    expect(Object.keys(call.inputs)).toEqual(["path", "ref"]);
    expect(call.inputs.path).toMatchObject({ required: true, type: "string" });
    expect(call.inputs.ref).toMatchObject({ required: false, type: "string", default: "main" });
    expect(check.text).not.toMatch(/secrets\./);
    expect(check.doc.permissions).toEqual({});
  });

  test("one job, read-only, with a stable name (a caller's required check is `<job> / Check`)", () => {
    expect(Object.keys(check.doc.jobs)).toEqual(["check"]);
    expect(job?.name).toBe("Check");
    expect(job?.permissions).toEqual({ contents: "read" });
  });

  test("checks out this repository at `ref` and the caller's pull request beside it, both without credentials", () => {
    const checkouts = (job?.steps ?? []).filter((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkouts.map((step) => step.with)).toEqual([
      {
        repository: "${{ env.WORKSPACE_REPOSITORY }}",
        ref: "${{ inputs.ref }}",
        path: "workspace",
        "fetch-depth": 1,
        "persist-credentials": false,
      },
      { path: "project", "fetch-depth": 1, "persist-credentials": false },
    ]);
  });

  test("the one literal is the workspace repository, said once and explained", () => {
    expect(check.text.match(/Avunu\//g)).toHaveLength(1);
    expect(check.doc.env).toEqual({ WORKSPACE_REPOSITORY: "Avunu/site-docs" });
    expect(check.text).toContain("the one literal of this workflow");
  });

  test("runs `check --only <path> --source <path>=<the caller's checkout>` in CI mode, after an install without scripts", () => {
    const names = (job?.steps ?? []).map((step) => step.name);
    expect(names.indexOf("Install the locked dependencies")).toBeLessThan(
      names.indexOf("Build the tool"),
    );
    expect(names.indexOf("Build the tool")).toBeLessThan(names.indexOf("Check the documentation"));
    const step = stepNamed(job?.steps, "Check the documentation");
    expect(step.run).toBe(
      'node build/cli.js check --only "$PROJECT" --source "$PROJECT=$GITHUB_WORKSPACE/project"',
    );
    expect(step.env).toEqual({ CI: "true" });
    expect(step["working-directory"]).toBe("workspace");
    expect(stepNamed(job?.steps, "Install the locked dependencies").run).toBe(
      "npm ci --ignore-scripts --no-audit --no-fund",
    );
  });

  test("never runs anything of the calling project: it is checked out last, installed nowhere, and only read", () => {
    for (const step of job?.steps ?? []) {
      expect(step["working-directory"] ?? "workspace", step.name).toBe("workspace");
    }
    const runs = (job?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(runs).not.toMatch(/\bcd project\b|working-directory: project/);
  });

  describe.skipIf(!hasBash || isWindows)("its shell steps, run for real", () => {
    const inputsStep = runOf(check, "check", "Check the inputs");

    test.each([
      ["frappe-nix", "main"],
      ["a", "0123456789abcdef0123456789abcdef01234567"],
      ["erpnext-taskview", "release/1.2"],
    ])("accepts the path %s and the ref %s", (path, ref) => {
      expect(bash(inputsStep, tempDir(), { PROJECT: path, TOOL_REF: ref }).code).toBe(0);
    });

    test.each([
      ["Frappe", "main", "path"],
      ["a/b", "main", "path"],
      ["", "main", "path"],
      ["../x", "main", "path"],
      ["x;id", "main", "path"],
      ["frappe-nix", "", "ref"],
      ["frappe-nix", "-x", "ref"],
      ["frappe-nix", "a b", "ref"],
      ["frappe-nix", "$(id)", "ref"],
    ])("refuses the path %j with the ref %j", (path, ref, which) => {
      const result = bash(inputsStep, tempDir(), { PROJECT: path, TOOL_REF: ref });
      expect(result.code).toBe(1);
      expect(result.out).toContain(`::error title=${which}::`);
    });

    const registry = JSON.stringify({
      projects: [
        { path: "alpha", repo: "https://github.com/Avunu/alpha", branch: "main" },
        { path: "beta", repo: "https://github.com/Avunu/beta", branch: "main" },
        { path: "site-docs", repo: "https://github.com/Avunu/ws", local: true },
        { path: "gamma", repo: "https://github.com/Avunu/gamma", branch: "main" },
      ],
    });

    test.skipIf(!hasJq)(
      "refuses a project that is not in projects.json, and accepts one that is",
      () => {
        const dir = tempDir();
        writeFileSync(join(dir, "projects.json"), registry);
        const script = runOf(check, "check", "Check that the project is registered");
        expect(bash(script, dir, { PROJECT: "beta" }).code).toBe(0);
        const refused = bash(script, dir, { PROJECT: "delta" });
        expect(refused.code).toBe(1);
        expect(refused.out).toContain("'delta' is not in projects.json");
      },
    );

    test.skipIf(!hasJq)(
      "fetches every project except the calling one and the local one, shallowly",
      () => {
        const dir = tempDir();
        writeFileSync(join(dir, "projects.json"), registry);
        const bin = join(dir, "bin");
        mkdirSync(bin);
        writeFileSync(
          join(bin, "git"),
          '#!/usr/bin/env bash\nprintf "git %s\\n" "$*" > "$FAKE_LOG"\n',
        );
        chmodSync(join(bin, "git"), 0o755);
        const log = join(dir, "log");
        const script = runOf(check, "check", "Fetch the other projects");
        const result = bash(script, dir, {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          FAKE_LOG: log,
          PROJECT: "beta",
          GIT_ALLOW_PROTOCOL: "https",
        });
        expect(result.code, result.out).toBe(0);
        expect(readFileSync(log, "utf8")).toBe(
          "git submodule update --init --depth 1 -- projects/alpha projects/gamma\n",
        );
        expect(stepNamed(job?.steps, "Fetch the other projects").env).toEqual({
          GIT_ALLOW_PROTOCOL: "https",
        });
      },
    );

    test.skipIf(!hasJq)("fetches nothing when the calling project is the only one", () => {
      const dir = tempDir();
      writeFileSync(
        join(dir, "projects.json"),
        JSON.stringify({
          projects: [{ path: "alpha", repo: "https://github.com/Avunu/alpha", branch: "main" }],
        }),
      );
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "git"), '#!/usr/bin/env bash\necho called >> "$FAKE_LOG"\n');
      chmodSync(join(bin, "git"), 0o755);
      writeFileSync(join(dir, "log"), "");
      const result = bash(runOf(check, "check", "Fetch the other projects"), dir, {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FAKE_LOG: join(dir, "log"),
        PROJECT: "alpha",
      });
      expect(result.code, result.out).toBe(0);
      expect(readFileSync(join(dir, "log"), "utf8")).toBe("");
    });
  });
});
